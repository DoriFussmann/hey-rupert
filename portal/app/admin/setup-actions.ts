"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { isClaudeConfigured } from "@/lib/anthropic";
import {
  draftEmailCopyEmail,
  draftInvestorListEmail,
  draftNarrativeEmail,
} from "@/lib/agents-server";
import { notifyClient } from "@/lib/notify";
import { coreReadiness } from "@/lib/outreach/progress-server";
import { copyTierOf } from "@/lib/outreach/copy";
import { createServiceClient } from "@/lib/supabase/admin";
import type { EmailResult } from "@/lib/email";
import { isHttpUrl } from "@/lib/material-fields";
import {
  INVESTOR_LIST_BLOCKED,
  asClientEmail,
  asEmailCopy,
  asEmailCopyDraft,
  asInvestorList,
  asInvestorListDraft,
  asMaterials,
  asNarrative,
  canPublish,
  NOTE_MAX,
  clientEmailProblem,
  emailCopyProblems,
  investorFlagsFrom,
  investorListForClient,
  investorListProblem,
  retainInvestorFlags,
  isSetupDocumentStep,
  narrativeForClient,
  narrativeProblem,
  questionsOf,
  settleQuestion,
  setupFilesFolder,
  withPublishedQuestions,
  type ClientEmailDraft,
  type EmailCopyDraft,
  type InvestorListDraft,
  type MaterialFile,
  type NarrativePayload,
  type SetupDocumentStep,
  type SetupStepId,
  type SetupStepState,
} from "@/lib/setup";
import {
  STEP_EMAIL_PAUSED_NOTE,
  composeAiEmail,
  renderInvestorListLetter,
  renderStepEmail,
  sendQuestionAnswerEmail,
  sendStepEmail,
} from "@/lib/setup-email-server";
import { carryDuplicateFlags, listedContacts } from "@/lib/match/outreach-dedupe";
import {
  loadSetupStep,
  loadSetupSteps,
  nowIso,
  saveQuestions,
  setupTableError,
} from "@/lib/setup-server";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type AdminSetupResult = { ok: true } | { ok: false; error: string };
export type AdminPublishResult =
  | { ok: true; clientEmail: EmailResult }
  | { ok: false; error: string };
export type AdminPushResult =
  | { ok: true; version: number }
  | { ok: false; error: string };
export type SendDocumentResult =
  | { ok: true; version: number; clientEmail: EmailResult }
  | { ok: false; error: string };
export type StepEmailResult =
  | { ok: true; email: ClientEmailDraft; pausedNote: string | null }
  | { ok: false; error: string };

type PublishableStep = "framing" | "investor_list" | "email_copy";

const PUBLISHABLE = new Set<PublishableStep>([
  "framing",
  "investor_list",
  "email_copy",
]);

/**
 * Steps that build on each one. A confirmed step whose dependents are under
 * way is not replaced. The narrative can be re-pushed: an investor list
 * already sent stays where it is.
 */
const DEPENDENTS: Record<PublishableStep, SetupStepId[]> = {
  framing: [],
  investor_list: ["email_copy"],
  email_copy: [],
};

const BLOCKED: Record<PublishableStep, string> = {
  framing: "Available once the client's intake and materials are in.",
  investor_list: INVESTOR_LIST_BLOCKED,
  email_copy: "Available once the client confirms the investor list.",
};

async function requireAdmin() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false as const, error: "Service role key is not configured." };
  }
  return { ok: true as const, supabase: createServiceClient() };
}

function revalidateSetup(clientId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/setup", "layout");
  revalidatePath("/portal/materials");
  revalidatePath("/portal/onboarding");
}

async function loadState(supabase: ServiceClient, clientId: string) {
  const { data: client, error } = await supabase
    .from("clients")
    .select("id, stage, intake_completed_at")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!client) return { ok: false as const, error: "Client not found." };

  const grouped = await loadSetupSteps(supabase, [clientId]);
  const rows = grouped.get(clientId) ?? [];
  return {
    ok: true as const,
    source: {
      stage: client.stage != null ? String(client.stage) : null,
      intake_completed_at:
        client.intake_completed_at != null ? String(client.intake_completed_at) : null,
      setup_steps: rows,
    },
    rows,
  };
}

/** Keeps only files uploaded to this client's Setup folder. */
function ownFiles(clientId: string, files: MaterialFile[]) {
  const folder = setupFilesFolder(clientId);
  return files.filter((file) => file.path.startsWith(folder) && !file.path.includes(".."));
}

type NarrativeDraft = NarrativePayload & { client_email: ClientEmailDraft };

/**
 * The narrative draft (with its Company Materials Feedback): this client's
 * uploads and http(s) links only, with its email. Rupert's reply from before
 * the email went with each push is not carried forward. The client's
 * questions live on the published version, never on the draft.
 */
function cleanNarrative(clientId: string, draft: unknown): NarrativeDraft {
  const narrative = asNarrative(draft);
  const raw = (draft && typeof draft === "object" ? draft : {}) as Record<string, unknown>;
  return {
    ...narrative,
    questions: undefined,
    admin_note: undefined,
    attachments: ownFiles(clientId, narrative.attachments),
    links: narrative.links.filter((link) => isHttpUrl(link.url)),
    client_email: asClientEmail(raw.client_email),
  };
}

/** Cleans a draft to the shape its step stores. */
function normalizeDraft(
  clientId: string,
  step: PublishableStep,
  draft: unknown,
): NarrativeDraft | InvestorListDraft | EmailCopyDraft {
  if (step === "investor_list") {
    const list: InvestorListDraft = { ...asInvestorListDraft(draft), questions: undefined };
    return list;
  }
  if (step === "email_copy") {
    // Rupert's old reply on the page is replaced by the email that goes with each push.
    const copy: EmailCopyDraft = { ...asEmailCopyDraft(draft), admin_note: undefined, questions: undefined };
    return copy;
  }
  return cleanNarrative(clientId, draft);
}

/** What the client sees of a draft: never the analysis notes or the email. */
function publishedPayload(step: PublishableStep, draft: ReturnType<typeof normalizeDraft>) {
  if (step === "framing") return narrativeForClient(draft as NarrativeDraft);
  if (step === "investor_list") return investorListForClient(draft as InvestorListDraft);
  return asEmailCopy(draft);
}

function draftProblem(step: PublishableStep, draft: ReturnType<typeof normalizeDraft>) {
  if (step === "investor_list") return investorListProblem(draft as InvestorListDraft);
  if (step === "email_copy") {
    const problems = emailCopyProblems(draft as ReturnType<typeof asEmailCopy>);
    return problems.length > 0 ? problems.join(" ") : null;
  }
  return narrativeProblem(draft as NarrativeDraft);
}

/** Saves Rupert's work in progress. The client does not see drafts. */
export async function saveSetupDraft(
  clientId: string,
  step: SetupStepId,
  draft: unknown,
): Promise<AdminSetupResult> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!PUBLISHABLE.has(step as PublishableStep)) {
    return { ok: false, error: "This step has no Rupert draft." };
  }

  // An internal update to a confirmed narrative is kept when the draft is saved.
  let keep: Record<string, unknown> = {};
  if (step === "framing") {
    const stored = await loadSetupStep(access.supabase, clientId, "framing");
    if (!stored.ok) return stored;
    const internal = stored.row?.draft && typeof stored.row.draft === "object"
      ? (stored.row.draft as Record<string, unknown>).internal_update
      : undefined;
    if (internal) keep = { internal_update: internal };
  }

  const at = nowIso();
  const { error } = await access.supabase.from("setup_steps").upsert(
    {
      client_id: clientId,
      step,
      draft: { ...normalizeDraft(clientId, step as PublishableStep, draft), ...keep },
      updated_at: at,
    },
    { onConflict: "client_id,step", ignoreDuplicates: false },
  );
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };

  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

function dependentsStarted(rows: SetupStepState[], step: PublishableStep) {
  return DEPENDENTS[step].some((id) =>
    rows.some((row) => row.step === id && row.version > 0),
  );
}

/**
 * Writes a new version of a step for the client: it becomes their turn.
 * Shared by every push; neither the email nor revalidation happens here.
 */
async function writePush(
  supabase: ServiceClient,
  clientId: string,
  step: PublishableStep,
  draft: unknown,
): Promise<AdminPushResult> {
  const state = await loadState(supabase, clientId);
  if (!state.ok) return state;
  if (!canPublish(state.source, step)) return { ok: false, error: BLOCKED[step] };

  let payload = normalizeDraft(clientId, step, draft);
  // Email Copy's reply comes with the push; the investor list keeps its own on the draft.
  if (step === "investor_list") {
    const next = payload as InvestorListDraft;
    const stored = state.rows.find((item) => item.step === "investor_list");
    const previous = asInvestorList(stored?.published);
    const previousDraft = asInvestorList(stored?.draft);
    const names = new Map<string, string>();
    for (const item of [...previous.rows, ...previousDraft.rows, ...next.rows]) {
      names.set(item.id, item.fund_name);
    }
    const retained = retainInvestorFlags(
      {
        ...investorFlagsFrom(stored?.published),
        ...investorFlagsFrom(stored?.draft),
        ...(next.client_flags ?? {}),
      },
      [
        ...(previous.removed_flags ?? []),
        ...(previousDraft.removed_flags ?? []),
        ...(next.removed_flags ?? []),
      ],
      names,
      new Set(next.rows.map((item) => item.id)),
    );
    const carried = carryDuplicateFlags(
      next.rows.map((item) => ({
        id: item.id,
        web: item.website ?? "",
        contacts: listedContacts(item.contact_count, item.contact),
      })),
      retained.client_flags,
    );
    payload = { ...next, ...retained, ...(carried ? { client_flags: carried } : {}) };
  }
  const problem = draftProblem(step, payload);
  if (problem) return { ok: false, error: problem };
  // Copy by fund type: the client confirms it with every personal Core email in front of them.
  if (step === "email_copy" && asEmailCopy(payload).copy_version === 2) {
    const list = asInvestorList(state.rows.find((item) => item.step === "investor_list")?.published);
    const blocked = await coreReadiness(supabase, clientId, list.rows.filter((item) => copyTierOf(item) === 1).length);
    if (blocked) return { ok: false, error: blocked };
  }

  const row = state.rows.find((item) => item.step === step) ?? null;
  if (row?.status === "confirmed" && dependentsStarted(state.rows, step)) {
    return {
      ok: false,
      error:
        "The client already confirmed this and later steps are under way. Talk to the client before changing it.",
    };
  }

  const at = nowIso();
  const version = (row?.version ?? 0) + 1;
  const values = {
    client_id: clientId,
    step,
    status: "with_client",
    draft: payload,
    // The client's questions stay with the step from version to version.
    published: withPublishedQuestions(publishedPayload(step, payload), questionsOf(row)),
    version,
    published_at: at,
    response: null,
    history: [...(row?.history ?? []), { version, published_at: at, response: null }],
    turn_since: at,
    completed_at: null,
    // Each version is "new" for the client until they open it.
    client_viewed_at: null,
    updated_at: at,
  };

  if (row) {
    const { data, error } = await supabase
      .from("setup_steps")
      .update(values)
      .eq("client_id", clientId)
      .eq("step", step)
      .eq("version", row.version)
      .select("client_id");
    if (error) return { ok: false, error: setupTableError(error.message, error.code) };
    if (!data || data.length === 0) {
      return { ok: false, error: "This step changed meanwhile. Refresh and try again." };
    }
  } else {
    const { error } = await supabase.from("setup_steps").insert(values);
    if (error) {
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "This step changed meanwhile. Refresh and try again."
            : setupTableError(error.message, error.code),
      };
    }
  }

  return { ok: true, version };
}

/**
 * Push to Client Portal & Send, for the Outreach Narrative (with the Company
 * Materials Feedback), the Investor List and the Email Copy: pushes a new version to the client's
 * portal (their turn to confirm), then sends the email Rupert reviewed and records it on that
 * version. The email goes even when automatic emails are paused: Rupert
 * sends it himself. If the email fails, the push stands and the reason is
 * returned.
 */
export async function sendSetupDocument(
  clientId: string,
  step: SetupDocumentStep,
  draft: unknown,
): Promise<SendDocumentResult> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!isSetupDocumentStep(step)) return { ok: false, error: "This step cannot be sent here." };

  const email = normalizeDraft(clientId, step, draft);
  const emailProblem = clientEmailProblem(email.client_email);
  if (emailProblem) return { ok: false, error: emailProblem };

  const pushed = await writePush(access.supabase, clientId, step, draft);
  if (!pushed.ok) return pushed;

  const clientEmail = await sendStepEmail(access.supabase, clientId, step, {
    subject: email.client_email.subject.replace(/\s+/g, " ").trim(),
    body: email.client_email.body.trim(),
    note: email.client_email.note,
  });
  if (clientEmail.ok) await recordEmailed(access.supabase, clientId, step, pushed.version);

  revalidateSetup(clientId);
  return { ok: true, version: pushed.version, clientEmail };
}

/** Marks a version as emailed. Best effort: the email is already out. */
async function recordEmailed(
  supabase: ServiceClient,
  clientId: string,
  step: SetupDocumentStep,
  version: number,
) {
  const loaded = await loadState(supabase, clientId);
  if (!loaded.ok) return;
  const row = loaded.rows.find((item) => item.step === step);
  if (!row || row.version !== version) return;
  const at = nowIso();
  const { error } = await supabase
    .from("setup_steps")
    .update({
      history: row.history.map((entry) =>
        entry.version === version ? { ...entry, emailed_at: at } : entry,
      ),
    })
    .eq("client_id", clientId)
    .eq("step", step)
    .eq("version", version);
  if (error) console.error(`Setup email not recorded: ${error.message}`);
}

/**
 * Drafts the email for the next send from the draft as it stands (unsaved
 * edits included): written by Claude from Rupert's edited content and the
 * company information, or filled from Forms → Emails when Claude is not set up.
 */
export async function draftSetupEmail(
  clientId: string,
  step: SetupDocumentStep,
  draft: unknown,
): Promise<StepEmailResult> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!isSetupDocumentStep(step)) return { ok: false, error: "Unknown step." };

  const state = await loadState(access.supabase, clientId);
  if (!state.ok) return state;
  const row = state.rows.find((item) => item.step === step) ?? null;
  const version = (row?.version ?? 0) + 1;

  if (step === "investor_list") {
    const rendered = await renderInvestorListLetter(access.supabase, clientId, asInvestorListDraft(draft));
    if (!rendered.ok) return rendered;
    return {
      ok: true,
      email: rendered.email,
      pausedNote: rendered.paused ? STEP_EMAIL_PAUSED_NOTE : null,
    };
  }

  if (!isClaudeConfigured()) {
    const rendered = await renderStepEmail(access.supabase, clientId, step, version);
    if (!rendered.ok) return rendered;
    return {
      ok: true,
      email: rendered.email,
      pausedNote: rendered.paused ? STEP_EMAIL_PAUSED_NOTE : null,
    };
  }

  const drafted =
    step === "framing"
      ? await draftNarrativeEmail(access.supabase, clientId, cleanNarrative(clientId, draft), version)
      : step === "email_copy"
        ? await draftEmailCopyEmail(access.supabase, clientId, asEmailCopy(draft), version)
        : await draftInvestorListEmail(access.supabase, clientId, asInvestorListDraft(draft), version);
  if (!drafted.ok) return drafted;

  const composed = await composeAiEmail(access.supabase, clientId, step, drafted.value);
  if (!composed.ok) return composed;
  return {
    ok: true,
    email: composed.email,
    pausedNote: composed.paused ? STEP_EMAIL_PAUSED_NOTE : null,
  };
}

// ---------------------------------------------------------------------------
// The client's questions

/**
 * Answers a client's question (they are emailed the answer) or, with an
 * empty answer, marks it resolved without one. The turn does not change:
 * the client can still confirm.
 */
export async function settleSetupQuestion(
  clientId: string,
  step: SetupDocumentStep,
  questionId: string,
  answer: string,
): Promise<AdminPublishResult> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!isSetupDocumentStep(step)) return { ok: false, error: "Unknown step." };
  const text = String(answer ?? "").trim();
  if (text.length > NOTE_MAX) {
    return { ok: false, error: `Keep the answer under ${NOTE_MAX} characters.` };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await loadSetupStep(access.supabase, clientId, step);
    if (!loaded.ok) return loaded;
    const row = loaded.row;
    if (!row) return { ok: false, error: "This step has no questions." };
    const asked = questionsOf(row).find((item) => item.id === questionId);
    const next = settleQuestion(questionsOf(row), String(questionId), text, nowIso());
    if (!asked || !next) return { ok: false, error: "That question is no longer here. Refresh the page." };
    const saved = await saveQuestions(access.supabase, row, next);
    if (!saved.ok) return saved;
    if (!saved.saved) continue;

    const clientEmail: EmailResult = text
      ? await sendQuestionAnswerEmail(access.supabase, clientId, step, {
          question: asked.question,
          answer: text,
        })
      : { ok: false, reason: "Resolved without an answer: no email sent." };
    revalidateSetup(clientId);
    return { ok: true, clientEmail };
  }
  return { ok: false, error: "The step changed meanwhile. Refresh and try again." };
}

// ---------------------------------------------------------------------------
// Outreach Narrative: internal update after the client confirmed

/**
 * Saves Rupert's update to a narrative the client already confirmed, without
 * asking them to confirm again and without emailing them. The email copy is
 * written from it; the client's page keeps the version they confirmed.
 */
export async function saveNarrativeInternalUpdate(
  clientId: string,
  draft: unknown,
): Promise<{ ok: true; at: string } | { ok: false; error: string }> {
  const access = await requireAdmin();
  if (!access.ok) return access;

  const loaded = await loadSetupStep(access.supabase, clientId, "framing");
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (!row || row.status !== "confirmed") {
    return { ok: false, error: "Only a narrative the client confirmed can be updated internally. Push it instead." };
  }
  const narrative = cleanNarrative(clientId, draft);
  const problem = narrativeProblem(narrative);
  if (problem) return { ok: false, error: problem };

  const at = nowIso();
  // The email saved with the draft is kept as it was.
  const stored = row.draft && typeof row.draft === "object" ? (row.draft as Record<string, unknown>) : {};
  const { client_email: _unused, ...content } = narrative;
  void _unused;
  const { data, error } = await access.supabase
    .from("setup_steps")
    .update({
      draft: {
        ...content,
        client_email: asClientEmail(stored.client_email),
        internal_update: { at, narrative: narrativeForClient(content) },
      },
      updated_at: at,
    })
    .eq("client_id", clientId)
    .eq("step", "framing")
    .eq("status", "confirmed")
    .eq("version", row.version)
    .select("client_id");
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  if (!data || data.length === 0) {
    return { ok: false, error: "The narrative changed meanwhile. Refresh and try again." };
  }

  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, at };
}

// ---------------------------------------------------------------------------
// Materials

/**
 * Sends the materials back to the client (for example a deck is missing).
 * Only before the outreach narrative has been pushed.
 */
export async function reopenMaterials(
  clientId: string,
  note: string,
): Promise<AdminPublishResult> {
  const access = await requireAdmin();
  if (!access.ok) return access;

  const message = String(note ?? "").trim();
  if (!message) {
    return { ok: false, error: "Tell the client what you need from them." };
  }

  const state = await loadState(access.supabase, clientId);
  if (!state.ok) return state;
  const row = state.rows.find((item) => item.step === "materials");
  if (!row || row.status !== "submitted") {
    return { ok: false, error: "The materials are not submitted yet." };
  }
  if (state.rows.some((item) => item.step === "framing" && item.version > 0)) {
    return {
      ok: false,
      error:
        "The outreach narrative is already with the client. Ask for extra materials by email instead.",
    };
  }

  const at = nowIso();
  const history = row.history.map((entry) =>
    entry.version === row.version
      ? {
          ...entry,
          response: {
            decision: "changes_requested" as const,
            note: message.slice(0, 4000),
            item_notes: {},
            item_labels: {},
            version: row.version,
            at,
          },
        }
      : entry,
  );

  const { data, error } = await access.supabase
    .from("setup_steps")
    .update({
      status: "draft",
      draft: asMaterials(row.published ?? row.draft),
      history,
      turn_since: at,
      completed_at: null,
      updated_at: at,
    })
    .eq("client_id", clientId)
    .eq("step", "materials")
    .eq("status", "submitted")
    .select("client_id");

  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  if (!data || data.length === 0) {
    return { ok: false, error: "The materials changed meanwhile. Refresh and try again." };
  }

  const clientEmail = await notifyClient(
    access.supabase,
    clientId,
    "materials_reopened",
    { note: message },
  );

  revalidateSetup(clientId);
  return { ok: true, clientEmail };
}

/** Runs the reminder check now (the cron runs the same thing on schedule). */
export async function runRemindersNow(): Promise<
  | { ok: true; checked: number; ready: string[]; stalled: string[]; errors: string[] }
  | { ok: false; error: string }
> {
  const access = await requireAdmin();
  if (!access.ok) return access;

  const { runClientReminders } = await import("@/lib/reminders");
  const run = await runClientReminders(access.supabase);
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/nudge");
  return {
    ok: true,
    checked: run.checked,
    ready: run.ready.map(
      (entry) => `${entry.client}: ${entry.turns.join("; ")}`,
    ),
    stalled: run.stalled.map(
      (entry) => `${entry.client}: ${entry.turns.join("; ")}`,
    ),
    errors: run.errors,
  };
}
