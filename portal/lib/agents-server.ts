import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  callClaudeAgent,
  callClaudeTool,
  webFetchTool,
  type ClaudeContentBlock,
  type ClaudeTool,
} from "@/lib/anthropic";
import {
  AGENTS,
  agentPromptSlug,
  defaultAgentPrompts,
  type AgentPrompts,
} from "@/lib/agents";
import {
  INTAKE_BRIEF_FIELDS,
  intakeMessageText,
  type IntakeBrief,
  type IntakeInterview,
} from "@/lib/intake";
import { buildClientContext, loadInterview } from "@/lib/intake-server";
import { labelledAnswers, type MaterialField } from "@/lib/material-fields";
import { loadMaterialFields } from "@/lib/material-fields-server";
import { profileText } from "@/lib/match/shared";
import { OFFICE_TEXT_EXTENSIONS, extractOfficeText } from "@/lib/office-text";
import {
  MATERIALS_BUCKET,
  asEmailCopy,
  asFeedback,
  asInvestorList,
  asMaterials,
  asNarrative,
  fileExtension,
  formatBytes,
  FIT_TIERS,
  LINKEDIN_NOTE_MAX,
  type EmailCopyPayload,
  type ClientEmailDraft,
  type FeedbackDraft,
  type InvestorListPayload,
  type MaterialsAnalysis,
  type NarrativePayload,
  type SetupHistoryEntry,
  type SetupResponse,
} from "@/lib/setup";
import {
  AGENTS_MIGRATION_MISSING,
  loadSetupSteps,
  nowIso,
} from "@/lib/setup-server";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type AgentResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Settings

export async function loadAgentPrompts(supabase: ServiceClient): Promise<AgentPrompts> {
  const prompts = defaultAgentPrompts();
  const { data } = await supabase
    .from("form_templates")
    .select("slug, content")
    .in(
      "slug",
      AGENTS.map((agent) => agentPromptSlug(agent.id)),
    );
  for (const row of data ?? []) {
    const agent = AGENTS.find((item) => agentPromptSlug(item.id) === row.slug);
    const content = row.content != null ? String(row.content).trim() : "";
    if (agent && content) prompts[agent.id] = content;
  }
  return prompts;
}

// ---------------------------------------------------------------------------
// Shared context

async function loadClient(supabase: ServiceClient, clientId: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client not found." };
  return { ok: true as const, client: data as Record<string, unknown> };
}

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

/** What the intake taught us, best source first. */
/** The company profile Rupert maintains, as text. Missing table or row: none. */
async function profileContext(supabase: ServiceClient, clientId: string) {
  const { data } = await supabase
    .from("match_profiles")
    .select("answers")
    .eq("client_id", clientId)
    .maybeSingle();
  return profileText(data?.answers);
}

function intakeContext(interview: IntakeInterview | null) {
  if (!interview) return "No intake interview on record.";
  if (interview.admin_brief) {
    const brief = interview.admin_brief;
    const facts = INTAKE_BRIEF_FIELDS.map(
      (field) => `${field.label}: ${brief[field.key] || "not stated"}`,
    ).join("\n");
    return `${facts}\n\n${brief.summary}`;
  }
  if (interview.summary && interview.summary.length > 0) {
    return interview.summary
      .map((item) => `${item.title}: ${item.answer}`)
      .join("\n");
  }
  const notes = Object.entries(interview.topic_status)
    .filter(([, status]) => status.note)
    .map(([id, status]) => `${id}: ${status.note}`);
  return notes.length > 0 ? notes.join("\n") : "The intake has no answers yet.";
}

function answersBlock(fields: MaterialField[], values: Record<string, string>) {
  const answers = labelledAnswers(fields, values);
  return answers.length > 0
    ? answers.map((answer) => `### ${answer.label}\n${answer.value}`).join("\n\n")
    : "No written answers.";
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/g;
const MAX_LINKS = 10;

/** Links the client typed into their answers (nothing else is fetched). */
export function clientLinks(values: Record<string, string>) {
  const found = new Set<string>();
  for (const value of Object.values(values)) {
    for (const match of value.match(URL_PATTERN) ?? []) {
      const url = match.replace(/[.,;:!?]+$/, "");
      if (url.length <= 250) found.add(url);
      if (found.size >= MAX_LINKS) return Array.from(found);
    }
  }
  return Array.from(found);
}

// ---------------------------------------------------------------------------
// Intake brief

const BRIEF_TOOL: ClaudeTool = {
  name: "submit_brief",
  description: "Deliver the intake brief.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "The brief, in markdown." },
      industry: { type: "string" },
      geography: { type: "string" },
      stage: { type: "string" },
      raise_amount: { type: "string" },
    },
    required: ["summary", "industry", "geography", "stage", "raise_amount"],
  },
};

const RAISE_STAGES = new Set(["Pre-seed", "Seed", "Series A"]);

/** Fills the client's profile fields that are still empty. */
async function fillEmptyProfile(
  supabase: ServiceClient,
  client: Record<string, unknown>,
  brief: IntakeBrief,
) {
  const patch: Record<string, string> = {};
  if (!text(client.vertical) && brief.industry) patch.vertical = brief.industry;
  if (!text(client.geography) && brief.geography) patch.geography = brief.geography;
  if (!text(client.raise_amount) && brief.raise_amount) {
    patch.raise_amount = brief.raise_amount;
  }
  if (!text(client.raise_stage) && RAISE_STAGES.has(brief.stage)) {
    patch.raise_stage = brief.stage;
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("clients").update(patch).eq("id", String(client.id));
  if (error) console.error(`Profile fill failed: ${error.message}`);
}

export async function saveIntakeBrief(
  supabase: ServiceClient,
  clientId: string,
  brief: IntakeBrief,
): Promise<AgentResult<IntakeBrief>> {
  const loaded = await loadClient(supabase, clientId);
  if (!loaded.ok) return loaded;

  const { data, error } = await supabase
    .from("intake_interviews")
    .update({ admin_brief: brief })
    .eq("client_id", clientId)
    .select("client_id");
  if (error) {
    return {
      ok: false,
      error: /admin_brief/.test(error.message) ? AGENTS_MIGRATION_MISSING : error.message,
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "This client has no intake interview." };
  }

  await fillEmptyProfile(supabase, loaded.client, brief);
  return { ok: true, value: brief };
}

export async function writeIntakeBrief(
  supabase: ServiceClient,
  clientId: string,
): Promise<AgentResult<IntakeBrief>> {
  const [loaded, interviewResult, prompts] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadAgentPrompts(supabase),
  ]);
  if (!loaded.ok) return loaded;
  if (!interviewResult.ok) return { ok: false, error: interviewResult.error };
  const interview = interviewResult.interview;
  if (!interview || interview.messages.length === 0) {
    return { ok: false, error: "There is no intake interview to summarize." };
  }

  const transcript = interview.messages
    .map((message) =>
      `${message.role === "assistant" ? "Rupert" : "Founder"}: ${intakeMessageText(message)}`,
    )
    .join("\n\n");
  const confirmed =
    interview.summary && interview.summary.length > 0
      ? interview.summary.map((item) => `${item.title}: ${item.answer}`).join("\n")
      : "";

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: [
      prompts.intake_brief,
      "## What was already known",
      buildClientContext(loaded.client),
      confirmed ? `## Summary the founder reviewed and confirmed\n${confirmed}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    content: [
      {
        type: "text",
        text: `Interview transcript:\n\n${transcript}\n\nDeliver the brief by calling the ${BRIEF_TOOL.name} tool.`,
      },
    ],
    tool: BRIEF_TOOL,
    maxTokens: 3000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const raw = result.input;
  const summary = text(raw.summary);
  if (!summary) return { ok: false, error: "Claude returned an empty summary." };

  const brief: IntakeBrief = {
    summary: summary.slice(0, 20000),
    industry: text(raw.industry).slice(0, 200),
    geography: text(raw.geography).slice(0, 200),
    stage: text(raw.stage).slice(0, 100),
    raise_amount: text(raw.raise_amount).slice(0, 100),
    generated_at: nowIso(),
    based_on: interview.updated_at,
    edited_at: null,
  };
  return saveIntakeBrief(supabase, clientId, brief);
}

// ---------------------------------------------------------------------------
// Materials analysis

const PDF_IMAGE_BUDGET_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const PLAIN_TEXT = new Set(["txt", "md", "csv"]);
const ASK_FOR_PDF: Record<string, string> = {
  key: "Keynote can't be read. Ask the client for a PDF export.",
  ppt: "Old PowerPoint format can't be read. Ask the client for a PDF.",
  doc: "Old Word format can't be read. Ask the client for a PDF or .docx.",
  xls: "Old Excel format can't be read. Ask the client for .xlsx or CSV.",
};

type PreparedFiles = {
  blocks: ClaudeContentBlock[];
  read: string[];
  skipped: string[];
};

export async function prepareFiles(
  supabase: ServiceClient,
  files: ReturnType<typeof asMaterials>["files"],
): Promise<PreparedFiles> {
  const prepared: PreparedFiles = { blocks: [], read: [], skipped: [] };
  let binaryBytes = 0;

  for (const file of files) {
    const extension = fileExtension(file.name);
    if (ASK_FOR_PDF[extension]) {
      prepared.skipped.push(`${file.name}: ${ASK_FOR_PDF[extension]}`);
      continue;
    }
    const isPdf = extension === "pdf";
    const imageType = IMAGE_TYPES[extension];
    const isOffice = (OFFICE_TEXT_EXTENSIONS as readonly string[]).includes(extension);
    if (!isPdf && !imageType && !isOffice && !PLAIN_TEXT.has(extension)) {
      prepared.skipped.push(`${file.name}: this file type can't be read.`);
      continue;
    }
    if (imageType && file.size > IMAGE_MAX_BYTES) {
      prepared.skipped.push(
        `${file.name}: images over ${formatBytes(IMAGE_MAX_BYTES)} can't be read.`,
      );
      continue;
    }
    if ((isPdf || imageType) && binaryBytes + file.size > PDF_IMAGE_BUDGET_BYTES) {
      prepared.skipped.push(
        `${file.name}: skipped to stay within the ${formatBytes(PDF_IMAGE_BUDGET_BYTES)} the AI can read in one go.`,
      );
      continue;
    }

    const { data, error } = await supabase.storage.from(MATERIALS_BUCKET).download(file.path);
    if (error || !data) {
      prepared.skipped.push(`${file.name}: could not be downloaded (${error?.message ?? "unknown error"}).`);
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());

    if (isPdf) {
      binaryBytes += buffer.length;
      prepared.blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
        title: file.name,
      });
      prepared.read.push(file.name);
    } else if (imageType) {
      binaryBytes += buffer.length;
      prepared.blocks.push({ type: "text", text: `Image file: ${file.name}` });
      prepared.blocks.push({
        type: "image",
        source: { type: "base64", media_type: imageType, data: buffer.toString("base64") },
      });
      prepared.read.push(file.name);
    } else {
      let content = "";
      try {
        content = isOffice
          ? extractOfficeText(buffer, extension)
          : buffer.toString("utf8").slice(0, 120_000);
      } catch (err) {
        prepared.skipped.push(
          `${file.name}: could not be read (${err instanceof Error ? err.message : "unknown error"}).`,
        );
        continue;
      }
      if (!content.trim()) {
        prepared.skipped.push(`${file.name}: no readable text.`);
        continue;
      }
      prepared.blocks.push({
        type: "document",
        source: { type: "text", media_type: "text/plain", data: content },
        title: file.name,
      });
      prepared.read.push(isOffice ? `${file.name} (text only)` : file.name);
    }
  }
  return prepared;
}

const ANALYSIS_TOOL: ClaudeTool = {
  name: "submit_analysis",
  description: "Deliver the Company Summary and the Investor Framing.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Company summary for the founder (markdown)." },
      framing: { type: "string", description: "Investor framing for the founder (markdown)." },
    },
    required: ["summary", "framing"],
  },
};

export type AnalysisOutcome = { analysis: MaterialsAnalysis };

export async function runMaterialsAnalysis(
  supabase: ServiceClient,
  clientId: string,
): Promise<AgentResult<AnalysisOutcome>> {
  const [loaded, interviewResult, prompts, fields, grouped, profile] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadAgentPrompts(supabase),
    loadMaterialFields(supabase),
    loadSetupSteps(supabase, [clientId]),
    profileContext(supabase, clientId),
  ]);
  if (!loaded.ok) return loaded;

  const row = (grouped.get(clientId) ?? []).find((item) => item.step === "materials");
  if (!row || row.status !== "submitted") {
    return { ok: false, error: "The client has not submitted their materials yet." };
  }
  const materials = asMaterials(row.published ?? row.draft);
  const files = await prepareFiles(supabase, materials.files);
  const links = clientLinks(materials.fields);
  const interview = interviewResult.ok ? interviewResult.interview : null;

  if (files.blocks.length === 0 && labelledAnswers(fields, materials.fields).length === 0) {
    return {
      ok: false,
      error: `There is nothing the AI can read. ${files.skipped.join(" ")}`.trim(),
    };
  }

  const context = [
    "## Company profile (Rupert's source of truth; prefer it where sources differ)",
    profile,
    "## Client record",
    buildClientContext(loaded.client),
    "## Intake",
    intakeContext(interview),
    "## The founder's written answers",
    answersBlock(fields, materials.fields),
    "## Files",
    files.read.length > 0
      ? `Attached below: ${files.read.join(", ")}.`
      : "No readable files.",
    files.skipped.length > 0 ? `Not readable: ${files.skipped.join(" ")}` : "",
    "## Links the founder provided",
    links.length > 0
      ? `You may open these with web_fetch if useful (and no others):\n${links.join("\n")}`
      : "None.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: prompts.materials_analysis,
    content: [
      { type: "text", text: context },
      ...files.blocks,
      {
        type: "text",
        text: `Read everything above, then deliver your analysis by calling the ${ANALYSIS_TOOL.name} tool.`,
      },
    ],
    tool: ANALYSIS_TOOL,
    serverTools: links.length > 0 ? [webFetchTool(Math.min(links.length, 8))] : [],
    maxTokens: 12000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const raw = result.input;
  if (!text(raw.summary) || !text(raw.framing)) {
    return { ok: false, error: "Claude returned an incomplete analysis. Nothing was saved." };
  }
  const skipped = [...files.skipped];
  if (result.serverToolsSkipped && links.length > 0) {
    skipped.push(
      "Links were not opened: web fetch is not enabled for this Anthropic account.",
    );
  }

  return {
    ok: true,
    value: {
      analysis: {
        summary: text(raw.summary).slice(0, 30000),
        framing: text(raw.framing).slice(0, 30000),
        generated_at: nowIso(),
        read: [
          ...files.read,
          ...(links.length > 0 && !result.serverToolsSkipped
            ? [`Links (opened as needed): ${links.join(", ")}`]
            : []),
        ],
        skipped,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Feedback email

const EMAIL_TOOL: ClaudeTool = {
  name: "submit_email",
  description: "Deliver the email subject and body.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string" },
      body: { type: "string" },
    },
    required: ["subject", "body"],
  },
};

function founderLines(client: Record<string, unknown>, version: number) {
  const firstName = text(client.first_name) || text(client.founder_name).split(/\s+/)[0];
  return [
    `Founder: ${firstName || "unknown"}`,
    `Company: ${text(client.company_name)}`,
    version > 1 ? `This is version ${version}: an update of what they saw before.` : "",
  ];
}

/** Writes the middle of an email (subject and body) with one of the email agents. */
async function draftEmailMiddle(
  system: string,
  context: string,
): Promise<AgentResult<ClientEmailDraft>> {
  const result = await callClaudeTool<Record<string, unknown>>({
    system,
    messages: [
      {
        role: "user",
        content: `${context}\n\nWrite the email by calling the ${EMAIL_TOOL.name} tool.`,
      },
    ],
    tool: EMAIL_TOOL,
    maxTokens: 1500,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const subject = text(result.input.subject).slice(0, 300);
  const body = text(result.input.body).slice(0, 10000);
  if (!body) return { ok: false, error: "Claude returned an empty email." };
  return { ok: true, value: { subject, body } };
}

/** The middle of a nudge email (subject and body), from the Nudge page's context. */
export async function draftNudgeMiddle(
  supabase: ServiceClient,
  context: string,
): Promise<AgentResult<ClientEmailDraft>> {
  const prompts = await loadAgentPrompts(supabase);
  return draftEmailMiddle(prompts.nudge_email, context);
}

/** Everything Rupert knows about the company, as context for an email. */
async function companyContext(
  supabase: ServiceClient,
  clientId: string,
  client: Record<string, unknown>,
) {
  const [interviewResult, fields, grouped, profile] = await Promise.all([
    loadInterview(supabase, clientId),
    loadMaterialFields(supabase),
    loadSetupSteps(supabase, [clientId]),
    profileContext(supabase, clientId),
  ]);
  const materialsRow = (grouped.get(clientId) ?? []).find((item) => item.step === "materials");
  const materials = asMaterials(materialsRow?.published ?? materialsRow?.draft);
  return {
    rows: grouped.get(clientId) ?? [],
    text: [
      "## Company profile",
      profile,
      "## Client record",
      buildClientContext(client),
      "## Intake",
      intakeContext(interviewResult.ok ? interviewResult.interview : null),
      "## The founder's written answers",
      answersBlock(fields, materials.fields),
    ].join("\n\n"),
  };
}

function sharedLine(attachments: { name: string }[], links: { label: string; url: string }[]) {
  const shared = [
    ...attachments.map((file) => file.name),
    ...links.map((link) => link.label || link.url),
  ];
  return `## Files and links shared with it\n${shared.length > 0 ? shared.join(", ") : "None."}`;
}

/** The email that goes with the feedback, from Rupert's edited summary and framing. */
export async function draftFeedbackEmail(
  supabase: ServiceClient,
  clientId: string,
  draft: FeedbackDraft,
  version: number,
): Promise<AgentResult<ClientEmailDraft>> {
  if (!draft.analysis?.summary.trim() || !draft.analysis.framing.trim()) {
    return {
      ok: false,
      error: "Write the Company Summary and Investor Framing first: the email is drafted from them.",
    };
  }
  const [loaded, prompts] = await Promise.all([
    loadClient(supabase, clientId),
    loadAgentPrompts(supabase),
  ]);
  if (!loaded.ok) return loaded;
  const company = await companyContext(supabase, clientId, loaded.client);

  const context = [
    ...founderLines(loaded.client, version),
    "## Rupert's Company Summary (his edited version; the founder sees it)",
    draft.analysis.summary,
    "## Rupert's Investor Framing (his edited version; the founder sees it)",
    draft.analysis.framing,
    sharedLine(draft.attachments, draft.links),
    "# Company information (context only)",
    company.text,
  ]
    .filter(Boolean)
    .join("\n\n");

  return draftEmailMiddle(prompts.feedback_email, context);
}

/** What a revised narrative's email must do: confirm the changes, then ask for the go-ahead. */
function revisionBrief(feedbackConfirmed: boolean) {
  return [
    "## This email answers the founder's requested changes",
    "Write it as a reply to their notes:",
    "1. Thank them briefly and confirm the changes they asked for, naming each one in a few words (use the list of changes above; never claim a change that is not listed there).",
    "2. Say the updated narrative is in their portal.",
    feedbackConfirmed
      ? "3. Say Rupert would like to start investor matching: ask them to confirm the narrative in the portal so he can begin, or to reply with any further comments."
      : "3. Say Rupert would like to start investor matching: ask them to confirm the narrative and the Analysis & Feedback in the portal so he can begin, or to reply with any further comments.",
    "Keep it under 140 words. This replaces the usual structure for this email.",
  ].join("\n");
}

/** The email that goes with the narrative, from Rupert's edited narrative. */
export async function draftNarrativeEmail(
  supabase: ServiceClient,
  clientId: string,
  narrative: NarrativePayload,
  version: number,
): Promise<AgentResult<ClientEmailDraft>> {
  if (!narrative.core.trim()) {
    return { ok: false, error: "Write the narrative first: the email is drafted from it." };
  }
  const [loaded, prompts] = await Promise.all([
    loadClient(supabase, clientId),
    loadAgentPrompts(supabase),
  ]);
  if (!loaded.ok) return loaded;
  const company = await companyContext(supabase, clientId, loaded.client);
  const feedbackRow = company.rows.find((item) => item.step === "deck_review");
  const feedback = asFeedback(feedbackRow?.draft);
  const framingRow = company.rows.find((item) => item.step === "framing");
  const clientAsk =
    framingRow?.status === "changes_requested"
      ? earlierNotes([], framingRow.response)
      : "";
  const feedbackConfirmed =
    feedbackRow?.status === "confirmed" || feedbackRow?.status === "published";

  const context = [
    ...founderLines(loaded.client, version),
    "## Core story",
    narrative.core,
    "## Key messages",
    narrative.key_messages || "(none)",
    "## Approach",
    narrative.approach || "(none)",
    sharedLine(narrative.attachments, narrative.links),
    clientAsk ? `## What the founder asked to change\n${clientAsk}` : "",
    clientAsk
      ? `## What Rupert changed\n${narrative.change_summary?.trim() || "(no list: describe the changes only from what the founder asked and what the narrative now says)"}`
      : "",
    clientAsk ? revisionBrief(feedbackConfirmed) : "",
    "# Company information (context only)",
    feedback.analysis
      ? `## Rupert's Company Summary\n${feedback.analysis.summary}\n\n## Rupert's Investor Framing\n${feedback.analysis.framing}`
      : "",
    company.text,
  ]
    .filter(Boolean)
    .join("\n\n");

  return draftEmailMiddle(prompts.narrative_email, context);
}

/** The email that goes with the investor list: tier counts and fund types only, never names. */
export async function draftInvestorListEmail(
  supabase: ServiceClient,
  clientId: string,
  list: InvestorListPayload,
  version: number,
): Promise<AgentResult<ClientEmailDraft>> {
  if (list.rows.length === 0) {
    return { ok: false, error: "Push the list from Rupert Match first: the email is drafted from it." };
  }
  const [loaded, prompts] = await Promise.all([
    loadClient(supabase, clientId),
    loadAgentPrompts(supabase),
  ]);
  if (!loaded.ok) return loaded;
  const company = await companyContext(supabase, clientId, loaded.client);
  const listRow = company.rows.find((item) => item.step === "investor_list");
  const clientAsk =
    listRow?.status === "changes_requested" ? earlierNotes([], listRow.response) : "";

  const context = [
    ...founderLines(loaded.client, version),
    "## The investor list (tier counts and fund types)",
    listBrief(list),
    list.admin_note ? `## Rupert's note to the founder (shown on their page)\n${list.admin_note}` : "",
    clientAsk ? `## What the founder asked about the previous version\n${clientAsk}` : "",
    "# Company information (context only)",
    company.text,
  ]
    .filter(Boolean)
    .join("\n\n");

  return draftEmailMiddle(prompts.investor_list_email, context);
}

// ---------------------------------------------------------------------------
// Outreach narrative

const NARRATIVE_FIELDS = [
  { key: "core", label: "Core Story" },
  { key: "key_messages", label: "Key Messages" },
  { key: "approach", label: "Approach" },
] as const;

type NarrativeField = (typeof NARRATIVE_FIELDS)[number]["key"];

function narrativeTool(revising: boolean): ClaudeTool {
  return {
    name: "submit_narrative",
    description: revising
      ? "Deliver the full revised outreach narrative (all three sections, in full) and what changed."
      : "Deliver the outreach narrative: story, key messages and approach.",
    input_schema: {
      type: "object",
      properties: {
        core: { type: "string", description: "Core story (markdown). Always the full text." },
        key_messages: {
          type: "string",
          description: "3 to 6 key messages as one markdown bullet list. Always the full text.",
        },
        approach: {
          type: "string",
          description: "How Rupert will approach investors (markdown). Always the full text.",
        },
        ...(revising
          ? {
              changes: {
                type: "string",
                description:
                  "For Rupert only: a markdown bullet list, one bullet per thing the founder asked for, saying what you changed (or why you did not).",
              },
            }
          : {}),
      },
      required: ["core", "key_messages", "approach", ...(revising ? ["changes"] : [])],
    },
  };
}

/** Tool text as markdown. A list (Claude sometimes sends one) becomes bullets. */
function markdownText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item).replace(/^[-*•]\s*/, ""))
      .filter(Boolean)
      .map((item) => `- ${item}`)
      .join("\n");
  }
  return typeof value === "string" ? value.trim() : "";
}

function narrativeSections(narrative: NarrativePayload) {
  return NARRATIVE_FIELDS.map(
    ({ key, label }) => `### ${label}\n${narrative[key].trim() || "(empty)"}`,
  ).join("\n\n");
}

export type NarrativeBuild = {
  narrative: NarrativePayload;
  /** Sections Claude left out of a rebuild, kept from the version the founder reviewed. */
  kept: string[];
};

export async function buildNarrative(
  supabase: ServiceClient,
  clientId: string,
): Promise<AgentResult<NarrativeBuild>> {
  const [loaded, interviewResult, prompts, fields, grouped, profile] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadAgentPrompts(supabase),
    loadMaterialFields(supabase),
    loadSetupSteps(supabase, [clientId]),
    profileContext(supabase, clientId),
  ]);
  if (!loaded.ok) return loaded;

  const rows = grouped.get(clientId) ?? [];
  const materialsRow = rows.find((item) => item.step === "materials");
  const feedbackRow = rows.find((item) => item.step === "deck_review");
  const framingRow = rows.find((item) => item.step === "framing");
  const feedback = asFeedback(feedbackRow?.draft);
  if (!feedback.analysis) {
    return { ok: false, error: "Run Analyze under Analysis & Feedback first." };
  }

  const materials = asMaterials(materialsRow?.published ?? materialsRow?.draft);
  // The version the founder reviewed and commented on.
  const reviewed = asNarrative(framingRow?.published ?? framingRow?.draft);
  const clientAsk =
    framingRow?.status === "changes_requested"
      ? earlierNotes([], framingRow.response)
      : "";
  const revising = Boolean(clientAsk && reviewed.core.trim());
  const tool = narrativeTool(revising);

  const context = [
    "## Company profile (Rupert's source of truth; prefer it where sources differ)",
    profile,
    "## Client record",
    buildClientContext(loaded.client),
    "## Intake",
    intakeContext(interviewResult.ok ? interviewResult.interview : null),
    "## The founder's written answers",
    answersBlock(fields, materials.fields),
    "## Rupert's company summary",
    feedback.analysis.summary,
    "## Rupert's investor framing",
    feedback.analysis.framing,
    revising
      ? `## The version the founder reviewed\n${narrativeSections(reviewed)}\n\n## What the founder asked to change\n${clientAsk}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const instruction = revising
    ? `Revise the narrative to apply what the founder asked for, keeping everything they did not mention. Deliver it by calling the ${tool.name} tool with all three sections written out in full, including any section you did not change, plus the list of changes.`
    : `Deliver the narrative by calling the ${tool.name} tool, with all three sections written out in full.`;

  let raw: Record<string, unknown> = {};
  let missing: NarrativeField[] = [];
  // A first build has nothing to fall back on, so an incomplete answer is retried once.
  for (let attempt = 0; attempt < (revising ? 1 : 2); attempt += 1) {
    const result = await callClaudeAgent<Record<string, unknown>>({
      system: prompts.outreach_narrative,
      content: [{ type: "text", text: `${context}\n\n${instruction}` }],
      tool,
      maxTokens: 8000,
    });
    if (!result.ok) return { ok: false, error: result.reason };
    raw = result.input;
    missing = NARRATIVE_FIELDS.filter(({ key }) => !markdownText(raw[key])).map(({ key }) => key);
    if (missing.length === 0) break;
  }

  const kept = revising ? missing.filter((key) => reviewed[key].trim()) : [];
  const stillMissing = missing.filter((key) => !kept.includes(key));
  if (stillMissing.length > 0) {
    const names = NARRATIVE_FIELDS.filter(({ key }) => stillMissing.includes(key)).map(
      ({ label }) => label,
    );
    return {
      ok: false,
      error: `Claude's answer had no ${names.join(", ")}. Nothing was saved. Try again.`,
    };
  }

  const section = (key: NarrativeField) =>
    kept.includes(key) ? reviewed[key] : markdownText(raw[key]);
  // Rupert's working draft: files, links, next steps and earlier copy are kept.
  const working = asNarrative(framingRow?.draft ?? framingRow?.published);
  const narrative = asNarrative({
    ...working,
    core: section("core"),
    key_messages: section("key_messages"),
    approach: section("approach"),
    admin_note: undefined,
    change_summary: revising ? markdownText(raw.changes) : undefined,
  });

  return {
    ok: true,
    value: {
      narrative,
      kept: NARRATIVE_FIELDS.filter(({ key }) => kept.includes(key)).map(({ label }) => label),
    },
  };
}

// ---------------------------------------------------------------------------
// Email copy

const tierEmailSchema = {
  type: "array",
  minItems: 3,
  maxItems: 3,
  description: "First email, follow-up 1, follow-up 2. A blank follow-up subject means the same thread.",
  items: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Plain subject. Blank on a follow-up means the same thread." },
      body: { type: "string", description: "Email body. Sign off with the founder's first name." },
    },
    required: ["subject", "body"],
  },
};

const EMAIL_COPY_TOOL: ClaudeTool = {
  name: "submit_email_copy",
  description: "Deliver the tier emails and the LinkedIn messages.",
  input_schema: {
    type: "object",
    properties: {
      tiers: {
        type: "object",
        properties: {
          "1": tierEmailSchema,
          "2": tierEmailSchema,
          "3": tierEmailSchema,
        },
        required: ["1", "2", "3"],
      },
      linkedin_note: {
        type: "string",
        description: "LinkedIn connection note, 300 characters or fewer.",
      },
      linkedin_followup: {
        type: "string",
        description: "LinkedIn message after they connect.",
      },
    },
    required: ["tiers", "linkedin_note", "linkedin_followup"],
  },
};

function responseNotes(response: SetupResponse | null) {
  if (!response) return "";
  const notes = [
    response.note,
    ...Object.entries(response.item_notes).map(([key, value]) => `${key}: ${value}`),
  ].filter((value) => value.trim());
  return notes.join("\n");
}

function earlierNotes(history: SetupHistoryEntry[], current: SetupResponse | null) {
  const rounds = history
    .map((entry) => {
      const text = responseNotes(entry.response);
      return text ? `Version ${entry.version}:\n${text}` : "";
    })
    .filter(Boolean);
  const latest = responseNotes(current);
  if (latest) rounds.push(`Latest request:\n${latest}`);
  return rounds.join("\n\n");
}

/** Tier counts and fund types only. Never fund names, contact names, or emails. */
function listBrief(list: ReturnType<typeof asInvestorList>) {
  if (list.summary && list.summary.tiers.length > 0) {
    return list.summary.tiers
      .map((tier) => {
        const types =
          tier.by_type.map((entry) => `${entry.label} (${entry.funds} funds)`).join(", ") ||
          "types not grouped";
        return `Tier ${tier.tier}: ${tier.funds} funds. ${types}.`;
      })
      .join("\n");
  }
  return FIT_TIERS.map(({ tier, label }) => {
    const funds = list.rows.filter((row) => row.tier === tier).length;
    return `${label}: ${funds} funds.`;
  }).join("\n");
}

function intakeSummaryText(interview: { admin_brief?: { summary?: string } | null; summary?: { title: string; answer: string }[] | null } | null) {
  if (!interview) return "No intake summary on record.";
  const brief = interview.admin_brief?.summary?.trim();
  if (brief) return brief;
  if (interview.summary && interview.summary.length > 0) {
    return interview.summary.map((item) => `${item.title}: ${item.answer}`).join("\n");
  }
  return "No intake summary on record.";
}

export async function draftEmailCopy(
  supabase: ServiceClient,
  clientId: string,
): Promise<AgentResult<EmailCopyPayload>> {
  const [loaded, interviewResult, prompts, grouped] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadAgentPrompts(supabase),
    loadSetupSteps(supabase, [clientId]),
  ]);
  if (!loaded.ok) return loaded;

  const rows = grouped.get(clientId) ?? [];
  const framingRow = rows.find((item) => item.step === "framing");
  const feedbackRow = rows.find((item) => item.step === "deck_review");
  const listRow = rows.find((item) => item.step === "investor_list");
  const emailRow = rows.find((item) => item.step === "email_copy");

  if (framingRow?.status !== "confirmed") {
    return { ok: false, error: "Confirm the outreach narrative first." };
  }
  const narrative = asNarrative(framingRow.published);
  if (!narrative.core.trim() || !narrative.key_messages.trim() || !narrative.approach.trim()) {
    return {
      ok: false,
      error: "The confirmed narrative needs a core story, key messages and an approach. Rebuild it and confirm it again.",
    };
  }

  if (listRow?.status !== "confirmed") {
    return { ok: false, error: "Confirm the investor list first." };
  }
  const list = asInvestorList(listRow.published);

  const feedback = asFeedback(feedbackRow?.draft ?? feedbackRow?.published);
  const firstName =
    text(loaded.client.first_name) || text(loaded.client.founder_name).split(/\s+/)[0] || "the founder";
  const rebuilding = emailRow?.status === "changes_requested";
  const clientAsk = rebuilding
    ? earlierNotes(emailRow?.history ?? [], emailRow?.response ?? null)
    : "";

  const context = [
    `Founder first name (sign the emails with this): ${firstName}`,
    `Company: ${text(loaded.client.company_name)}`,
    "## Outreach narrative",
    `### Core story\n${narrative.core}`,
    `### Key messages\n${narrative.key_messages}`,
    `### Approach\n${narrative.approach}`,
    "## Investor list (types and counts only — do not name people)",
    listBrief(list),
    "## Intake summary",
    intakeSummaryText(interviewResult.ok ? interviewResult.interview : null),
    "## Materials analysis",
    feedback.analysis
      ? `${feedback.analysis.summary}\n\n${feedback.analysis.framing}`
      : "No analysis yet.",
    clientAsk ? `## What the founder asked to change\n${clientAsk}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: prompts.email_copy,
    content: [
      {
        type: "text",
        text: `${context}\n\nDeliver the copy by calling the ${EMAIL_COPY_TOOL.name} tool.`,
      },
    ],
    tool: EMAIL_COPY_TOOL,
    maxTokens: 8000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const working = asEmailCopy(emailRow?.draft ?? emailRow?.published);
  const copy = asEmailCopy({
    ...result.input,
    admin_note: working.admin_note,
  });
  const missingTier = FIT_TIERS.find(({ tier }) =>
    copy.tiers[`${tier}`].some((email) => !email.body.trim()),
  );
  if (missingTier) {
    return {
      ok: false,
      error: `Claude returned an incomplete ${missingTier.label} email. Nothing was saved.`,
    };
  }
  if (!copy.linkedin_note?.trim() || !copy.linkedin_followup?.trim()) {
    return { ok: false, error: "Claude left out a LinkedIn message. Nothing was saved." };
  }
  if (copy.linkedin_note.trim().length > LINKEDIN_NOTE_MAX) {
    return {
      ok: false,
      error: `Claude's LinkedIn connection note is over ${LINKEDIN_NOTE_MAX} characters. Nothing was saved.`,
    };
  }
  return { ok: true, value: copy };
}
