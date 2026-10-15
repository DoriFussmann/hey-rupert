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
  FEEDBACK_AREAS,
  FEEDBACK_PRIORITIES,
  MATERIALS_BUCKET,
  asFeedback,
  asFeedbackItems,
  asMaterials,
  asNarrative,
  feedbackForClient,
  fileExtension,
  formatBytes,
  type FeedbackDraft,
  type FeedbackEmail,
  type FeedbackItem,
  type MaterialsAnalysis,
  type NarrativePayload,
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

const AREA_VALUES = FEEDBACK_AREAS.map((area) => area.value);
const PRIORITY_VALUES = FEEDBACK_PRIORITIES.map((priority) => priority.value);

const ANALYSIS_TOOL: ClaudeTool = {
  name: "submit_analysis",
  description: "Deliver the analysis of the company materials.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Internal company summary (markdown)." },
      framing: { type: "string", description: "Internal investor framing (markdown)." },
      intro: { type: "string", description: "Opening message to the founder (markdown)." },
      feedback: {
        type: "array",
        items: {
          type: "object",
          properties: {
            area: { type: "string", enum: AREA_VALUES },
            priority: { type: "string", enum: PRIORITY_VALUES },
            slide: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["area", "priority", "slide", "title", "body"],
        },
      },
    },
    required: ["summary", "framing", "intro", "feedback"],
  },
};

export type AnalysisOutcome = {
  analysis: MaterialsAnalysis;
  intro: string;
  items: FeedbackItem[];
};

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
  const items = asFeedbackItems(
    (Array.isArray(raw.feedback) ? raw.feedback : []).map((item, index) => ({
      ...(item && typeof item === "object" ? item : {}),
      id: `f${index + 1}`,
      visible: true,
    })),
  );
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
      intro: text(raw.intro).slice(0, 30000),
      items,
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

export async function draftFeedbackEmail(
  supabase: ServiceClient,
  clientId: string,
  draft: FeedbackDraft,
): Promise<AgentResult<FeedbackEmail>> {
  const [loaded, prompts] = await Promise.all([
    loadClient(supabase, clientId),
    loadAgentPrompts(supabase),
  ]);
  if (!loaded.ok) return loaded;

  const visible = feedbackForClient(draft);
  if (!visible.intro.trim() && visible.items.length === 0) {
    return { ok: false, error: "Add the feedback first: there is nothing to summarize." };
  }

  const firstName =
    text(loaded.client.first_name) || text(loaded.client.founder_name).split(/\s+/)[0];
  const feedback = [
    `Founder: ${firstName || "unknown"}`,
    `Company: ${text(loaded.client.company_name)}`,
    "## Opening message in the portal",
    visible.intro || "(none)",
    "## Recommendations the founder will see",
    visible.items
      .map(
        (item, index) =>
          `${index + 1}. [${item.priority}${item.slide ? `, slide ${item.slide}` : ""}] ${item.title}: ${item.body}`,
      )
      .join("\n") || "(none)",
    visible.attachments.length + visible.links.length > 0
      ? `Also shared: ${[
          ...visible.attachments.map((file) => file.name),
          ...visible.links.map((link) => link.label || link.url),
        ].join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callClaudeTool<Record<string, unknown>>({
    system: prompts.feedback_email,
    messages: [
      {
        role: "user",
        content: `${feedback}\n\nWrite the email by calling the ${EMAIL_TOOL.name} tool.`,
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

// ---------------------------------------------------------------------------
// Outreach narrative

const NARRATIVE_TOOL: ClaudeTool = {
  name: "submit_narrative",
  description: "Deliver the outreach narrative and messages.",
  input_schema: {
    type: "object",
    properties: {
      core: { type: "string", description: "Core narrative (markdown)." },
      email_subject: { type: "string" },
      email_body: { type: "string" },
      linkedin_note: { type: "string", description: "Under 300 characters." },
      linkedin_followup: { type: "string" },
    },
    required: ["core", "email_subject", "email_body", "linkedin_note", "linkedin_followup"],
  },
};

export async function buildNarrative(
  supabase: ServiceClient,
  clientId: string,
): Promise<AgentResult<NarrativePayload>> {
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
  const current = asNarrative(framingRow?.published ?? framingRow?.draft);
  const clientAsk =
    framingRow?.status === "changes_requested" && framingRow.response
      ? [
          framingRow.response.note,
          ...Object.values(framingRow.response.item_notes),
        ]
          .filter(Boolean)
          .join("\n")
      : "";

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
    "## Feedback given to the founder",
    feedback.items
      .filter((item) => item.visible)
      .map((item) => `- ${item.title}: ${item.body}`)
      .join("\n") || "(none)",
    clientAsk && current.core
      ? `## The previous version the founder reviewed\n${JSON.stringify(current, null, 2)}\n\n## What the founder asked to change\n${clientAsk}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: prompts.outreach_narrative,
    content: [
      {
        type: "text",
        text: `${context}\n\nDeliver the narrative by calling the ${NARRATIVE_TOOL.name} tool.`,
      },
    ],
    tool: NARRATIVE_TOOL,
    maxTokens: 4000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const narrative = asNarrative(result.input);
  if (!narrative.core.trim()) {
    return { ok: false, error: "Claude returned an empty narrative." };
  }
  return { ok: true, value: narrative };
}
