"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { isClaudeConfigured } from "@/lib/anthropic";
import {
  draftFeedbackEmail,
  draftInvestorListEmail,
  draftNarrativeEmail,
} from "@/lib/agents-server";
import { notifyClient, type ClientTurn } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/admin";
import type { EmailResult } from "@/lib/email";
import { isHttpUrl } from "@/lib/material-fields";
import {
  INVESTOR_LIST_BLOCKED,
  SETUP_STEPS,
  asClientEmail,
  asEmailCopy,
  asFeedback,
  asInvestorListDraft,
  asMaterials,
  asNarrative,
  canPublish,
  clientEmailProblem,
  emailCopyProblems,
  feedbackForClient,
  feedbackProblem,
  investorListForClient,
  investorListProblem,
  isSetupDocumentStep,
  narrativeForClient,
  narrativeProblem,
  setupFilesFolder,
  type ClientEmailDraft,
  type FeedbackDraft,
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
  renderStepEmail,
  sendStepEmail,
} from "@/lib/setup-email-server";
import { loadSetupSteps, nowIso, setupTableError } from "@/lib/setup-server";

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

type PublishableStep = "deck_review" | "framing" | "investor_list" | "email_copy";

const PUBLISHABLE = new Set<PublishableStep>([
  "deck_review",
  "framing",
  "investor_list",
  "email_copy",
]);

/** The automatic email that goes with Email Copy (pushed with PublishBar). */
const EMAIL_COPY_READY: ClientTurn = "email_copy_ready";

/**
 * Steps that build on each one. A confirmed step whose dependents are under
 * way is not replaced. The feedback and the narrative can be re-pushed: an
 * investor list already sent stays where it is.
 */
const DEPENDENTS: Record<PublishableStep, SetupStepId[]> = {
  deck_review: [],
  framing: [],
  investor_list: ["email_copy"],
  email_copy: [],
};

const BLOCKED: Record<PublishableStep, string> = {
  deck_review: "Available once the client submits their materials.",
  framing: "Available once the client submits their materials.",
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

/** The feedback draft: this client's uploads and http(s) links only. */
function cleanFeedback(clientId: string, draft: unknown): FeedbackDraft {
  const feedback = asFeedback(draft);
  return {
    ...feedback,
    attachments: ownFiles(clientId, feedback.attachments),
    links: feedback.links.filter((link) => isHttpUrl(link.url)),
  };
}

type NarrativeDraft = NarrativePayload & { client_email: ClientEmailDraft };

/**
 * The narrative draft, cleaned the same way, with its email. Rupert's reply
 * from before the email went with each push is not carried forward.
 */
function cleanNarrative(clientId: string, draft: unknown): NarrativeDraft {
  const narrative = asNarrative(draft);
  const raw = (draft && typeof draft === "object" ? draft : {}) as Record<string, unknown>;
  return {
    ...narrative,
    admin_note: undefined,
    attachments: ownFiles(clientId, narrative.attachments),
    links: narrative.links.filter((link) => isHttpUrl(link.url)),
    client_email: asClientEmail(raw.client_email),
  };
}

/** Cleans a draft to the shape its step stores. */
function normalizeDraft(clientId: string, step: PublishableStep, draft: unknown) {
  if (step === "investor_list") return asInvestorListDraft(draft);
  if (step === "email_copy") return asEmailCopy(draft);
  if (step === "deck_review") return cleanFeedback(clientId, draft);
  return cleanNarrative(clientId, draft);
}

/** What the client sees of a draft: never the analysis notes or the email. */
function publishedPayload(step: PublishableStep, draft: ReturnType<typeof normalizeDraft>) {
  if (step === "deck_review") return feedbackForClient(draft as FeedbackDraft);
  if (step === "framing") return narrativeForClient(draft as NarrativeDraft);
  if (step === "investor_list") return investorListForClient(draft as InvestorListDraft);
  return draft;
}

function draftProblem(step: PublishableStep, draft: ReturnType<typeof normalizeDraft>) {
  if (step === "investor_list") return investorListProblem(draft as InvestorListDraft);
  if (step === "email_copy") {
    const problems = emailCopyProblems(draft as ReturnType<typeof asEmailCopy>);
    return problems.length > 0 ? problems.join(" ") : null;
  }
  if (step === "deck_review") return feedbackProblem(draft as FeedbackDraft);
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

  const at = nowIso();
  const { error } = await access.supabase.from("setup_steps").upsert(
    {
      client_id: clientId,
      step,
      draft: normalizeDraft(clientId, step as PublishableStep, draft),
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
  note: string,
): Promise<AdminPushResult> {
  const state = await loadState(supabase, clientId);
  if (!state.ok) return state;
  if (!canPublish(state.source, step)) return { ok: false, error: BLOCKED[step] };

  let payload = normalizeDraft(clientId, step, draft);
  // Email Copy's reply comes with the push; the investor list keeps its own on the draft.
  if (step === "email_copy") {
    const reply = String(note ?? "").trim().slice(0, 4000);
    payload = { ...payload, admin_note: reply || undefined };
  }
  const problem = draftProblem(step, payload);
  if (problem) return { ok: false, error: problem };

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
    published: publishedPayload(step, payload),
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
 * Pushes the email copy to the client and emails them. The feedback, the
 * narrative and the investor list use sendSetupDocument instead.
 */
export async function publishSetupStep(
  clientId: string,
  step: SetupStepId,
  draft: unknown,
  note: string,
): Promise<AdminPublishResult> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (step !== "email_copy") {
    return { ok: false, error: "This step cannot be pushed here." };
  }

  const pushed = await writePush(access.supabase, clientId, step, draft, note);
  if (!pushed.ok) return pushed;

  const clientEmail = await notifyClient(access.supabase, clientId, EMAIL_COPY_READY, {
    note,
    updated: pushed.version > 1,
  });

  revalidateSetup(clientId);
  return { ok: true, clientEmail };
}

/**
 * Push to Client Portal & Send, for the Analysis & Feedback, the Outreach
 * Narrative and the Investor List: pushes a new version to the client's
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

  const email = normalizeDraft(clientId, step, draft) as
    | FeedbackDraft
    | NarrativeDraft
    | InvestorListDraft;
  const emailProblem = clientEmailProblem(email.client_email);
  if (emailProblem) return { ok: false, error: emailProblem };

  const pushed = await writePush(access.supabase, clientId, step, draft, "");
  if (!pushed.ok) return pushed;

  const clientEmail = await sendStepEmail(access.supabase, clientId, step, {
    subject: email.client_email.subject.replace(/\s+/g, " ").trim(),
    body: email.client_email.body.trim(),
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
    step === "deck_review"
      ? await draftFeedbackEmail(access.supabase, clientId, cleanFeedback(clientId, draft), version)
      : step === "framing"
        ? await draftNarrativeEmail(
            access.supabase,
            clientId,
            cleanNarrative(clientId, draft),
            version,
          )
        : await draftInvestorListEmail(
            access.supabase,
            clientId,
            asInvestorListDraft(draft),
            version,
          );
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
  if (laterStepPublished(state.rows, "deck_review")) {
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

function laterStepPublished(rows: SetupStepState[], step: SetupStepId) {
  const index = SETUP_STEPS.findIndex((item) => item.id === step);
  return SETUP_STEPS.slice(index + 1).some((item) =>
    rows.some((row) => row.step === item.id && row.version > 0),
  );
}

/** Runs the reminder check now (the cron runs the same thing on schedule). */
export async function runRemindersNow(): Promise<
  | { ok: true; checked: number; emailed: string[]; stalled: string[]; errors: string[] }
  | { ok: false; error: string }
> {
  const access = await requireAdmin();
  if (!access.ok) return access;

  const { runClientReminders } = await import("@/lib/reminders");
  const run = await runClientReminders(access.supabase);
  revalidatePath("/admin/notifications");
  return {
    ok: true,
    checked: run.checked,
    emailed: run.emailed.map(
      (entry) => `${entry.client}: ${entry.turns.join("; ")}`,
    ),
    stalled: run.stalled.map(
      (entry) => `${entry.client}: ${entry.turns.join("; ")}`,
    ),
    errors: run.errors,
  };
}
