import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { isApproved, type CoreMessage } from "@/lib/outreach/core";
import { loadOutreachMessages } from "@/lib/outreach/core-server";
import type { StepTurn } from "@/lib/step-order";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type OutreachStep = { done: boolean; turn: StepTurn };
export type OutreachSteps = {
  core: OutreachStep;
  campaign: OutreachStep;
  live: OutreachStep;
  /** Blocks pushing the email copy until every Core contact is written and approved. */
  coreWarning: string | null;
};

const NONE: OutreachStep = { done: false, turn: "none" };

/**
 * Why the email copy can't be pushed yet: the client confirms the copy with
 * every personal Core email in front of them, so all of them are written and
 * approved first. Null when ready (or the list has no Core funds).
 */
export function coreBlocker(core: Pick<CoreMessage, "status" | "approved_hash" | "emails">[], coreFunds: number): string | null {
  if (coreFunds === 0 && core.length === 0) return null;
  if (core.length === 0) {
    return "Write and approve the Core contacts first (under Core contacts). The client confirms the copy with the personal Core emails in front of them.";
  }
  const approved = core.filter((m) => isApproved(m)).length;
  if (approved === core.length) return null;
  return `${approved} of ${core.length} Core contacts are written and approved. Finish them under Core contacts first: the client confirms the copy with the personal Core emails in front of them.`;
}

/** coreBlocker, reading the client's active Core contacts. */
export async function coreReadiness(supabase: ServiceClient, clientId: string, coreFunds: number): Promise<string | null> {
  const messages = await loadOutreachMessages(supabase, clientId);
  if (!messages.ok) return "Couldn't check the Core contacts. Try again.";
  return coreBlocker(messages.value.filter((m) => m.slot === "active" && m.tier === 1), coreFunds);
}

/**
 * Where the outreach steps stand, for ordering the admin page: one read of
 * the contact rows and one of the campaign row. Never fails: missing tables
 * read as "not started".
 */
export async function outreachSteps(
  supabase: ServiceClient,
  clientId: string,
  input: { listConfirmed: boolean; fourTier: boolean; copyConfirmed: boolean; copyVersion: number; runId: string | null; coreFunds: number },
): Promise<OutreachSteps> {
  if (!input.listConfirmed || !input.fourTier) return { core: NONE, campaign: NONE, live: NONE, coreWarning: null };
  try {
    const [messages, campaignRead] = await Promise.all([
      loadOutreachMessages(supabase, clientId),
      supabase.from("outreach_campaigns").select("*").eq("client_id", clientId).maybeSingle(),
    ]);
    const rows = messages.ok ? messages.value.filter((m) => m.slot === "active") : [];
    const campaign = (campaignRead.data ?? null) as Record<string, unknown> | null;
    const live = Boolean(campaign?.live_at);

    // Core: every active Core contact written and approved.
    const core = rows.filter((m) => m.tier === 1);
    const coreDone = live || (core.length > 0 && core.every((m) => isApproved(m)));

    // Campaign: built from the copy the client confirmed, on today's list, with every contact approved.
    const built =
      Boolean(campaign?.built_at) &&
      Number(campaign?.copy_version) === input.copyVersion &&
      (!input.runId || String(campaign?.run_id ?? "") === input.runId) &&
      rows.every((m) => isApproved(m));
    const campaignDone = live || (input.copyConfirmed && built);

    // Go Live: Rupert sends the invoice; then the client connects, pays and clicks.
    const liveTurn: StepTurn = live ? "none" : !campaignDone ? "none" : campaign?.invoice_url ? "client" : "admin";

    const coreWarning = live ? null : coreBlocker(core, input.coreFunds);
    return {
      coreWarning,
      core: { done: coreDone, turn: coreDone ? "none" : "admin" },
      campaign: { done: campaignDone, turn: campaignDone ? "none" : input.copyConfirmed && coreDone ? "admin" : "none" },
      live: { done: live, turn: liveTurn },
    };
  } catch {
    return { core: { done: false, turn: "admin" }, campaign: NONE, live: NONE, coreWarning: null };
  }
}
