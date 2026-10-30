import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  callClaudeAgent,
  callClaudeTool,
  webFetchTool,
  type ClaudeTool,
} from "@/lib/anthropic";
import { listFacts, listFactsText } from "@/lib/founder-list-facts";
import { loadPlanForRun } from "@/lib/match/capacity/server";
import { promptSystem, type PromptOverride } from "@/lib/prompts";
import { loadPrompt, loadPrompts } from "@/lib/prompts-server";
import {
  INTAKE_BRIEF_FIELDS,
  conflictLine,
  intakeMessageText,
  type IntakeBrief,
  type IntakeInterview,
} from "@/lib/intake";
import { buildClientContext, loadInterview } from "@/lib/intake-server";
import { labelledAnswers, type MaterialField } from "@/lib/material-fields";
import { loadMaterialFields } from "@/lib/material-fields-server";
import { profileText } from "@/lib/match/shared";
import { prepareFiles } from "@/lib/material-files-server";
import {
  MATERIALS_FEEDBACK_NOTE_KEY,
  asEmailCopy,
  asFeedback,
  asInvestorList,
  asMaterials,
  asNarrative,
  EMAIL_SEQUENCE_LABELS,
  fitTiersFor,
  tierEmails,
  workingNarrative,
  type EmailCopyPayload,
  type TierScheme,
  type ClientEmailDraft,
  type InvestorListPayload,
  type MaterialsFeedback,
  type NarrativePayload,
  type SetupHistoryEntry,
  type SetupResponse,
  type SetupStepState,
} from "@/lib/setup";
import {
  OTHER_TIERS,
  OTHER_TIER_LABEL,
  SEQUENCE_LENGTH,
  emptyTypedCopy,
  groupKey,
  outreachRows,
  presetFor,
  styleInstructions,
  typeGroups,
  type CopySection,
  type FundTypeKey,
  type OtherTier,
  type TypedCopy,
  type TypedGroupCopy,
} from "@/lib/outreach/copy";
import { loadOutreachStyles } from "@/lib/outreach/settings-server";
import { loadOverrides } from "@/lib/outreach/known-server";
import { campaignFacts, campaignFactsText } from "@/lib/outreach/copy-facts";
import {
  AGENTS_MIGRATION_MISSING,
  loadSetupSteps,
  nowIso,
} from "@/lib/setup-server";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type AgentResult<T> = { ok: true; value: T } | { ok: false; error: string };

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
  const conflicts =
    interview.conflicts.length > 0
      ? `\n\nWhere the founder's files and answers differed (use what the founder confirmed):\n${interview.conflicts.map((conflict) => `- ${conflictLine(conflict)}`).join("\n")}`
      : "";
  if (interview.admin_brief) {
    const brief = interview.admin_brief;
    const facts = INTAKE_BRIEF_FIELDS.map(
      (field) => `${field.label}: ${brief[field.key] || "not stated"}`,
    ).join("\n");
    return `${facts}\n\n${brief.summary}${conflicts}`;
  }
  if (interview.summary && interview.summary.length > 0) {
    return `${interview.summary
      .map((item) => `${item.title}: ${item.answer}`)
      .join("\n")}${conflicts}`;
  }
  const notes = Object.entries(interview.topic_status)
    .filter(([, status]) => status.note)
    .map(([id, status]) => `${id}: ${status.note}`);
  return notes.length > 0 ? `${notes.join("\n")}${conflicts}` : "The intake has no answers yet.";
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

/** Writes the intake brief and saves it on the interview. */
export async function writeIntakeBrief(
  supabase: ServiceClient,
  clientId: string,
): Promise<AgentResult<IntakeBrief>> {
  const generated = await draftIntakeBrief(supabase, clientId);
  if (!generated.ok) return generated;
  return saveIntakeBrief(supabase, clientId, generated.value);
}

/** Writes the intake brief without saving it (the Agents page tests prompts with this). */
export async function draftIntakeBrief(
  supabase: ServiceClient,
  clientId: string,
  override?: PromptOverride | null,
): Promise<AgentResult<IntakeBrief>> {
  const [loaded, interviewResult, prompt] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadPrompt(supabase, "intake_brief", { clientId, purpose: "Intake brief", override }),
  ]);
  if (!loaded.ok) return loaded;
  if (!prompt.ok) return prompt;
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
    system: promptSystem(
      prompt.value,
      "## What was already known",
      buildClientContext(loaded.client),
      confirmed ? `## Summary the founder reviewed and confirmed\n${confirmed}` : "",
    ),
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
  return { ok: true, value: brief };
}

// ---------------------------------------------------------------------------
// Materials analysis

const ANALYSIS_TOOL: ClaudeTool = {
  name: "submit_feedback",
  description: "Deliver the Company Materials Feedback: the summary and the improvements.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "How Rupert reads the company, for the founder (markdown)." },
      improvements: {
        type: "string",
        description: "What to improve in the deck and materials, most important first (markdown).",
      },
    },
    required: ["summary", "improvements"],
  },
};

export type AnalysisOutcome = { feedback: MaterialsFeedback };

export async function runMaterialsAnalysis(
  supabase: ServiceClient,
  clientId: string,
  override?: PromptOverride | null,
): Promise<AgentResult<AnalysisOutcome>> {
  const [loaded, interviewResult, prompt, fields, grouped, profile] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadPrompt(supabase, "materials_analysis", { clientId, purpose: "Materials analysis", override }),
    loadMaterialFields(supabase),
    loadSetupSteps(supabase, [clientId]),
    profileContext(supabase, clientId),
  ]);
  if (!loaded.ok) return loaded;
  if (!prompt.ok) return prompt;

  const row = (grouped.get(clientId) ?? []).find((item) => item.step === "materials");
  if (!row || row.status !== "submitted") {
    return { ok: false, error: "The client has not submitted their materials yet." };
  }
  const materials = asMaterials(row.published ?? row.draft);
  const files = await prepareFiles(supabase, materials.files);
  const links = clientLinks(materials.fields);
  const interview = interviewResult.ok ? interviewResult.interview : null;

  if (
    files.blocks.length === 0 &&
    labelledAnswers(fields, materials.fields).length === 0 &&
    !materials.no_deck
  ) {
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
    materials.no_deck ? `The founder has no pitch deck yet: ${materials.no_deck}` : "",
    files.skipped.length > 0 ? `Not readable: ${files.skipped.join(" ")}` : "",
    "## Links the founder provided",
    links.length > 0
      ? `You may open these with web_fetch if useful (and no others):\n${links.join("\n")}`
      : "None.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content: [
      { type: "text", text: context },
      ...files.blocks,
      {
        type: "text",
        text: `Read everything above, then deliver the Company Materials Feedback by calling the ${ANALYSIS_TOOL.name} tool.`,
      },
    ],
    tool: ANALYSIS_TOOL,
    serverTools: links.length > 0 ? [webFetchTool(Math.min(links.length, 8))] : [],
    maxTokens: 12000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const raw = result.input;
  if (!text(raw.summary) || !markdownText(raw.improvements)) {
    return { ok: false, error: "Claude returned incomplete feedback. Nothing was saved." };
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
      feedback: {
        summary: text(raw.summary).slice(0, 30000),
        improvements: markdownText(raw.improvements).slice(0, 30000),
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
// Emails

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
  clientId: string,
  context: string,
  override?: PromptOverride | null,
): Promise<AgentResult<ClientEmailDraft>> {
  const prompt = await loadPrompt(supabase, "nudge_email", { clientId, purpose: "Nudge email draft", override });
  if (!prompt.ok) return prompt;
  return draftEmailMiddle(promptSystem(prompt.value), context);
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

/**
 * Rupert's feedback on the materials, as context for the AI: the Company
 * Materials Feedback on the narrative, or for a client who received feedback
 * as its own step before, that feedback. Empty when there is none.
 */
function feedbackContext(rows: SetupStepState[], feedback?: MaterialsFeedback) {
  const current =
    feedback ?? asNarrative(rows.find((item) => item.step === "framing")?.draft).feedback;
  if (current) {
    return `## Rupert's Company Materials Feedback: how he reads the company\n${current.summary}\n\n## Rupert's Company Materials Feedback: what to improve\n${current.improvements}`;
  }
  const legacyRow = rows.find((item) => item.step === "deck_review");
  const legacy = asFeedback(legacyRow?.draft ?? legacyRow?.published).analysis;
  return legacy
    ? `## Rupert's company summary\n${legacy.summary}\n\n## Rupert's investor framing\n${legacy.framing}`
    : "";
}

/** The email that goes with the narrative, from Rupert's edited narrative. */
export async function draftNarrativeEmail(
  supabase: ServiceClient,
  clientId: string,
  narrative: NarrativePayload,
  version: number,
  override?: PromptOverride | null,
): Promise<AgentResult<ClientEmailDraft>> {
  if (!narrative.core.trim()) {
    return { ok: false, error: "Write the narrative first: the email is drafted from it." };
  }
  const loaded = await loadClient(supabase, clientId);
  if (!loaded.ok) return loaded;
  const company = await companyContext(supabase, clientId, loaded.client);
  const framingRow = company.rows.find((item) => item.step === "framing");
  const clientAsk =
    framingRow?.status === "changes_requested"
      ? earlierNotes([], framingRow.response)
      : "";
  // A reply to the founder's change requests adds its own managed instructions.
  const prompts = await loadPrompts(
    supabase,
    clientAsk ? ["narrative_email", "narrative_email_revision"] : ["narrative_email"],
    { clientId, purpose: clientAsk ? "Narrative email draft (reply to changes)" : "Narrative email draft", override },
  );
  if (!prompts.ok) return prompts;
  const revision = clientAsk ? prompts.value.narrative_email_revision : null;

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
    narrative.feedback
      ? `# Company Materials Feedback sent with it (Rupert's edited version; the founder reads it, nothing to confirm)\n${feedbackContext(company.rows, narrative.feedback)}`
      : "",
    "# Company information (context only)",
    narrative.feedback ? "" : feedbackContext(company.rows),
    company.text,
  ]
    .filter(Boolean)
    .join("\n\n");

  return draftEmailMiddle(
    promptSystem(prompts.value.narrative_email, revision ? `## This email answers the founder's requested changes\n${revision.text}` : null),
    context,
  );
}

/**
 * The email that goes with the investor list, from facts the code decides:
 * the plan, funds and share per tier, up to five Core funds on this list that
 * may be named, and the verification results with their definition.
 */
export async function draftInvestorListEmail(
  supabase: ServiceClient,
  clientId: string,
  list: InvestorListPayload,
  version: number,
  override?: PromptOverride | null,
): Promise<AgentResult<ClientEmailDraft>> {
  if (list.rows.length === 0) {
    return { ok: false, error: "Push the list from Rupert Match first: the email is drafted from it." };
  }
  const [loaded, prompt] = await Promise.all([
    loadClient(supabase, clientId),
    loadPrompt(supabase, "investor_list_email", { clientId, purpose: "Investor list email draft", override }),
  ]);
  if (!loaded.ok) return loaded;
  if (!prompt.ok) return prompt;
  const company = await companyContext(supabase, clientId, loaded.client);
  const listRow = company.rows.find((item) => item.step === "investor_list");
  const clientAsk =
    listRow?.status === "changes_requested" ? earlierNotes([], listRow.response) : "";
  const saved = list.run_id ? await loadPlanForRun(supabase, clientId, list.run_id) : null;
  if (saved && !saved.ok) return saved;
  const allocation = saved?.value?.allocation ?? null;
  const plan =
    saved?.value && allocation
      ? { months: saved.value.inputs.months, fundsRequired: allocation.fundsRequired, planned: allocation.planned }
      : null;

  const context = [
    ...founderLines(loaded.client, version),
    "# Facts about the list (use only these)",
    listFactsText(listFacts(list), plan),
    list.admin_note ? `## Rupert's note to the founder (shown on their page)\n${list.admin_note}` : "",
    clientAsk ? `## What the founder asked about the previous version\n${clientAsk}` : "",
    "# Company information (context only)",
    company.text,
  ]
    .filter(Boolean)
    .join("\n\n");

  return draftEmailMiddle(promptSystem(prompt.value), context);
}

/**
 * The email that goes with the email copy: tells the founder the outreach
 * emails are ready, from Rupert's edited copy and the list's tier counts.
 */
export async function draftEmailCopyEmail(
  supabase: ServiceClient,
  clientId: string,
  copy: EmailCopyPayload,
  version: number,
  override?: PromptOverride | null,
): Promise<AgentResult<ClientEmailDraft>> {
  const tiers = copy.copy_version === 2 ? [] : fitTiersFor(copy.tier_scheme);
  const typedGroups = copy.copy_version === 2 && copy.typed
    ? [
        ...copy.typed.core.map((group) => ({ section: "core" as const, group })),
        ...copy.typed.others.map((group) => ({ section: "others" as const, group })),
      ]
    : [];
  const empty =
    copy.copy_version === 2
      ? typedGroups.every(({ group }) => group.emails.every((email) => !email.body.trim()))
      : tiers.every(({ tier }) => tierEmails(copy, tier).every((email) => !email.body.trim()));
  if (empty) {
    return { ok: false, error: "Write the emails first: the email is drafted from them." };
  }
  const [loaded, prompt] = await Promise.all([
    loadClient(supabase, clientId),
    loadPrompt(supabase, "email_copy_email", { clientId, purpose: "Email copy email draft", override }),
  ]);
  if (!loaded.ok) return loaded;
  if (!prompt.ok) return prompt;
  const company = await companyContext(supabase, clientId, loaded.client);
  const listRow = company.rows.find((item) => item.step === "investor_list");
  const emailRow = company.rows.find((item) => item.step === "email_copy");
  const clientAsk =
    emailRow?.status === "changes_requested" ? earlierNotes([], emailRow.response) : "";

  const typedText = typedGroups
    .map(({ section, group }) => {
      const emails = group.emails
        .map((email, index) => `#### ${EMAIL_SEQUENCE_LABELS[index]}${email.subject ? `\nSubject: ${email.subject}` : ""}\n${email.body}`)
        .join("\n\n");
      const head =
        section === "core"
          ? `### Core · ${group.type} (${group.funds} funds; each investor gets a personalized version, {{quick_fact}} marks the personal part)\nApproach: ${group.approach}`
          : `### Sphere, Tier 3 and Tier 4 · ${group.type} (${group.funds} funds; {{tier_line}} is one sentence per tier)`;
      return `${head}\n${emails}`;
    })
    .join("\n\n");
  const copyText = copy.copy_version === 2 ? typedText : tiers
    .map(({ tier, label, detail }) => {
      const emails = tierEmails(copy, tier)
        .map((email, index) => `#### ${EMAIL_SEQUENCE_LABELS[index]}${email.subject ? `\nSubject: ${email.subject}` : ""}\n${email.body}`)
        .join("\n\n");
      return `### ${label} (${detail})\n${emails}`;
    })
    .join("\n\n");

  const list = listRow ? asInvestorList(listRow.published) : null;
  const facts = list
    ? campaignFactsText(campaignFacts(list, await loadOverrides(supabase, clientId), copy.copy_version === 2 ? copy.typed : null))
    : "";
  const context = [
    ...founderLines(loaded.client, version),
    facts ? `# Campaign facts (use these numbers exactly)\n${facts}` : "",
    "# The email copy (Rupert's edited version)",
    copyText,
    list ? `# Investor list (types and counts only)\n${listBrief(list)}` : "",
    clientAsk ? `## What the founder asked to change in the previous version\n${clientAsk}` : "",
    "# Company information (context only)",
    company.text,
  ]
    .filter(Boolean)
    .join("\n\n");

  return draftEmailMiddle(promptSystem(prompt.value), context);
}

// ---------------------------------------------------------------------------
// Outreach narrative

const NARRATIVE_FIELDS = [
  { key: "summary", label: "The Outreach Narrative" },
  { key: "core", label: "Core Story" },
  { key: "key_messages", label: "Key Messages" },
  { key: "approach", label: "Approach" },
] as const;

type NarrativeField = (typeof NARRATIVE_FIELDS)[number]["key"];

export function narrativeTool(revising: boolean): ClaudeTool {
  return {
    name: "submit_narrative",
    description: revising
      ? "Deliver the full revised outreach narrative (the summary and all three sections, in full) and what changed."
      : "Deliver the outreach narrative: the summary the founder confirms, then the story, key messages and approach.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "The Outreach Narrative the founder reads and confirms (markdown): 150 to 250 words combining the core story, the key messages and the approach into one light, punchy, clear piece. No headings. Always the full text.",
        },
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
      required: ["summary", "core", "key_messages", "approach", ...(revising ? ["changes"] : [])],
    },
  };
}

/** Tool text as markdown. A list (Claude sometimes sends one) becomes bullets. */
export function markdownText(value: unknown): string {
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
  override?: PromptOverride | null,
): Promise<AgentResult<NarrativeBuild>> {
  const [loaded, interviewResult, prompt, fields, grouped, profile] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadPrompt(supabase, "outreach_narrative", { clientId, purpose: "Outreach narrative", override }),
    loadMaterialFields(supabase),
    loadSetupSteps(supabase, [clientId]),
    profileContext(supabase, clientId),
  ]);
  if (!loaded.ok) return loaded;
  if (!prompt.ok) return prompt;

  const rows = grouped.get(clientId) ?? [];
  const materialsRow = rows.find((item) => item.step === "materials");
  const framingRow = rows.find((item) => item.step === "framing");
  const feedback = feedbackContext(rows);
  if (!feedback) {
    return { ok: false, error: "Run Analyze first: the narrative is built from the Company Materials Feedback." };
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
    feedback,
    revising
      ? `## The version the founder reviewed\n${narrativeSections(reviewed)}\n\n## What the founder asked to change\n${clientAsk}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const instruction = revising
    ? `Revise the narrative to apply what the founder asked for, keeping everything they did not mention. Deliver it by calling the ${tool.name} tool with the summary and all three sections written out in full, including any section you did not change, plus the list of changes.`
    : `Deliver the narrative by calling the ${tool.name} tool, with the summary and all three sections written out in full.`;

  let raw: Record<string, unknown> = {};
  let missing: NarrativeField[] = [];
  // A first build has nothing to fall back on, so an incomplete answer is retried once.
  for (let attempt = 0; attempt < (revising ? 1 : 2); attempt += 1) {
    const result = await callClaudeAgent<Record<string, unknown>>({
      system: promptSystem(prompt.value),
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
    summary: section("summary"),
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

/**
 * The narrative written from the Company Brief (the Framing Room's output),
 * not from the raw intake. Revises with the founder's requested changes when
 * they asked for some.
 */
export async function buildNarrativeFromBrief(
  supabase: ServiceClient,
  clientId: string,
  brief: string,
): Promise<AgentResult<NarrativeBuild>> {
  const [loaded, prompt, grouped] = await Promise.all([
    loadClient(supabase, clientId),
    loadPrompt(supabase, "brief_narrative", { clientId, purpose: "Narrative from the brief" }),
    loadSetupSteps(supabase, [clientId]),
  ]);
  if (!loaded.ok) return loaded;
  if (!prompt.ok) return prompt;
  if (!brief.trim()) return { ok: false, error: "The brief is empty. Build it first." };

  const framingRow = (grouped.get(clientId) ?? []).find((item) => item.step === "framing");
  const reviewed = asNarrative(framingRow?.published ?? framingRow?.draft);
  const clientAsk = framingRow?.status === "changes_requested" ? earlierNotes([], framingRow.response) : "";
  const revising = Boolean(clientAsk && reviewed.core.trim());
  const tool = narrativeTool(revising);

  const context = [
    "## The Company Brief (the source of truth)",
    brief,
    "## Client record",
    buildClientContext(loaded.client),
    revising
      ? `## The version the founder reviewed\n${narrativeSections(reviewed)}\n\n## What the founder asked to change\n${clientAsk}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const instruction = revising
    ? `Revise the narrative to apply what the founder asked for, keeping everything they did not mention. Deliver it by calling the ${tool.name} tool with the summary and all three sections in full, plus the list of changes.`
    : `Deliver the narrative by calling the ${tool.name} tool, with the summary and all three sections written out in full.`;

  let raw: Record<string, unknown> = {};
  let missing: NarrativeField[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callClaudeAgent<Record<string, unknown>>({
      system: promptSystem(prompt.value),
      content: [{ type: "text", text: `${context}\n\n${instruction}` }],
      tool,
      maxTokens: 8000,
    });
    if (!result.ok) return { ok: false, error: result.reason };
    raw = result.input;
    missing = NARRATIVE_FIELDS.filter(({ key }) => !markdownText(raw[key])).map(({ key }) => key);
    if (missing.length === 0) break;
  }
  if (missing.length > 0) {
    const names = NARRATIVE_FIELDS.filter(({ key }) => missing.includes(key)).map(({ label }) => label);
    return { ok: false, error: `Claude's answer had no ${names.join(", ")}. Nothing was saved. Try again.` };
  }

  const working = asNarrative(framingRow?.draft ?? framingRow?.published);
  const narrative = asNarrative({
    ...working,
    summary: markdownText(raw.summary),
    core: markdownText(raw.core),
    key_messages: markdownText(raw.key_messages),
    approach: markdownText(raw.approach),
    admin_note: undefined,
    change_summary: revising ? markdownText(raw.changes) : undefined,
  });
  return { ok: true, value: { narrative, kept: [] } };
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

/** The copy tool for the list's scheme: a sequence for each of its tiers. */
function emailCopyTool(scheme: TierScheme): ClaudeTool {
  const keys = fitTiersFor(scheme).map(({ tier }) => String(tier));
  return {
    name: "submit_email_copy",
    description: "Deliver the tier emails.",
    input_schema: {
      type: "object",
      properties: {
        tiers: {
          type: "object",
          properties: Object.fromEntries(keys.map((key) => [key, tierEmailSchema])),
          required: keys,
        },
      },
      required: ["tiers"],
    },
  };
}

function responseNotes(response: SetupResponse | null) {
  if (!response) return "";
  const notes = [
    response.note,
    ...Object.entries(response.item_notes).map(([key, value]) =>
      key === MATERIALS_FEEDBACK_NOTE_KEY
        ? `On the Company Materials Feedback (background, not a change to the narrative): ${value}`
        : `${key}: ${value}`,
    ),
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
  const tiers = fitTiersFor(list.tier_scheme);
  const name = (tier: number) => {
    const entry = tiers.find((item) => item.tier === tier);
    return entry ? `Tier ${tier} (${entry.label}: ${entry.detail})` : `Tier ${tier}`;
  };
  const scheme =
    list.tier_scheme === "four"
      ? "The list has four tiers. Every fund invests at the company's stage and covers its location; the tiers differ by how closely the fund's sectors relate to the company's."
      : "The list has three tiers.";
  if (list.summary && list.summary.tiers.length > 0) {
    return [
      scheme,
      ...list.summary.tiers.map((tier) => {
        const types =
          tier.by_type.map((entry) => `${entry.label} (${entry.funds} funds)`).join(", ") ||
          "types not grouped";
        return `${name(tier.tier)}: ${tier.funds} funds. ${types}.`;
      }),
    ].join("\n");
  }
  return [
    scheme,
    ...tiers.map(({ tier }) => {
      const funds = list.rows.filter((row) => row.tier === tier && !row.hidden_duplicate).length;
      return `${name(tier)}: ${funds} funds.`;
    }),
  ].join("\n");
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
  override?: PromptOverride | null,
): Promise<AgentResult<EmailCopyPayload>> {
  const [loaded, interviewResult, prompt, grouped] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadPrompt(supabase, "email_copy", { clientId, purpose: "Email copy", override }),
    loadSetupSteps(supabase, [clientId]),
  ]);
  if (!loaded.ok) return loaded;
  if (!prompt.ok) return prompt;

  const rows = grouped.get(clientId) ?? [];
  const framingRow = rows.find((item) => item.step === "framing");
  const listRow = rows.find((item) => item.step === "investor_list");
  const emailRow = rows.find((item) => item.step === "email_copy");

  if (framingRow?.status !== "confirmed") {
    return { ok: false, error: "Confirm the outreach narrative first." };
  }
  // Rupert's internal update to the confirmed narrative, when he made one.
  const narrative = workingNarrative(framingRow);
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
  const scheme: TierScheme = list.tier_scheme ?? "three";
  const tool = emailCopyTool(scheme);
  const tierKeys = fitTiersFor(scheme).map(({ tier }) => tier).join(", ");

  const feedback = feedbackContext(rows, narrative.feedback);
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
    feedback || "No analysis yet.",
    clientAsk ? `## What the founder asked to change\n${clientAsk}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content: [
      {
        type: "text",
        text: `${context}\n\nWrite the three emails for each of the list's ${fitTiersFor(scheme).length} tiers (${tierKeys}). Deliver the copy by calling the ${tool.name} tool.`,
      },
    ],
    tool,
    maxTokens: 8000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const working = asEmailCopy(emailRow?.draft ?? emailRow?.published);
  const copy = asEmailCopy({
    ...result.input,
    tier_scheme: scheme,
    admin_note: working.admin_note,
  });
  const missingTier = fitTiersFor(scheme).find(({ tier }) =>
    tierEmails(copy, tier).some((email) => !email.body.trim()),
  );
  if (missingTier) {
    return {
      ok: false,
      error: `Claude returned an incomplete ${missingTier.label} email. Nothing was saved.`,
    };
  }
  return { ok: true, value: copy };
}

// ---------------------------------------------------------------------------
// Email copy by fund type (copy v2, lib/outreach/copy.ts)

function typedTool(core: boolean, tiers: OtherTier[]): ClaudeTool {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (core) {
    properties.core = {
      type: "object",
      properties: {
        approach: { type: "string", description: "2 to 4 sentences: what this kind of investor cares about and how the emails lead." },
        emails: tierEmailSchema,
      },
      required: ["approach", "emails"],
    };
    required.push("core");
  }
  if (tiers.length > 0) {
    properties.others = {
      type: "object",
      properties: {
        emails: tierEmailSchema,
        tier_lines: {
          type: "object",
          description: "One sentence per tier, inserted as {{tier_line}}.",
          properties: Object.fromEntries(
            tiers.map((tier) => [String(tier), { type: "string", description: `${OTHER_TIER_LABEL[tier]}: why a fund in this tier could care.` }]),
          ),
          required: tiers.map(String),
        },
      },
      required: ["emails", "tier_lines"],
    };
    required.push("others");
  }
  return {
    name: "submit_type_copy",
    description: "Deliver the copy for this fund type.",
    input_schema: { type: "object", properties, required },
  };
}

function typedEmails(value: unknown) {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: SEQUENCE_LENGTH }, (_, index) => {
    const item = (list[index] && typeof list[index] === "object" ? list[index] : {}) as Record<string, unknown>;
    return { subject: text(item.subject).slice(0, 300), body: text(item.body).slice(0, 10000) };
  });
}

export type TypedDraftResult = {
  copy: EmailCopyPayload;
  /** Group keys written in this run. */
  drafted: string[];
  /** Group keys that failed, with the reason. Their previous text is kept. */
  failed: { key: string; error: string }[];
  /** Funds the client marked "I know them": left out of the copy. */
  knownLeftOut: number;
};

/**
 * Writes the investor copy by fund type for a four-tier list. `only` limits the
 * run to some groups (`section:type` keys); every other group keeps its text.
 */
export async function draftTypedEmailCopy(
  supabase: ServiceClient,
  clientId: string,
  options: { only?: string[] | null; override?: PromptOverride | null } = {},
): Promise<AgentResult<TypedDraftResult>> {
  const [loaded, interviewResult, prompt, grouped, styleLoad] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadPrompt(supabase, "email_copy_typed", { clientId, purpose: "Email copy by fund type", override: options.override }),
    loadSetupSteps(supabase, [clientId]),
    loadOutreachStyles(supabase),
  ]);
  if (!loaded.ok) return loaded;
  if (!prompt.ok) return prompt;

  const rows = grouped.get(clientId) ?? [];
  const framingRow = rows.find((item) => item.step === "framing");
  const listRow = rows.find((item) => item.step === "investor_list");
  const emailRow = rows.find((item) => item.step === "email_copy");

  if (framingRow?.status !== "confirmed") return { ok: false, error: "Confirm the outreach narrative first." };
  const narrative = workingNarrative(framingRow);
  if (!narrative.core.trim() || !narrative.key_messages.trim() || !narrative.approach.trim()) {
    return { ok: false, error: "The confirmed narrative needs a core story, key messages and an approach. Rebuild it and confirm it again." };
  }
  if (listRow?.status !== "confirmed") return { ok: false, error: "Confirm the investor list first." };
  const list = asInvestorList(listRow.published);
  if (list.tier_scheme !== "four") {
    return { ok: false, error: "Copy by fund type needs a four-tier investor list. Use Draft with AI for this list." };
  }

  const { rows: outreach, knownLeftOut } = outreachRows(list, await loadOverrides(supabase, clientId));
  const groups = typeGroups(outreach);
  if (groups.core.length + groups.others.length === 0) {
    return { ok: false, error: "No funds are left for outreach on the confirmed list (all excluded or marked as known)." };
  }
  const styles = styleLoad.styles;
  const base = emptyTypedCopy(groups, styles, list.run_id);

  const working = asEmailCopy(emailRow?.draft ?? emailRow?.published);
  const previous: TypedCopy | null = working.copy_version === 2 && working.typed ? working.typed : null;
  const only = options.only && options.only.length > 0 ? new Set(options.only) : null;
  const wanted = (section: CopySection, type: FundTypeKey) => !only || only.has(groupKey(section, type));

  const firstName =
    text(loaded.client.first_name) || text(loaded.client.founder_name).split(/\s+/)[0] || "the founder";
  const rebuilding = emailRow?.status === "changes_requested";
  const asks = rebuilding ? earlierNotes(emailRow?.history ?? [], emailRow?.response ?? null) : "";
  const feedback = feedbackContext(rows, narrative.feedback);

  const shared = [
    `Founder first name (sign the emails with this): ${firstName}`,
    `Company: ${text(loaded.client.company_name)}`,
    "## Outreach narrative",
    `### Core story\n${narrative.core}`,
    `### Key messages\n${narrative.key_messages}`,
    `### Approach\n${narrative.approach}`,
    "## Intake summary",
    intakeSummaryText(interviewResult.ok ? interviewResult.interview : null),
    "## Materials analysis",
    feedback || "No analysis yet.",
    asks
      ? `## What the founder asked to change\nNotes that start with a group key (for example "core:VC" or "others:Angel group") are about that group only.\n${asks}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const types = Array.from(new Set([...base.core, ...base.others].map((group) => group.type)));
  const jobs = types
    .map((type) => {
      const core = base.core.find((group) => group.type === type && wanted("core", type)) ?? null;
      const others = base.others.find((group) => group.type === type && wanted("others", type)) ?? null;
      return { type, core, others };
    })
    .filter((job) => job.core || job.others);

  const results = await Promise.all(
    jobs.map(async ({ type, core, others }) => {
      const tiers = others ? OTHER_TIERS.filter((tier) => others.tiers?.[`${tier}`]) : [];
      const describe = (group: TypedGroupCopy) =>
        `${group.funds} funds${group.merged?.length ? ` (includes ${group.merged.join(", ")})` : ""}`;
      const parts = [
        shared,
        `# Fund type: ${type}`,
        core
          ? `## Job 1: Core, ${describe(core)}\n${styleInstructions(presetFor(styles, "core", type))}`
          : "",
        others
          ? `## Job 2: Sphere, Tier 3 and Tier 4, ${describe(others)}: ${tiers
              .map((tier) => `${OTHER_TIER_LABEL[tier]} ${others.tiers?.[`${tier}`] ?? 0}`)
              .join(", ")}\n${styleInstructions(presetFor(styles, "others", type))}`
          : "",
      ].filter(Boolean);
      const tool = typedTool(Boolean(core), tiers);
      const result = await callClaudeAgent<Record<string, unknown>>({
        system: promptSystem(prompt.value),
        content: [{ type: "text", text: `${parts.join("\n\n")}\n\nWrite the copy for ${type} by calling the ${tool.name} tool.` }],
        tool,
        maxTokens: 6000,
      });
      return { type, core, others, tiers, result };
    }),
  );

  const drafted: string[] = [];
  const failed: { key: string; error: string }[] = [];
  const fresh = new Map<string, TypedGroupCopy>();

  for (const { type, core, others, tiers, result } of results) {
    if (!result.ok) {
      if (core) failed.push({ key: groupKey("core", type), error: result.reason });
      if (others) failed.push({ key: groupKey("others", type), error: result.reason });
      continue;
    }
    const input = result.input;
    if (core) {
      const raw = (input.core && typeof input.core === "object" ? input.core : {}) as Record<string, unknown>;
      const emails = typedEmails(raw.emails);
      if (emails.some((email) => !email.body.trim())) {
        failed.push({ key: groupKey("core", type), error: "Claude returned an incomplete sequence." });
      } else {
        fresh.set(groupKey("core", type), { ...core, approach: text(raw.approach).slice(0, 4000), emails });
        drafted.push(groupKey("core", type));
      }
    }
    if (others) {
      const raw = (input.others && typeof input.others === "object" ? input.others : {}) as Record<string, unknown>;
      const emails = typedEmails(raw.emails);
      const linesRaw = (raw.tier_lines && typeof raw.tier_lines === "object" ? raw.tier_lines : {}) as Record<string, unknown>;
      const tier_lines: NonNullable<TypedGroupCopy["tier_lines"]> = {};
      for (const tier of tiers) {
        const line = text(linesRaw[String(tier)]).trim().slice(0, 600);
        if (line) tier_lines[`${tier}`] = line;
      }
      if (emails.some((email) => !email.body.trim())) {
        failed.push({ key: groupKey("others", type), error: "Claude returned an incomplete sequence." });
      } else {
        fresh.set(groupKey("others", type), { ...others, emails, tier_lines });
        drafted.push(groupKey("others", type));
      }
    }
  }

  if (drafted.length === 0) {
    return { ok: false, error: failed[0] ? `Nothing was written: ${failed[0].error}` : "Nothing to draft." };
  }

  // Groups not written in this run keep their previous text, with today's counts.
  const merge = (section: CopySection) =>
    base[section].map((group) => {
      const key = groupKey(section, group.type);
      const written = fresh.get(key);
      if (written) return written;
      const before = previous?.[section].find((item) => item.type === group.type);
      return before
        ? { ...before, funds: group.funds, tiers: group.tiers, ...(group.merged ? { merged: group.merged } : {}) }
        : group;
    });

  const typed: TypedCopy = {
    core: merge("core"),
    others: merge("others"),
    // A full draft takes today's opt-out line; a partial one keeps the copy's own.
    opt_out_line: only && previous ? previous.opt_out_line : styles.opt_out_line,
    ...(list.run_id ? { run_id: list.run_id } : {}),
  };
  const copy = asEmailCopy({
    ...working,
    tier_scheme: "four",
    copy_version: 2,
    typed,
    admin_note: working.admin_note,
  });
  return { ok: true, value: { copy, drafted, failed, knownLeftOut: knownLeftOut.length } };
}

/**
 * What the outreach writers know about the company: the confirmed narrative,
 * the intake summary and the analysis. Shared by the Core research and writer.
 */
export async function outreachCompanyContext(
  supabase: ServiceClient,
  clientId: string,
): Promise<AgentResult<{ firstName: string; company: string; text: string; intake: string }>> {
  const [loaded, interviewResult, grouped] = await Promise.all([
    loadClient(supabase, clientId),
    loadInterview(supabase, clientId),
    loadSetupSteps(supabase, [clientId]),
  ]);
  if (!loaded.ok) return loaded;
  const rows = grouped.get(clientId) ?? [];
  const framingRow = rows.find((item) => item.step === "framing");
  if (framingRow?.status !== "confirmed") return { ok: false, error: "Confirm the outreach narrative first." };
  const narrative = workingNarrative(framingRow);
  const firstName =
    text(loaded.client.first_name) || text(loaded.client.founder_name).split(/\s+/)[0] || "the founder";
  const intake = intakeSummaryText(interviewResult.ok ? interviewResult.interview : null);
  const company = text(loaded.client.company_name);
  const body = [
    `Founder first name (sign the emails with this): ${firstName}`,
    `Company: ${company}`,
    "## Outreach narrative",
    `### Core story\n${narrative.core}`,
    `### Key messages\n${narrative.key_messages}`,
    `### Approach\n${narrative.approach}`,
    "## Intake summary",
    intake,
    "## Materials analysis",
    feedbackContext(rows, narrative.feedback) || "No analysis yet.",
  ].join("\n\n");
  return { ok: true, value: { firstName, company, text: body, intake } };
}
