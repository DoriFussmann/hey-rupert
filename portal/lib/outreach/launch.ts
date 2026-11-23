// Go Live in two steps: "Add leads (paused)" puts the first batch into a
// paused Instantly campaign, where Rupert can check every address; "Activate"
// starts it. The launch state lives on outreach_campaigns:
//   leads_adding_at  claimed before any lead goes to Instantly (one click wins)
//   leads_added_at   the first batch is in Instantly; final, never added again
//   leads_added_count, leads_add_note  how many, and what happened if it broke
//   live_at          activated
// No step ever adds a second first batch: a repeated click returns what was
// added, a failure after leads may have reached Instantly is recorded as
// added (never retried), and a failure before that frees the claim.

export type LaunchRow = {
  live_at: string | null;
  leads_adding_at: string | null;
  leads_added_at: string | null;
  leads_added_count: number | null;
  leads_add_note: string | null;
};

export type LaunchStage =
  /** Nothing in Instantly yet: Add leads is next. */
  | "ready"
  /** A click claimed the add and never finished (the server stopped): check Instantly, then resolve. */
  | "stuck"
  /** The first batch is in a paused campaign: check it in Instantly, then Activate. */
  | "added"
  | "live";

export function launchStage(row: LaunchRow): LaunchStage {
  if (row.live_at) return "live";
  if (row.leads_added_at) return "added";
  if (row.leads_adding_at) return "stuck";
  return "ready";
}

/** Why the campaign can't be rebuilt now, or null when it can. */
export function rebuildBlocker(row: LaunchRow): string | null {
  const stage = launchStage(row);
  if (stage === "live") return "The campaign is live. It can't be rebuilt: what was sent stays as sent.";
  if (stage === "added") return "Leads are in Instantly. The campaign can't be rebuilt: rebuilding would add a second batch.";
  if (stage === "stuck") return "Adding leads to Instantly started and didn't finish. The campaign can't be rebuilt until that is resolved.";
  return null;
}

/** Why the sending settings can't change now, or null when they can. */
export function settingsBlocker(row: LaunchRow): string | null {
  const stage = launchStage(row);
  if (stage === "live") return "The campaign is live; change its settings in Instantly.";
  if (stage !== "ready") return "Leads are already in Instantly with these settings; they can't change now.";
  return null;
}

/** What one Add leads run did to Instantly, as the push reports it. */
export type PushOutcome =
  | { ok: true; pushed: number }
  /** `touched`: at least one add-leads request went to Instantly, so leads may be there. */
  | { ok: false; error: string; pushed: number; touched: boolean };

export type AddLeadsDeps = {
  /** Sets leads_adding_at only if nothing has claimed or added yet. True when this call won. */
  claim(now: string): Promise<boolean>;
  /** The row as it is now (after a lost claim, to report what the other click did). */
  reload(): Promise<LaunchRow>;
  /** Frees the claim: nothing reached Instantly. */
  release(): Promise<void>;
  /** Records the batch as added (final). */
  markAdded(now: string, count: number, note: string | null): Promise<void>;
  /** Creates the campaign (paused), its webhook and the inbox cap, when missing. Never adds leads. */
  setup(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Adds the first batch to the campaign. */
  push(): Promise<PushOutcome>;
  now(): string;
};

export type AddLeadsResult =
  | { ok: true; added: number; already: boolean; note: string | null }
  | { ok: false; error: string };

export async function runAddLeads(row: LaunchRow, deps: AddLeadsDeps): Promise<AddLeadsResult> {
  const before = afterClaimLost(row);
  if (before) return before;
  if (!(await deps.claim(deps.now()))) {
    // Another click got there first (or this row changed): report its state, add nothing.
    return afterClaimLost(await deps.reload()) ?? { ok: false, error: "Another click is adding the leads. Refresh in a minute." };
  }

  const ready = await deps.setup();
  if (!ready.ok) {
    await deps.release();
    return { ok: false, error: `${ready.error} No leads were added; you can try again.` };
  }

  const pushed = await deps.push();
  if (pushed.ok) {
    if (pushed.pushed === 0) {
      await deps.release();
      return { ok: false, error: "No contacts could be added today (nothing approved and due, or the contact limit is reached). Nothing changed in Instantly." };
    }
    await deps.markAdded(deps.now(), pushed.pushed, null);
    return { ok: true, added: pushed.pushed, already: false, note: null };
  }
  if (!pushed.touched) {
    await deps.release();
    return { ok: false, error: `${pushed.error} No leads were added; you can try again.` };
  }
  // Leads may be in Instantly: never add again. What's there is the first batch.
  const note = `Adding stopped partway (${pushed.error}). ${pushed.pushed} recorded here; check the Leads in Instantly before Activate.`;
  await deps.markAdded(deps.now(), pushed.pushed, note);
  return { ok: false, error: `${note} Nothing more will be added from this button.` };
}

/** The answer when this row already has a claim, a batch, or is live; null when the add may start. */
function afterClaimLost(row: LaunchRow): AddLeadsResult | null {
  const stage = launchStage(row);
  if (stage === "live") return { ok: false, error: "The campaign is already live." };
  if (stage === "added") return { ok: true, added: row.leads_added_count ?? 0, already: true, note: row.leads_add_note };
  if (stage === "stuck") {
    return {
      ok: false,
      error: `Adding leads started at ${row.leads_adding_at} and didn't finish. Check the campaign's Leads in Instantly, then resolve it in the Go Live panel.`,
    };
  }
  return null;
}

export type ActivateDeps = {
  /** Starts the Instantly campaign. */
  activate(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Records the campaign as live. */
  markLive(now: string): Promise<void>;
  now(): string;
};

export type ActivateResult = { ok: true; already: boolean } | { ok: false; error: string };

/** Starts the paused campaign. Nothing else: no leads are added. */
export async function runActivate(row: LaunchRow, deps: ActivateDeps): Promise<ActivateResult> {
  const stage = launchStage(row);
  if (stage === "live") return { ok: true, already: true };
  if (stage === "ready") return { ok: false, error: "Add the leads first: there is nothing in Instantly to start." };
  if (stage === "stuck") return { ok: false, error: "Adding leads didn't finish. Resolve it in the Go Live panel before activating." };
  const started = await deps.activate();
  if (!started.ok) return { ok: false, error: `${started.error} The campaign is still paused; you can try Activate again.` };
  await deps.markLive(deps.now());
  return { ok: true, already: false };
}

/**
 * A stuck add (the click's server stopped after claiming): Rupert checked
 * Instantly. "added": leads are there, keep them as the first batch.
 * "empty": the campaign has no leads, free the claim so Add leads can run.
 */
export function resolveStuck(row: LaunchRow, choice: "added" | "empty", pushedHere: number) {
  if (launchStage(row) !== "stuck") return { ok: false as const, error: "Nothing to resolve: adding leads isn't stuck." };
  if (choice === "empty" && pushedHere > 0) {
    return { ok: false as const, error: `${pushedHere} contacts are recorded as added here. Keep them: choose "Leads are in Instantly".` };
  }
  return { ok: true as const, choice };
}
