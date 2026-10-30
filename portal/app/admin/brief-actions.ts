"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { isClaudeConfigured } from "@/lib/anthropic";
import {
  asSections,
  BRIEF_TOPICS_SLUG,
  SELLING_POINTS_SLUG,
  parseSellingPoints,
  type SellingPoint,
  briefQuestions,
  parseBriefTopics,
  type BriefTopic,
  deckFeedbackMarkdown,
  type BriefSections,
  type CompanyBrief,
  type FramingMessage,
} from "@/lib/brief";
import {
  buildBrief,
  saveDeck,
  loadBrief,
  loadBriefVersion,
  saveSellingPoints,
  scoreSellingPoints,
  addLinkedinFile,
  pinProposal,
  removeLinkedinFile,
  resetBrief,
  skipLinkedin,
  saveBrief,
  scoreDeck,
  sendFramingMessage,
  setFounderQuestions,
  writeDeckFeedback,
} from "@/lib/brief-server";
import { intakeFileProblem } from "@/lib/intake";
import { safeFileName } from "@/lib/materials-server";
import {
  MATERIALS_BUCKET,
  NARRATIVE_NEXT_STEPS,
  asNarrative,
  asStatement,
  narrativeProblem,
  statementMarkdown,
  type MaterialFile,
  type NarrativePayload,
  type NarrativeStatement,
} from "@/lib/setup";
import { loadSetupStep, nowIso, setupTableError } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;
const CLAUDE_MISSING = "Claude is not configured. Add ANTHROPIC_API_KEY in Vercel.";

async function requireAdmin(clientId: string, claude = false) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (!UUID.test(String(clientId ?? ""))) return { ok: false as const, error: "Unknown client." };
  if (claude && !isClaudeConfigured()) return { ok: false as const, error: CLAUDE_MISSING };
  return { ok: true as const, supabase: createServiceClient(), actor: user.email ?? null };
}

function revalidate(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}/framing`);
  revalidatePath(`/admin/clients/${clientId}`);
}

function withBrief(result: { ok: true; value: CompanyBrief } | { ok: false; error: string }, clientId: string): Result<{ brief: CompanyBrief }> {
  if (!result.ok) return result;
  revalidate(clientId);
  return { ok: true, brief: result.value };
}

export async function buildBriefAction(clientId: string) {
  const access = await requireAdmin(clientId, true);
  if (!access.ok) return access;
  return withBrief(await buildBrief(access.supabase, clientId, access.actor), clientId);
}

/** Dori's own edit to one or more sections. */
export async function saveBriefSectionsAction(clientId: string, sections: BriefSections, note: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  return withBrief(
    await saveBrief(access.supabase, clientId, { sections: asSections(sections), note: String(note || "Edited by hand."), actor: access.actor }),
    clientId,
  );
}

/** Puts an earlier version back, as a new version. */
export async function restoreBriefVersionAction(clientId: string, version: number) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const earlier = await loadBriefVersion(access.supabase, clientId, Number(version));
  if (!earlier.ok) return earlier;
  if (!earlier.value) return { ok: false as const, error: "That version doesn't exist." };
  return withBrief(
    await saveBrief(access.supabase, clientId, {
      sections: earlier.value.sections,
      deck: earlier.value.deck,
      points: earlier.value.points,
      note: `Restored version ${earlier.value.version}.`,
      actor: access.actor,
    }),
    clientId,
  );
}

export async function sendFramingMessageAction(
  clientId: string,
  content: string,
  attachments: { path: string; name: string; size: number; type: string }[],
): Promise<Result<{ messages: FramingMessage[] }>> {
  const access = await requireAdmin(clientId, true);
  if (!access.ok) return access;
  const files: MaterialFile[] = (Array.isArray(attachments) ? attachments : [])
    .filter((file) => String(file?.path ?? "").startsWith(`${clientId}/framing/`))
    .slice(0, 5)
    .map((file) => ({
      path: String(file.path),
      name: String(file.name || "file"),
      size: Number(file.size) || 0,
      type: String(file.type || ""),
      uploaded_at: nowIso(),
      added_by: "admin" as const,
    }));
  const result = await sendFramingMessage(access.supabase, clientId, { content: String(content ?? ""), attachments: files, actor: access.actor });
  if (!result.ok) return result;
  revalidate(clientId);
  return { ok: true, messages: result.value };
}

export async function pinProposalAction(clientId: string, messageId: string, proposalId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  return withBrief(await pinProposal(access.supabase, clientId, String(messageId), String(proposalId), access.actor), clientId);
}

/** Step 1 of attaching a file in the Framing Room: a one-time upload URL in the client's framing folder. */
export async function createFramingUploadAction(clientId: string, file: { name: string; size: number }): Promise<Result<{ path: string; token: string }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const name = String(file?.name ?? "").trim();
  const problem = intakeFileProblem({ name, size: Number(file?.size) || 0 });
  if (problem) return { ok: false, error: problem };
  const path = `${clientId}/framing/${randomUUID()}/${safeFileName(name)}`;
  const { data, error } = await access.supabase.storage.from(MATERIALS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: `Upload could not start: ${error?.message ?? "unknown error"}.` };
  return { ok: true, path: data.path, token: data.token };
}

export async function scoreDeckAction(clientId: string) {
  const access = await requireAdmin(clientId, true);
  if (!access.ok) return access;
  return withBrief(await scoreDeck(access.supabase, clientId, access.actor), clientId);
}

export async function writeDeckFeedbackAction(clientId: string, onlyMissing = false) {
  const access = await requireAdmin(clientId, true);
  if (!access.ok) return access;
  return withBrief(await writeDeckFeedback(access.supabase, clientId, access.actor, onlyMissing === true), clientId);
}

/**
 * Rupert's edits to the Company Materials Feedback. Confirming puts it, with
 * its links and documents, on the narrative's send step.
 */
export async function saveDeckAction(
  clientId: string,
  change: {
    chosen: string[];
    writeups: Record<string, string>;
    scores: Record<string, number>;
    links: Record<string, unknown>;
    files: Record<string, unknown>;
    confirm: boolean;
  },
) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const raw = change && typeof change === "object" ? change : ({} as typeof change);
  const writeups: Record<string, string> = {};
  for (const [id, body] of Object.entries(raw.writeups && typeof raw.writeups === "object" ? raw.writeups : {})) writeups[String(id)] = String(body ?? "").slice(0, 20000);
  const scores: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw.scores && typeof raw.scores === "object" ? raw.scores : {})) {
    const number = Number(value);
    if (Number.isFinite(number)) scores[String(id)] = Math.max(0, Math.min(10, Math.round(number)));
  }
  // Documents must be this client's uploads.
  const files: Record<string, unknown> = {};
  for (const [id, list] of Object.entries(raw.files && typeof raw.files === "object" ? raw.files : {})) {
    files[String(id)] = (Array.isArray(list) ? list : []).filter(
      (item) => item && typeof item === "object" && String((item as Record<string, unknown>).path ?? "").startsWith(`${clientId}/`),
    );
  }
  const before = await loadBrief(access.supabase, clientId);
  if (!before.ok) return before;
  const saved = await saveDeck(
    access.supabase,
    clientId,
    {
      chosen: Array.isArray(raw.chosen) ? raw.chosen.map(String) : [],
      writeups,
      scores,
      links: raw.links && typeof raw.links === "object" ? raw.links : {},
      files,
      confirm: raw.confirm === true,
    },
    access.actor,
  );
  if (!saved.ok) return saved;
  if (saved.value.deck.confirmed_at) {
    const deck = saved.value.deck;
    const previousDeckPaths = new Set(Object.values(before.value?.deck.files ?? {}).flat().map((file) => file.path));
    const deckFiles = deck.chosen.flatMap((id) => deck.files[id] ?? []);
    const patched = await patchNarrativeDraft(access.supabase, clientId, (draft) => ({
      feedback: { summary: "", improvements: deckFeedbackMarkdown(deck), generated_at: nowIso(), read: [], skipped: [] },
      attachments: [
        ...draft.attachments.filter((file) => !previousDeckPaths.has(file.path) && !deckFiles.some((item) => item.path === file.path)),
        ...deckFiles,
      ],
    }));
    if (!patched.ok) return patched;
  }
  return withBrief(saved, clientId);
}

/** Reads the narrative draft, applies a patch and saves it (no push). */
async function patchNarrativeDraft(
  supabase: ReturnType<typeof createServiceClient>,
  clientId: string,
  patch: (draft: NarrativePayload) => Partial<NarrativePayload> & Record<string, unknown>,
): Promise<Result<{ narrative: NarrativePayload }>> {
  const existing = await loadSetupStep(supabase, clientId, "framing");
  if (!existing.ok) return existing;
  const previous = existing.row?.draft && typeof existing.row.draft === "object" ? (existing.row.draft as Record<string, unknown>) : {};
  const draft = { ...previous, ...patch(asNarrative(previous)) };
  for (const [key, value] of Object.entries(draft)) if (value === undefined) delete draft[key];
  const { error } = await supabase
    .from("setup_steps")
    .upsert({ client_id: clientId, step: "framing", draft, updated_at: nowIso() }, { onConflict: "client_id,step", ignoreDuplicates: false });
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  revalidate(clientId);
  return { ok: true, narrative: asNarrative(draft) };
}

/** The opening and the ask, in Rupert's voice. Dori edits them per client. */
function statementDefaults(company: string) {
  const name = company.trim() || "your company";
  return {
    intro: `We've gone through everything you shared with us: the intake, your deck and materials, and our own research. Investors read fast, so we don't pitch ten points. We lead with the three that make the strongest case for ${name}. Here they are, in the order we'll use them.`,
    closing: `This is how we'll position ${name} with investors. It's the narrative, not the emails: those come after we've matched the investors. Do you agree with these three and with the order? Confirm, or tell us what you'd change.`,
  };
}

/** Stage 2: the narrative as a statement, made from the 3 confirmed selling points. No AI. */
export async function createNarrativeAction(clientId: string): Promise<Result<{ narrative: NarrativePayload }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const brief = await loadBrief(access.supabase, clientId);
  if (!brief.ok) return brief;
  const points = brief.value?.points;
  if (!points?.confirmed_at) return { ok: false, error: "Confirm & Finalize the 3 strongest selling points first." };
  const { data: client } = await access.supabase.from("clients").select("company_name").eq("id", clientId).maybeSingle();
  const existing = await loadSetupStep(access.supabase, clientId, "framing");
  if (!existing.ok) return existing;
  const previous = asNarrative(existing.row?.draft).statement;
  const defaults = statementDefaults(String(client?.company_name ?? ""));
  const statement: NarrativeStatement = {
    intro: previous?.intro || defaults.intro,
    points: points.chosen.map((id) => {
      const score = points.scores.find((item) => item.point === id);
      return { title: score?.title || id.replace(/_/g, " "), claim: score?.pitch || "" };
    }),
    closing: previous?.closing || defaults.closing,
  };
  const OLD_NEXT_STEPS =
    "Once you confirm this narrative, Rupert sends your matched investor list. After you confirm the list, he writes the email copy and sequence for each tier from these messages. You review those before anything is sent.";
  return patchNarrativeDraft(access.supabase, clientId, (draft) => ({
    statement,
    summary: statementMarkdown(statement),
    // The narrative is now three points, not "messages": refresh the old default wording.
    ...(draft.next_steps.trim() === OLD_NEXT_STEPS ? { next_steps: NARRATIVE_NEXT_STEPS } : {}),
    finalized_at: undefined,
    change_summary: undefined,
  }));
}

/** Dori's edits to the narrative statement; `finalize` locks it for the send step. */
export async function saveNarrativeAction(
  clientId: string,
  input: NarrativeStatement,
  finalize: boolean,
): Promise<Result<{ narrative: NarrativePayload }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const statement = asStatement(input);
  if (!statement) return { ok: false, error: "The narrative needs the selling points." };
  const summary = statementMarkdown(statement);
  if (finalize) {
    const problem = narrativeProblem({ ...asNarrative({}), statement, summary });
    if (problem) return { ok: false, error: problem };
  }
  return patchNarrativeDraft(access.supabase, clientId, () => ({ statement, summary, finalized_at: finalize ? nowIso() : undefined }));
}

/** The brief's questions Rupert sends the founder with the narrative. */
export async function saveFounderQuestionsAction(clientId: string, questions: string[]): Promise<Result<{ narrative: NarrativePayload }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const brief = await loadBrief(access.supabase, clientId);
  if (!brief.ok) return brief;
  const allowed = new Set(briefQuestions(brief.value?.sections.questions ?? ""));
  const wanted = (Array.isArray(questions) ? questions.map(String) : []).filter((question) => allowed.has(question));
  const asked = await setFounderQuestions(access.supabase, clientId, wanted);
  if (!asked.ok) return asked;
  return patchNarrativeDraft(access.supabase, clientId, () => ({
    founder_questions: asked.value.map((item) => ({ id: item.id, question: item.question })),
  }));
}

/**
 * The brief's outputs for the founder: writes the narrative from the brief and
 * puts it, the deck feedback and the chosen questions on the Outreach
 * Narrative draft. Nothing reaches the founder until Rupert pushes it there.
 */
export async function scoreSellingPointsAction(clientId: string) {
  const access = await requireAdmin(clientId, true);
  if (!access.ok) return access;
  return withBrief(await scoreSellingPoints(access.supabase, clientId, access.actor), clientId);
}

export async function saveSellingPointsAction(
  clientId: string,
  chosen: string[],
  pitches: Record<string, string>,
  scores: Record<string, number> = {},
  titles: Record<string, string> = {},
  confirm = false,
  watchOuts: Record<string, string> = {},
) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const clean: Record<string, string> = {};
  for (const [id, text] of Object.entries(pitches && typeof pitches === "object" ? pitches : {})) clean[String(id)] = String(text ?? "").slice(0, 2000);
  const cleanScores: Record<string, number> = {};
  for (const [id, value] of Object.entries(scores && typeof scores === "object" ? scores : {})) {
    const number = Number(value);
    if (Number.isFinite(number)) cleanScores[String(id)] = number;
  }
  const cleanTitles: Record<string, string> = {};
  for (const [id, text] of Object.entries(titles && typeof titles === "object" ? titles : {})) cleanTitles[String(id)] = String(text ?? "").slice(0, 100);
  const cleanWatch: Record<string, string> = {};
  for (const [id, text] of Object.entries(watchOuts && typeof watchOuts === "object" ? watchOuts : {})) cleanWatch[String(id)] = String(text ?? "").slice(0, 1000);
  return withBrief(
    await saveSellingPoints(
      access.supabase,
      clientId,
      { chosen: Array.isArray(chosen) ? chosen.map(String) : [], pitches: clean, scores: cleanScores, titles: cleanTitles, watchOuts: cleanWatch, confirm: confirm === true },
      access.actor,
    ),
    clientId,
  );
}

/** Forms → Brief topics: the topics every brief is written by. */
export async function saveBriefTopicsAction(topics: BriefTopic[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false, error: "Service role key is not configured." };
  const parsed = parseBriefTopics(topics);
  if (!parsed) return { ok: false, error: "Each topic needs a unique title, and there must be between 1 and 20 topics." };
  if (!parsed.some((topic) => topic.enabled)) return { ok: false, error: "Keep at least one topic on." };
  const { error } = await createServiceClient().from("form_templates").upsert({
    slug: BRIEF_TOPICS_SLUG,
    title: "Company Brief topics",
    content: JSON.stringify(parsed),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/forms/brief-topics");
  return { ok: true };
}

/** Start over: the brief, chat, questions and an unsent narrative draft go; the intake and materials stay. */
export async function resetBriefAction(clientId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const result = await resetBrief(access.supabase, clientId);
  if (!result.ok) return result;
  revalidate(clientId);
  return { ok: true };
}

/** Step 1 of uploading the founder's LinkedIn PDF: a one-time upload URL in the client's linkedin folder. */
export async function createLinkedinUploadAction(clientId: string, file: { name: string; size: number }): Promise<Result<{ path: string; token: string }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const name = String(file?.name ?? "").trim();
  if (!/\.pdf$/i.test(name)) return { ok: false, error: "Upload the LinkedIn profile as a PDF (LinkedIn → More → Save to PDF)." };
  const problem = intakeFileProblem({ name, size: Number(file?.size) || 0 });
  if (problem) return { ok: false, error: problem };
  const path = `${clientId}/linkedin/${randomUUID()}/${safeFileName(name)}`;
  const { data, error } = await access.supabase.storage.from(MATERIALS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: `Upload could not start: ${error?.message ?? "unknown error"}.` };
  return { ok: true, path: data.path, token: data.token };
}

export async function addLinkedinFileAction(clientId: string, file: { path: string; name: string; size: number; type: string }) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const result = await addLinkedinFile(
    access.supabase,
    clientId,
    { path: String(file?.path ?? ""), name: String(file?.name ?? "LinkedIn.pdf"), size: Number(file?.size) || 0, type: String(file?.type ?? "application/pdf") },
    access.actor,
  );
  if (!result.ok) return result;
  revalidate(clientId);
  return { ok: true as const, files: result.value };
}

export async function skipLinkedinAction(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const result = await skipLinkedin(access.supabase, clientId, access.actor);
  if (!result.ok) return result;
  revalidate(clientId);
  return { ok: true as const, files: result.value };
}

export async function removeLinkedinFileAction(clientId: string, path: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const result = await removeLinkedinFile(access.supabase, clientId, String(path ?? ""));
  if (!result.ok) return result;
  revalidate(clientId);
  return { ok: true as const, files: result.value };
}

/** Agents → Selling points: the list Rupert scores for every raise. */
export async function saveSellingPointsListAction(points: SellingPoint[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false, error: "Service role key is not configured." };
  const parsed = parseSellingPoints(points);
  if (!parsed) return { ok: false, error: "Each point needs a unique title, and there must be between 3 and 20 points." };
  const { error } = await createServiceClient().from("form_templates").upsert({
    slug: SELLING_POINTS_SLUG,
    title: "Selling points",
    content: JSON.stringify(parsed),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/forms/selling-points");
  return { ok: true };
}
