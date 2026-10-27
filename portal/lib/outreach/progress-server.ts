import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { isApproved } from "@/lib/outreach/core";
import { loadOutreachMessages } from "@/lib/outreach/core-server";
import type { StepTurn } from "@/lib/step-order";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type OutreachStep = { done: boolean; turn: StepTurn };
export type OutreachSteps = {
  core: OutreachStep;
  campaign: OutreachStep;
  live: OutreachStep;
  /** Shown before pushing the email copy when Core contacts aren't written and approved yet. */
  coreWarning: string | null;
};

const NONE: OutreachStep = { done: false, turn: "none" };

/**
 * Where the outreach steps stand, for ordering the admin page: one read of
 * the contact rows and one of the campaign row. Never fails: missing tables
 * read as "not started".
 */
export async function outreachSteps(
  supabase: ServiceClient,
  clientId: string,
  input: { listConfirmed: boolean; fourTier: boolean; copyConfirmed: boolean; copyVersion: number; runId: string | null },
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

    const approved = core.filter((m) => isApproved(m)).length;
    const coreWarning = coreDone
      ? null
      : core.length === 0
        ? "No Core contacts are lined up or written yet. Best order: write and approve them under Core contacts first, so the client's preview shows the personal Core emails."
        : `${approved} of ${core.length} Core contacts are written and approved. Best order: finish them under Core contacts first, so the client's preview shows the personal Core emails.`;
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
