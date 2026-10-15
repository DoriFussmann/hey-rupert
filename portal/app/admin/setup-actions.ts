"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { notifyClient, type ClientTurn } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/admin";
import type { EmailResult } from "@/lib/email";
import { FEEDBACK_DEFAULT_MESSAGE } from "@/lib/email-templates";
import { isHttpUrl } from "@/lib/material-fields";
import {
  SETUP_STEPS,
  asEmailCopy,
  asFeedback,
  asInvestorList,
  asMaterials,
  asNarrative,
  canPublish,
  emailCopyProblems,
  feedbackFolder,
  feedbackForClient,
  feedbackProblem,
  narrativeProblem,
  type FeedbackDraft,
  type NarrativePayload,
  type SetupStepId,
  type SetupStepState,
} from "@/lib/setup";
import { loadSetupSteps, nowIso, setupTableError } from "@/lib/setup-server";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type AdminSetupResult = { ok: true } | { ok: false; error: string };
export type AdminPublishResult =
  | { ok: true; clientEmail: EmailResult }
  | { ok: false; error: string };

type PublishableStep = "deck_review" | "framing" | "investor_list" | "email_copy";

const PUBLISHABLE = new Set<PublishableStep>([
  "deck_review",
  "framing",
  "investor_list",
  "email_copy",
]);

const READY_EMAIL: Record<PublishableStep, ClientTurn> = {
  deck_review: "feedback_ready",
  framing: "framing_ready",
  investor_list: "investor_list_ready",
  email_copy: "email_copy_ready",
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

/** Keeps only this client's feedback uploads and http(s) links. */
function cleanFeedback(clientId: string, draft: unknown): FeedbackDraft {
  const feedback = asFeedback(draft);
  const folder = feedbackFolder(clientId);
  return {
    ...feedback,
    attachments: feedback.attachments.filter(
      (file) => file.path.startsWith(folder) && !file.path.includes(".."),
    ),
    links: feedback.links.filter((link) => isHttpUrl(link.url)),
  };
}

/** Cleans a draft to the shape its step stores. */
function normalizeDraft(clientId: string, step: PublishableStep, draft: unknown) {
  if (step === "investor_list") return asInvestorList(draft);
  if (step === "email_copy") return asEmailCopy(draft);
  if (step === "deck_review") return cleanFeedback(clientId, draft);
  return asNarrative(draft);
}

function draftProblem(step: PublishableStep, draft: ReturnType<typeof normalizeDraft>) {
  if (step === "investor_list") {
    return (draft as ReturnType<typeof asInvestorList>).rows.length === 0
      ? "Upload the investor CSV before pushing."
      : null;
  }
  if (step === "email_copy") {
    const problems = emailCopyProblems(draft as ReturnType<typeof asEmailCopy>);
    return problems.length > 0 ? problems.join(" ") : null;
  }
  if (step === "deck_review") return feedbackProblem(draft as FeedbackDraft);
  return narrativeProblem(draft as NarrativePayload);
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

function laterStepPublished(rows: SetupStepState[], step: SetupStepId) {
  const index = SETUP_STEPS.findIndex((item) => item.id === step);
  return SETUP_STEPS.slice(index + 1).some((item) =>
    rows.some((row) => row.step === item.id && row.version > 0),
  );
}

/**
 * Pushes Rupert's draft to the client. Review steps become the client's
 * turn; the deck review is published for the client to read.
 */
export async function publishSetupStep(
  clientId: string,
  step: SetupStepId,
  draft: unknown,
  note: string,
): Promise<AdminPublishResult> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!PUBLISHABLE.has(step as PublishableStep)) {
    return { ok: false, error: "This step cannot be pushed." };
  }
  const publishable = step as PublishableStep;

  const state = await loadState(access.supabase, clientId);
  if (!state.ok) return state;
  if (!canPublish(state.source, step)) {
    const blocked: Record<PublishableStep, string> = {
      deck_review: "Available once the client submits their materials.",
      framing: "Available once the client submits their materials.",
      investor_list: "Available once the client confirms the outreach narrative.",
      email_copy: "Available once the client confirms the investor list.",
    };
    return { ok: false, error: blocked[publishable] };
  }

  const payload = normalizeDraft(clientId, publishable, draft);
  const problem = draftProblem(publishable, payload);
  if (problem) return { ok: false, error: problem };

  const row = state.rows.find((item) => item.step === step) ?? null;
  if (row?.status === "confirmed" && laterStepPublished(state.rows, step)) {
    return {
      ok: false,
      error:
        "The client already confirmed this and later steps are under way. Talk to the client before changing it.",
    };
  }

  const at = nowIso();
  const version = (row?.version ?? 0) + 1;
  const inform = publishable === "deck_review";
  const history = [
    ...(row?.history ?? []),
    { version, published_at: at, response: null },
  ];

  const values = {
    client_id: clientId,
    step,
    status: inform ? "published" : "with_client",
    draft: payload,
    // The client sees only the feedback meant for them, never the analysis.
    published: inform ? feedbackForClient(payload as FeedbackDraft) : payload,
    version,
    published_at: at,
    response: null,
    history,
    turn_since: at,
    completed_at: inform ? at : null,
    // Each version is "new" for the client until they open it.
    client_viewed_at: null,
    updated_at: at,
  };

  if (row) {
    const { data, error } = await access.supabase
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
    const { error } = await access.supabase.from("setup_steps").insert(values);
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

  const email = inform ? (payload as FeedbackDraft).email : null;
  const clientEmail = await notifyClient(
    access.supabase,
    clientId,
    READY_EMAIL[publishable],
    email
      ? {
          message: email.body.trim() || FEEDBACK_DEFAULT_MESSAGE,
          subject: email.subject,
          updated: version > 1,
        }
      : { note, updated: version > 1 },
  );

  revalidateSetup(clientId);
  return { ok: true, clientEmail };
}

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
