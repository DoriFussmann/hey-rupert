import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { callClaudeAgent, webFetchTool, webSearchTool, type ClaudeContentBlock, type ClaudeTool } from "@/lib/anthropic";
import { clientLinks } from "@/lib/agents-server";
import {
  ABSTRACT_HINT,
  BRIEF_TOPICS_SLUG,
  DEFAULT_BRIEF_TOPICS,
  QUESTIONS_HINT,
  SELLING_POINTS,
  SELLING_POINTS_SLUG,
  parseSellingPoints,
  type SellingPoint,
  type PointScore,
  SELLING_POINTS_CHOSEN,
  asPoints,
  briefKeys,
  emptyPoints,
  parseBriefTopics,
  sectionTitle,
  topPoints,
  type BriefTopic,
  type SellingPoints,
  DECK_TOPICS,
  DECK_TOPICS_PER_CLIENT,
  applyProposal,
  asDeck,
  asProposals,
  asSections,
  briefText,
  deckTopic,
  emptyDeck,
  emptySections,
  stripCitations,
  topTopics,
  type BriefProposal,
  type BriefSections,
  type CompanyBrief,
  type DeckFeedback,
  type FounderQuestion,
  type FramingMessage,
} from "@/lib/brief";
import { conflictLine, intakeMessageText } from "@/lib/intake";
import { buildClientContext, loadInterview } from "@/lib/intake-server";
import { labelledAnswers } from "@/lib/material-fields";
import { loadMaterialFields } from "@/lib/material-fields-server";
import { prepareFiles } from "@/lib/material-files-server";
import { profileText } from "@/lib/match/shared";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import { asMaterials, type MaterialFile } from "@/lib/setup";
import { loadSetupSteps } from "@/lib/setup-server";

// The Company Brief and the Framing Room, server side: loading and saving
// brief versions, building the brief, the chat, pinning, deck feedback and
// the founder's questions. Nothing here sends email.

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const BRIEF_MIGRATION_MISSING =
  "The Company Brief tables aren't set up yet: run supabase/company_brief.sql in Supabase.";

function tableError(message: string, code?: string) {
  if (/brief_files/i.test(message)) return "The LinkedIn upload isn't set up yet: run supabase/brief_linkedin.sql in Supabase.";
  return code === "42P01" || /company_briefs|framing_messages|founder_questions|schema cache/i.test(message)
    ? BRIEF_MIGRATION_MISSING
    : message;
}

// ---------------------------------------------------------------------------
// The founder's LinkedIn: uploaded by Rupert as a PDF (AI can't read LinkedIn)

export type BriefFiles = { linkedin: MaterialFile[]; skipped: boolean };

export async function loadBriefFiles(supabase: ServiceClient, clientId: string): Promise<Result<BriefFiles>> {
  const { data, error } = await supabase.from("brief_files").select("*").eq("client_id", clientId).order("created_at", { ascending: true });
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  const rows = data ?? [];
  return {
    ok: true,
    value: {
      linkedin: rows
        .filter((row) => row.kind === "linkedin")
        .map((row) => ({
          path: String(row.path),
          name: String(row.name),
          size: Number(row.size) || 0,
          type: String(row.type),
          uploaded_at: String(row.created_at),
          added_by: "admin" as const,
        })),
      skipped: rows.some((row) => row.kind === "linkedin_skipped"),
    },
  };
}

export async function addLinkedinFile(
  supabase: ServiceClient,
  clientId: string,
  file: { path: string; name: string; size: number; type: string },
  actor: string | null,
): Promise<Result<BriefFiles>> {
  if (!file.path.startsWith(`${clientId}/linkedin/`)) return { ok: false, error: "That upload doesn't belong to this client." };
  const { error } = await supabase.from("brief_files").insert({
    client_id: clientId,
    kind: "linkedin",
    path: file.path,
    name: file.name.slice(0, 200),
    size: file.size,
    type: file.type.slice(0, 100),
    created_by: actor,
  });
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  await supabase.from("brief_files").delete().eq("client_id", clientId).eq("kind", "linkedin_skipped");
  await supabase.from("notifications").update({ read: true }).eq("client_id", clientId).eq("type", "linkedin_needed");
  return loadBriefFiles(supabase, clientId);
}

export async function skipLinkedin(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<BriefFiles>> {
  const { error } = await supabase.from("brief_files").insert({ client_id: clientId, kind: "linkedin_skipped", created_by: actor });
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  await supabase.from("notifications").update({ read: true }).eq("client_id", clientId).eq("type", "linkedin_needed");
  return loadBriefFiles(supabase, clientId);
}

export async function removeLinkedinFile(supabase: ServiceClient, clientId: string, path: string): Promise<Result<BriefFiles>> {
  const { error } = await supabase.from("brief_files").delete().eq("client_id", clientId).eq("kind", "linkedin").eq("path", path);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return loadBriefFiles(supabase, clientId);
}

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

// ---------------------------------------------------------------------------
// Versions

function asBrief(row: Record<string, unknown>): CompanyBrief {
  return {
    version: Number(row.version) || 0,
    sections: asSections(row.sections),
    points: asPoints(row.points),
    deck: asDeck(row.deck),
    note: text(row.note),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export async function loadBrief(supabase: ServiceClient, clientId: string): Promise<Result<CompanyBrief | null>> {
  const { data, error } = await supabase
    .from("company_briefs")
    .select("*")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: data ? asBrief(data as Record<string, unknown>) : null };
}

export type BriefVersionRow = { version: number; note: string; createdBy: string | null; createdAt: string };

export async function listBriefVersions(supabase: ServiceClient, clientId: string): Promise<Result<BriefVersionRow[]>> {
  const { data, error } = await supabase
    .from("company_briefs")
    .select("version, note, created_by, created_at")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return {
    ok: true,
    value: (data ?? []).map((row) => ({
      version: Number(row.version),
      note: text(row.note),
      createdBy: row.created_by ? String(row.created_by) : null,
      createdAt: String(row.created_at),
    })),
  };
}

/** Saves a new version. Fields left out are kept from the latest version. */
export async function saveBrief(
  supabase: ServiceClient,
  clientId: string,
  change: { sections?: BriefSections; points?: SellingPoints; deck?: DeckFeedback; note: string; actor: string | null },
): Promise<Result<CompanyBrief>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await loadBrief(supabase, clientId);
    if (!latest.ok) return latest;
    const row = {
      client_id: clientId,
      version: (latest.value?.version ?? 0) + 1,
      sections: change.sections ?? latest.value?.sections ?? emptySections(),
      points: change.points ?? latest.value?.points ?? emptyPoints(),
      deck: change.deck ?? latest.value?.deck ?? emptyDeck(),
      note: change.note.slice(0, 300),
      created_by: change.actor,
    };
    const { data, error } = await supabase.from("company_briefs").insert(row).select("*").single();
    if (!error && data) return { ok: true, value: asBrief(data as Record<string, unknown>) };
    // Someone saved at the same moment: try again on top of theirs.
    if (error?.code !== "23505") return { ok: false, error: tableError(error?.message ?? "Not saved.", error?.code) };
  }
  return { ok: false, error: "The brief changed meanwhile. Refresh and try again." };
}

export async function loadBriefVersion(supabase: ServiceClient, clientId: string, version: number): Promise<Result<CompanyBrief | null>> {
  const { data, error } = await supabase
    .from("company_briefs")
    .select("*")
    .eq("client_id", clientId)
    .eq("version", version)
    .maybeSingle();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: data ? asBrief(data as Record<string, unknown>) : null };
}

// ---------------------------------------------------------------------------
// What Rupert knows: the sources every brief call reads

type Sources = {
  text: string;
  files: MaterialFile[];
  linkedin: MaterialFile[];
  links: string[];
  hasIntake: boolean;
  materialsIn: boolean;
};

export async function loadSources(supabase: ServiceClient, clientId: string): Promise<Result<Sources>> {
  const [client, interviewResult, grouped, fields, profile, answers] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
    loadInterview(supabase, clientId),
    loadSetupSteps(supabase, [clientId]),
    loadMaterialFields(supabase),
    supabase.from("match_profiles").select("answers").eq("client_id", clientId).maybeSingle(),
    loadFounderQuestions(supabase, clientId),
  ]);
  const briefFiles = await loadBriefFiles(supabase, clientId);
  const linkedin = briefFiles.ok ? briefFiles.value.linkedin : [];
  if (client.error) return { ok: false, error: client.error.message };
  if (!client.data) return { ok: false, error: "Client not found." };
  const interview = interviewResult.ok ? interviewResult.interview : null;
  const materialsRow = (grouped.get(clientId) ?? []).find((row) => row.step === "materials");
  const materials = asMaterials(materialsRow?.published ?? materialsRow?.draft);
  const links = clientLinks(materials.fields);
  const written = labelledAnswers(fields, materials.fields);
  const answered = answers.ok ? answers.value.filter((item) => item.answer) : [];

  const parts = [
    "## Client record",
    buildClientContext(client.data as Record<string, unknown>),
    "## Company profile (used for matching)",
    profileText(profile.data?.answers) || "None yet.",
    "## Intake: the founder's confirmed summary",
    interview?.summary?.length ? interview.summary.map((item) => `${item.title}: ${item.answer}`).join("\n") : "Not confirmed yet.",
    interview?.conflicts?.length
      ? `## Where the founder's files and answers disagreed\n${interview.conflicts.map((item) => `- ${conflictLine(item)}`).join("\n")}`
      : "",
    "## Intake transcript",
    interview?.messages?.length
      ? interview.messages.map((message) => `${message.role === "user" ? "Founder" : "Rupert"}: ${intakeMessageText(message)}`).join("\n\n")
      : "No interview on record.",
    written.length > 0 ? `## The founder's written answers\n${written.map((item) => `${item.label}: ${item.value}`).join("\n")}` : "",
    materials.no_deck ? `## No deck yet\n${materials.no_deck}` : "",
    `## Files the founder shared\n${materials.files.length > 0 ? materials.files.map((file) => `- ${file.name}`).join("\n") : "None."}`,
    `## Links the founder provided\n${links.length > 0 ? links.join("\n") : "None."}`,
    linkedin.length > 0
      ? `## The founder's LinkedIn profile\nAttached as PDF, added by Rupert (LinkedIn can't be opened from here): ${linkedin.map((file) => file.name).join(", ")}. Self-reported: check outcomes against dates.`
      : "",
    answered.length > 0
      ? `## The founder's answers to Rupert's questions\n${answered.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n")}`
      : "",
  ];
  return {
    ok: true,
    value: {
      text: parts.filter(Boolean).join("\n\n"),
      files: materials.files,
      linkedin,
      links,
      hasIntake: Boolean(interview?.completed_at || interview?.messages?.length),
      materialsIn: materialsRow?.status === "submitted",
    },
  };
}

// ---------------------------------------------------------------------------
// Build the brief

/** The brief's topics as Dori set them under Forms → Brief topics, else the defaults. */
export async function loadBriefTopics(supabase: ServiceClient): Promise<BriefTopic[]> {
  const { data } = await supabase.from("form_templates").select("content").eq("slug", BRIEF_TOPICS_SLUG).maybeSingle();
  if (!data?.content) return DEFAULT_BRIEF_TOPICS;
  try {
    return parseBriefTopics(JSON.parse(String(data.content))) ?? DEFAULT_BRIEF_TOPICS;
  } catch {
    return DEFAULT_BRIEF_TOPICS;
  }
}

function briefTool(topics: BriefTopic[]): ClaudeTool {
  const properties: Record<string, unknown> = { abstract: { type: "string", description: `Abstract (markdown bullets). ${ABSTRACT_HINT}` } };
  for (const topic of topics.filter((item) => item.enabled)) {
    properties[topic.id] = { type: "string", description: `${topic.title} (markdown, brief and punchy). ${topic.guidance}` };
  }
  properties.questions = { type: "string", description: QUESTIONS_HINT };
  return {
    name: "submit_brief",
    description: "Deliver the Company Brief: the abstract, every topic, and the questions, in markdown.",
    input_schema: { type: "object", properties, required: Object.keys(properties) },
  };
}

function topicsGuide(topics: BriefTopic[]) {
  return topics
    .filter((topic) => topic.enabled)
    .map((topic) => `- ${topic.title} (${topic.id}): ${topic.guidance}`)
    .join("\n");
}

export async function buildBrief(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<CompanyBrief>> {
  const [sources, prompt, topics] = await Promise.all([
    loadSources(supabase, clientId),
    loadPrompt(supabase, "company_brief", { clientId, purpose: "Company brief", actor }),
    loadBriefTopics(supabase),
  ]);
  const tool = briefTool(topics);
  if (!sources.ok) return sources;
  if (!prompt.ok) return prompt;
  if (!sources.value.hasIntake) return { ok: false, error: "The intake hasn't started yet: there is nothing to build the brief from." };

  const files = await prepareFiles(supabase, [...sources.value.files, ...sources.value.linkedin]);
  const links = sources.value.links;
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content: [
      { type: "text", text: sources.value.text },
      ...files.blocks,
      ...(files.skipped.length > 0 ? [{ type: "text", text: `Files that couldn't be read: ${files.skipped.join(" ")}` }] : []),
      {
        type: "text",
        text: `Read everything above. Research the founder and the company on the web: always search the founder by full name (alone, and with words from their background such as their prior companies, industry or city) to find each prior company, role, years and outcome (acquirer, scale run); then the company, its press and its competitors.${links.length > 0 ? " You may open the founder's links with web_fetch." : ""} Then deliver the brief by calling the ${tool.name} tool: the abstract, then each topic below (what to summarise for each), then the questions.\n\n# The topics\n${topicsGuide(topics)}`,
      },
    ],
    tool,
    serverTools: [webSearchTool(8), ...(links.length > 0 ? [webFetchTool(Math.min(links.length, 6))] : [])],
    maxTokens: 16000,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const sections = asSections(result.input);
  const empty = briefKeys(topics).filter((key) => !(sections[key] ?? "").trim()).map((key) => sectionTitle(key, topics));
  if (empty.length > 3) return { ok: false, error: `Claude's brief had no ${empty.join(", ")}. Nothing was saved. Try again.` };
  return saveBrief(supabase, clientId, {
    sections,
    note: result.serverToolsSkipped ? "Built from the intake and files (web search unavailable)." : "Built from the intake, files and web research.",
    actor,
  });
}

// ---------------------------------------------------------------------------
// The Framing Room chat

function asMessage(row: Record<string, unknown>): FramingMessage {
  const pinned = Array.isArray(row.pinned) ? row.pinned.map((id) => String(id)) : [];
  const attachments = Array.isArray(row.attachments)
    ? row.attachments
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
        .map((item) => ({ name: text(item.name), path: text(item.path), size: Number(item.size) || 0, type: text(item.type) }))
        .filter((item) => item.path)
    : [];
  return {
    id: String(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    content: stripCitations(String(row.content ?? "")),
    proposals: asProposals(row.proposals),
    pinned,
    attachments,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export async function loadFramingMessages(supabase: ServiceClient, clientId: string): Promise<Result<FramingMessage[]>> {
  const { data, error } = await supabase
    .from("framing_messages")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .limit(400);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: (data ?? []).map((row) => asMessage(row as Record<string, unknown>)) };
}

function chatTool(keys: string[]): ClaudeTool {
  return {
  name: "reply",
  description: "Answer Dori, and propose changes to the brief worth keeping.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "Your answer to Dori (markdown). Brief and direct; sources for anything you looked up." },
      proposals: {
        type: "array",
        description: "Changes to the brief worth keeping, if any. Empty when nothing new was decided or learned.",
        items: {
          type: "object",
          properties: {
            section: { type: "string", enum: keys, description: "abstract, a topic id, or questions." },
            mode: { type: "string", enum: ["replace", "append"], description: "replace: the section's full new text. append: added at the end." },
            content: { type: "string", description: "The text (markdown), in the brief's style." },
            why: { type: "string", description: "One short sentence on why." },
          },
          required: ["section", "mode", "content", "why"],
        },
      },
    },
    required: ["reply", "proposals"],
  },
};
}

const HISTORY_MESSAGES = 30;

/** Saves Dori's message, gets Rupert's reply (with proposals), saves it. */
export async function sendFramingMessage(
  supabase: ServiceClient,
  clientId: string,
  input: { content: string; attachments: MaterialFile[]; actor: string | null },
): Promise<Result<FramingMessage[]>> {
  const content = input.content.trim().slice(0, 8000);
  if (!content && input.attachments.length === 0) return { ok: false, error: "Write a message first." };

  const [sources, brief, history, prompt, topics] = await Promise.all([
    loadSources(supabase, clientId),
    loadBrief(supabase, clientId),
    loadFramingMessages(supabase, clientId),
    loadPrompt(supabase, "framing_room", { clientId, purpose: "Framing Room", actor: input.actor }),
    loadBriefTopics(supabase),
  ]);
  const CHAT_TOOL = chatTool(briefKeys(topics));
  if (!sources.ok) return sources;
  if (!brief.ok) return brief;
  if (!history.ok) return history;
  if (!prompt.ok) return prompt;

  const attachments = input.attachments.map((file) => ({ name: file.name, path: file.path, size: file.size, type: file.type }));
  const saved = await supabase
    .from("framing_messages")
    .insert({ client_id: clientId, role: "user", content, attachments, created_by: input.actor });
  if (saved.error) return { ok: false, error: tableError(saved.error.message, saved.error.code) };

  const files = attachments.length > 0 ? await prepareFiles(supabase, input.attachments) : { blocks: [], read: [], skipped: [] };
  const earlier = history.value.slice(-HISTORY_MESSAGES).map((message) => {
    const pinned = message.proposals.filter((proposal) => message.pinned.includes(proposal.id));
    const files = message.attachments.length > 0 ? ` [attached: ${message.attachments.map((file) => file.name).join(", ")}]` : "";
    const pins = pinned.length > 0 ? `\n(Pinned to the brief: ${pinned.map((proposal) => proposal.section).join(", ")})` : "";
    return `${message.role === "user" ? "Dori" : "Rupert"}${files}: ${message.content}${pins}`;
  });

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content: [
      { type: "text", text: `# The Company Brief as it stands\n\n${brief.value ? briefText(brief.value.sections, topics, brief.value.points) : "(not built yet)"}` },
      { type: "text", text: `# What Rupert knows\n\n${sources.value.text}` },
      { type: "text", text: `# The conversation so far\n\n${earlier.length > 0 ? earlier.join("\n\n") : "(none)"}` },
      ...files.blocks,
      ...(files.skipped.length > 0 ? [{ type: "text", text: `Attached but not readable: ${files.skipped.join(" ")}` }] : []),
      { type: "text", text: `# Dori's message\n\n${content || "(see the attached files)"}\n\nAnswer by calling the ${CHAT_TOOL.name} tool.` },
    ] as ClaudeContentBlock[],
    tool: CHAT_TOOL,
    serverTools: [webSearchTool(5)],
    maxTokens: 8000,
  });
  const reply = result.ok
    ? { content: stripCitations(text(result.input.reply)) || "(no reply)", proposals: asProposals(result.input.proposals) }
    : { content: `I couldn't answer: ${result.reason}`, proposals: [] as BriefProposal[] };
  const stored = await supabase.from("framing_messages").insert({
    client_id: clientId,
    role: "assistant",
    content: reply.content,
    proposals: reply.proposals.map((proposal, index) => ({ ...proposal, id: `p${Date.now().toString(36)}${index}` })),
    created_by: null,
  });
  if (stored.error) return { ok: false, error: tableError(stored.error.message, stored.error.code) };
  return loadFramingMessages(supabase, clientId);
}

/** Applies one of Rupert's proposals to the brief, as a new version. */
export async function pinProposal(
  supabase: ServiceClient,
  clientId: string,
  messageId: string,
  proposalId: string,
  actor: string | null,
): Promise<Result<CompanyBrief>> {
  const { data, error } = await supabase
    .from("framing_messages")
    .select("*")
    .eq("id", messageId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data) return { ok: false, error: "Message not found." };
  const message = asMessage(data as Record<string, unknown>);
  const proposal = message.proposals.find((item) => item.id === proposalId);
  if (!proposal) return { ok: false, error: "That proposal is gone." };
  const topics = await loadBriefTopics(supabase);
  if (!briefKeys(topics).includes(proposal.section)) return { ok: false, error: "That part of the brief no longer exists." };
  if (message.pinned.includes(proposalId)) return { ok: false, error: "Already pinned." };
  const brief = await loadBrief(supabase, clientId);
  if (!brief.ok) return brief;
  const sections = applyProposal(brief.value?.sections ?? emptySections(), proposal);
  const title = sectionTitle(proposal.section, topics);
  const saved = await saveBrief(supabase, clientId, { sections, note: `Pinned to ${title}: ${proposal.why}`.slice(0, 300), actor });
  if (!saved.ok) return saved;
  await supabase.from("framing_messages").update({ pinned: [...message.pinned, proposalId] }).eq("id", messageId);
  return saved;
}

// ---------------------------------------------------------------------------
// The three strongest selling points

function pointsTool(list: SellingPoint[]): ClaudeTool {
  return {
  name: "submit_points",
  description: "Score every selling point for this raise, with the reason and what to say.",
  input_schema: {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            point: { type: "string", enum: list.map((point) => point.id) },
            score: { type: "integer", minimum: 0, maximum: 10 },
            reason: { type: "string", description: "One sentence: why this score, from the facts." },
            pitch: { type: "string", description: "What to say about it to an investor: one or two sentences, only true, specific facts." },
          },
          required: ["point", "score", "reason", "pitch"],
        },
      },
    },
    required: ["scores"],
  },
};
}

/** The selling points as Dori set them under Agents → Selling points, else the defaults. */
export async function loadSellingPoints(supabase: ServiceClient): Promise<SellingPoint[]> {
  const { data } = await supabase.from("form_templates").select("content").eq("slug", SELLING_POINTS_SLUG).maybeSingle();
  if (!data?.content) return SELLING_POINTS;
  try {
    return parseSellingPoints(JSON.parse(String(data.content))) ?? SELLING_POINTS;
  } catch {
    return SELLING_POINTS;
  }
}

export async function scoreSellingPoints(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<CompanyBrief>> {
  const [brief, prompt, topics, sellingPoints] = await Promise.all([
    loadBrief(supabase, clientId),
    loadPrompt(supabase, "selling_points", { clientId, purpose: "Selling points", actor }),
    loadBriefTopics(supabase),
    loadSellingPoints(supabase),
  ]);
  const POINTS_TOOL = pointsTool(sellingPoints);
  if (!brief.ok) return brief;
  if (!prompt.ok) return prompt;
  if (!brief.value) return { ok: false, error: "Build the brief first." };
  const list = sellingPoints.map((point) => `- ${point.id}: ${point.title}. ${point.guidance}`).join("\n");
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content: [
      { type: "text", text: `# The selling points\n\n${list}` },
      { type: "text", text: `# The Company Brief\n\n${briefText(brief.value.sections, topics)}` },
      { type: "text", text: `Score all ${sellingPoints.length} selling points for this raise by calling the ${POINTS_TOOL.name} tool.` },
    ],
    tool: POINTS_TOOL,
    maxTokens: 5000,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const known = new Map(sellingPoints.map((point) => [point.id, point.title]));
  const scored = (Array.isArray(result.input.scores) ? result.input.scores : [])
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
    .filter((item) => known.has(String(item.point)))
    .map((item): Record<string, unknown> => ({ ...item, title: known.get(String(item.point)) }));
  // In the list's order, so ties go to the earlier point.
  scored.sort((a, b) => sellingPoints.findIndex((p) => p.id === a.point) - sellingPoints.findIndex((p) => p.id === b.point));
  const points = asPoints({ scores: scored });
  if (points.scores.length < sellingPoints.length / 2) return { ok: false, error: "Claude scored too few selling points. Nothing was saved. Try again." };
  const chosen = topPoints(points.scores);
  return saveBrief(supabase, clientId, {
    points: { ...points, chosen, scored_at: new Date().toISOString() },
    note: `Selling points scored. Top 3: ${chosen.map((id) => known.get(id)).join(", ")}.`,
    actor,
  });
}

/** Dori's choice of the three points, and her edits to what to say. */
export async function saveSellingPoints(
  supabase: ServiceClient,
  clientId: string,
  change: {
    chosen: string[];
    pitches: Record<string, string>;
    scores?: Record<string, number>;
    titles?: Record<string, string>;
    /** true confirms the top 3; anything else leaves them a draft (an edit unconfirms). */
    confirm?: boolean;
  },
  actor: string | null,
): Promise<Result<CompanyBrief>> {
  const brief = await loadBrief(supabase, clientId);
  if (!brief.ok) return brief;
  const current = brief.value?.points ?? emptyPoints();
  // Scores Rupert overrides replace the AI's; the order of chosen is the order he set (#1 first).
  const scoreFor = (item: PointScore) => {
    const value = change.scores?.[item.point];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(10, Math.round(value))) : item.score;
  };
  const points = asPoints({
    ...current,
    chosen: change.chosen,
    scores: current.scores.map((item) => ({
      ...item,
      score: scoreFor(item),
      title: change.titles?.[item.point]?.trim() || item.title,
      pitch: change.pitches[item.point] ?? item.pitch,
    })),
    confirmed_at: change.confirm ? new Date().toISOString() : null,
  });
  if (change.confirm && points.chosen.length < SELLING_POINTS_CHOSEN) {
    return { ok: false, error: `Choose ${SELLING_POINTS_CHOSEN} selling points before confirming.` };
  }
  return saveBrief(supabase, clientId, {
    points,
    note: `Selling points${points.confirmed_at ? " confirmed" : ""}: ${points.chosen.map((id) => points.scores.find((item) => item.point === id)?.title ?? id).join(", ")}.`,
    actor,
  });
}

// ---------------------------------------------------------------------------
// Deck feedback

const SCORE_TOOL: ClaudeTool = {
  name: "submit_scores",
  description: "Score every topic for this deck.",
  input_schema: {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string", enum: DECK_TOPICS.map((topic) => topic.id) },
            score: { type: "integer", minimum: 0, maximum: 10 },
            reason: { type: "string", description: "One sentence, citing slides." },
          },
          required: ["topic", "score", "reason"],
        },
      },
    },
    required: ["scores"],
  },
};

const WRITE_TOOL: ClaudeTool = {
  name: "submit_feedback",
  description: "Deliver the founder-facing feedback for each chosen topic.",
  input_schema: {
    type: "object",
    properties: {
      writeups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string", enum: DECK_TOPICS.map((topic) => topic.id) },
            body: { type: "string", description: "Markdown, 120 to 250 words, to the founder." },
          },
          required: ["topic", "body"],
        },
      },
    },
    required: ["writeups"],
  },
};

function playbooks(ids?: string[]) {
  return DECK_TOPICS.filter((topic) => !ids || ids.includes(topic.id))
    .map((topic) => `### ${topic.id}: ${topic.title}\n${topic.playbook}`)
    .join("\n\n");
}

async function deckContext(supabase: ServiceClient, clientId: string, actor: string | null) {
  const [sources, brief, prompt, topics] = await Promise.all([
    loadSources(supabase, clientId),
    loadBrief(supabase, clientId),
    loadPrompt(supabase, "deck_feedback", { clientId, purpose: "Deck feedback", actor }),
    loadBriefTopics(supabase),
  ]);
  if (!sources.ok) return sources;
  if (!brief.ok) return brief;
  if (!prompt.ok) return prompt;
  const files = await prepareFiles(supabase, sources.value.files);
  if (files.blocks.length === 0) return { ok: false as const, error: "There is no readable deck or file to give feedback on." };
  const text = brief.value ? briefText(brief.value.sections, topics, brief.value.points) : "(not built yet)";
  return { ok: true as const, sources: sources.value, brief: brief.value, briefText: text, prompt: prompt.value, files };
}

export async function scoreDeck(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<CompanyBrief>> {
  const context = await deckContext(supabase, clientId, actor);
  if (!context.ok) return context;
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(context.prompt),
    content: [
      { type: "text", text: `# Task: scoring\n\n# The topics and their playbooks\n\n${playbooks()}` },
      { type: "text", text: `# The Company Brief\n\n${context.briefText}` },
      ...context.files.blocks,
      { type: "text", text: `Score all ${DECK_TOPICS.length} topics for this founder's deck by calling the ${SCORE_TOOL.name} tool.` },
    ],
    tool: SCORE_TOOL,
    maxTokens: 6000,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const deck = asDeck({ ...(context.brief?.deck ?? emptyDeck()), scores: result.input.scores });
  if (deck.scores.length < DECK_TOPICS.length / 2) return { ok: false, error: "Claude scored too few topics. Nothing was saved. Try again." };
  const chosen = topTopics(deck.scores);
  return saveBrief(supabase, clientId, {
    deck: { ...deck, chosen, writeups: {}, scored_at: new Date().toISOString() },
    note: `Deck scored. Top ${DECK_TOPICS_PER_CLIENT}: ${chosen.map((id) => deckTopic(id)?.title).join(", ")}.`,
    actor,
  });
}

export async function chooseDeckTopics(supabase: ServiceClient, clientId: string, chosen: string[], actor: string | null): Promise<Result<CompanyBrief>> {
  const brief = await loadBrief(supabase, clientId);
  if (!brief.ok) return brief;
  const deck = asDeck({ ...(brief.value?.deck ?? emptyDeck()), chosen });
  return saveBrief(supabase, clientId, { deck, note: `Deck topics: ${deck.chosen.map((id) => deckTopic(id)?.title).join(", ")}.`, actor });
}

export async function writeDeckFeedback(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<CompanyBrief>> {
  const context = await deckContext(supabase, clientId, actor);
  if (!context.ok) return context;
  const chosen = context.brief?.deck.chosen ?? [];
  if (chosen.length === 0) return { ok: false, error: "Score the deck, or choose topics, first." };
  const scores = context.brief?.deck.scores ?? [];
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(context.prompt),
    content: [
      { type: "text", text: `# Task: writing\n\n# The chosen topics and their playbooks\n\n${playbooks(chosen)}` },
      {
        type: "text",
        text: `# Why these topics (from scoring)\n\n${chosen
          .map((id) => `- ${deckTopic(id)?.title}: ${scores.find((item) => item.topic === id)?.reason ?? "chosen by Rupert"}`)
          .join("\n")}`,
      },
      { type: "text", text: `# The Company Brief\n\n${context.briefText}` },
      ...context.files.blocks,
      { type: "text", text: `Write the feedback for these ${chosen.length} topics, in this order: ${chosen.join(", ")}. Deliver it by calling the ${WRITE_TOOL.name} tool.` },
    ],
    tool: WRITE_TOOL,
    maxTokens: 8000,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const writeups: Record<string, string> = {};
  const items = Array.isArray(result.input.writeups) ? result.input.writeups : [];
  for (const item of items) {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = text(entry.topic);
    if (chosen.includes(id) && text(entry.body)) writeups[id] = text(entry.body);
  }
  if (Object.keys(writeups).length === 0) return { ok: false, error: "Claude wrote no feedback. Nothing was saved. Try again." };
  return saveBrief(supabase, clientId, {
    deck: { ...(context.brief?.deck ?? emptyDeck()), writeups },
    note: "Deck feedback written.",
    actor,
  });
}

// ---------------------------------------------------------------------------
// The founder's questions

export async function loadFounderQuestions(supabase: ServiceClient, clientId: string): Promise<Result<FounderQuestion[]>> {
  const { data, error } = await supabase
    .from("founder_questions")
    .select("*")
    .eq("client_id", clientId)
    .order("asked_at", { ascending: true });
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return {
    ok: true,
    value: (data ?? []).map((row) => ({
      id: String(row.id),
      question: text(row.question),
      answer: text(row.answer),
      answeredAt: row.answered_at ? String(row.answered_at) : null,
    })),
  };
}

/**
 * The questions that go with the next narrative: unanswered ones not in the
 * list are withdrawn, new ones are added, answered ones are kept as they are.
 */
export async function setFounderQuestions(supabase: ServiceClient, clientId: string, questions: string[]): Promise<Result<FounderQuestion[]>> {
  const current = await loadFounderQuestions(supabase, clientId);
  if (!current.ok) return current;
  const wanted = questions.map((question) => question.trim()).filter(Boolean);
  const stale = current.value.filter((item) => !item.answer && !wanted.includes(item.question)).map((item) => item.id);
  if (stale.length > 0) {
    const { error } = await supabase.from("founder_questions").delete().in("id", stale).eq("client_id", clientId);
    if (error) return { ok: false, error: tableError(error.message, error.code) };
  }
  const known = new Set(current.value.map((item) => item.question));
  const fresh = wanted.filter((question) => !known.has(question));
  if (fresh.length > 0) {
    const { error } = await supabase.from("founder_questions").insert(fresh.map((question) => ({ client_id: clientId, question })));
    if (error) return { ok: false, error: tableError(error.message, error.code) };
  }
  const after = await loadFounderQuestions(supabase, clientId);
  if (!after.ok) return after;
  return { ok: true, value: after.value.filter((item) => wanted.includes(item.question) && !item.answer) };
}

export async function answerFounderQuestion(
  supabase: ServiceClient,
  clientId: string,
  questionId: string,
  answer: string,
): Promise<Result<FounderQuestion>> {
  const clean = answer.trim().slice(0, 4000);
  if (!clean) return { ok: false, error: "Write an answer first." };
  const { data, error } = await supabase
    .from("founder_questions")
    .update({ answer: clean, answered_at: new Date().toISOString() })
    .eq("id", questionId)
    .eq("client_id", clientId)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data) return { ok: false, error: "That question is no longer open." };
  return { ok: true, value: { id: String(data.id), question: text(data.question), answer: text(data.answer), answeredAt: String(data.answered_at) } };
}

/** Whether the brief can be built yet (the Framing Room builds it the first time it opens). */
export async function briefReadiness(supabase: ServiceClient, clientId: string) {
  const sources = await loadSources(supabase, clientId);
  if (!sources.ok) return { canBuild: false, reason: sources.error, linkedinReady: false };
  if (!sources.value.hasIntake) return { canBuild: false, reason: "The intake hasn't started yet.", linkedinReady: false };
  return {
    canBuild: true,
    reason: sources.value.materialsIn ? null : "The materials aren't submitted yet; the brief will use what's there.",
    linkedinReady: sources.value.linkedin.length > 0,
  };
}

/**
 * Start over: removes the brief (every version), the Framing Room chat, the
 * questions for the founder and a narrative draft that was never sent. The
 * intake, the materials and the links are kept. A narrative already sent to
 * the founder is kept too.
 */
export async function resetBrief(supabase: ServiceClient, clientId: string): Promise<Result<null>> {
  for (const table of ["company_briefs", "framing_messages", "founder_questions", "brief_files"] as const) {
    const { error } = await supabase.from(table).delete().eq("client_id", clientId);
    if (error) return { ok: false, error: tableError(error.message, error.code) };
  }
  const { error } = await supabase.from("setup_steps").delete().eq("client_id", clientId).eq("step", "framing").eq("version", 0);
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: null };
}

/** Everything the brief step needs on the client page. Never fails: errors come back as text. */
export async function loadBriefPanel(supabase: ServiceClient, clientId: string) {
  const [brief, versions, questions, readiness, topics, files, sources, sellingPoints] = await Promise.all([
    loadBrief(supabase, clientId),
    listBriefVersions(supabase, clientId),
    loadFounderQuestions(supabase, clientId),
    briefReadiness(supabase, clientId),
    loadBriefTopics(supabase),
    loadBriefFiles(supabase, clientId),
    loadSources(supabase, clientId),
    loadSellingPoints(supabase),
  ]);
  const linkedinUrls = sources.ok ? linkedinLinks(sources.value.text) : [];
  const failed = [brief, versions, questions].find((item) => !item.ok);
  return {
    brief: brief.ok ? brief.value : null,
    versions: versions.ok ? versions.value : [],
    questions: questions.ok ? questions.value : [],
    topics,
    files: files.ok ? files.value : { linkedin: [], skipped: false },
    filesError: files.ok ? null : files.error,
    linkedinUrls,
    sellingPoints,
    canBuild: readiness.canBuild,
    buildNote: readiness.reason,
    error: failed && !failed.ok ? failed.error : null,
  };
}

/** LinkedIn profile links found in what the founder shared (links form, intake answers). */
export function linkedinLinks(text: string): string[] {
  const found = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?/gi) ?? [];
  const urls = found.map((url) => (url.startsWith("http") ? url : `https://${url}`).replace(/\/$/, ""));
  return Array.from(new Set(urls.map((url) => url.toLowerCase()))).slice(0, 6);
}
