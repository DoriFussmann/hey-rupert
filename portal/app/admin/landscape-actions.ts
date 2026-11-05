"use server";

import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { isClaudeConfigured } from "@/lib/anthropic";
import { createServiceClient } from "@/lib/supabase/admin";
import { asLandscapeKind } from "@/lib/match/landscape/kind";
import { lockedError } from "@/lib/match/summary/server";
import {
  checkAgainstDatabase,
  layerDone,
  decideInvestor,
  addMissingInvestor,
  confirmAdded,
  confirmCheck,
  lookAlikePreview,
  type LookAlikePreview,
  decideMany,
  applyDefaults,
  findWebsites,
  recordInvestments,
  type CheckResult,
  clearInvestors,
  clearLandscape,
  confirmedDryList,
  currentLandscape,
  fillSectors,
  findCompetitors,
  researchInvestors,
  saveCompetitors,
  saveInvestors,
  type Landscape,
} from "@/lib/match/landscape/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function access(clientId: unknown, change = true) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (typeof clientId !== "string" || !/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false as const, error: "Unknown client." };
  const supabase = createServiceClient();
  // While the matching is finalized, the steps are locked.
  if (change) {
    const locked = await lockedError(supabase, clientId);
    if (locked) return { ok: false as const, error: locked };
  }
  return { ok: true as const, supabase, email: user.email ?? null, clientId };
}

const fail = (err: unknown, fallback: string) => ({ ok: false as const, error: err instanceof Error ? err.message : fallback });

/** Step 2 for a client: whether Step 1 is confirmed, and the current landscape. */
export async function loadLandscape(clientId: string, kind?: unknown): Promise<Result<{ stepOneConfirmed: boolean; landscape: Landscape | null }>> {
  const a = await access(clientId, false);
  if (!a.ok) return a;
  try {
    const dry = await confirmedDryList(a.supabase, a.clientId);
    if (!dry.ok) return { ok: false, error: dry.error };
    const current = await currentLandscape(a.supabase, a.clientId, asLandscapeKind(kind));
    if (!current.ok) return { ok: false, error: current.error };
    // Step 3 opens once Step 2 is done; Step 2 once Step 1 is confirmed.
    if (asLandscapeKind(kind) === "comparables") {
      const two = await layerDone(a.supabase, a.clientId, "competitors");
      if (!two.ok) return { ok: false, error: two.error };
      return { ok: true, stepOneConfirmed: !!dry.value && two.value.done, landscape: current.value };
    }
    return { ok: true, stepOneConfirmed: !!dry.value, landscape: current.value };
  } catch (err) {
    return fail(err, "Step 2 did not load.");
  }
}

/** Show Competitors: web search for funded direct competitors, saved as a draft. Up to a few minutes. */
export async function showCompetitors(clientId: string, kind?: unknown): Promise<Result<{ landscape: Landscape }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  try {
    const found = await findCompetitors(a.supabase, a.clientId, a.email, asLandscapeKind(kind));
    if (!found.ok) return { ok: false, error: found.error };
    return { ok: true, landscape: found.value };
  } catch (err) {
    return fail(err, "The competitor search failed.");
  }
}

/** Saves edits to the draft list; with confirm, locks it. Links are checked again. */
export async function saveLandscape(clientId: string, competitors: unknown[], confirm: boolean, kind?: unknown): Promise<Result<{ landscape: Landscape }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const saved = await saveCompetitors(a.supabase, a.clientId, competitors, confirm === true, a.email, asLandscapeKind(kind));
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, landscape: saved.value };
  } catch (err) {
    return fail(err, "The list was not saved.");
  }
}

/** Start over: the current list is set aside (kept on record). */
export async function startOverLandscape(clientId: string, kind?: unknown): Promise<Result<object>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  const cleared = await clearLandscape(a.supabase, a.clientId, a.email, asLandscapeKind(kind));
  return cleared.ok ? { ok: true } : { ok: false, error: cleared.error };
}

type LandscapeResult = Result<{ landscape: Landscape }>;

function wrap(value: { ok: true; value: Landscape } | { ok: false; error: string }): LandscapeResult {
  return value.ok ? { ok: true, landscape: value.value } : { ok: false, error: value.error };
}

/** Fills the empty primary sectors of the confirmed competitors. */
export async function fillCompetitorSectors(clientId: string, kind?: unknown): Promise<LandscapeResult> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  try {
    return wrap(await fillSectors(a.supabase, a.clientId, asLandscapeKind(kind)));
  } catch (err) {
    return fail(err, "The sectors were not filled.");
  }
}

/** Step 2B: researches one competitor's investors and merges them into the list. The page calls it once per competitor. */
export async function findInvestorsFor(clientId: string, competitorId: string, kind?: unknown): Promise<LandscapeResult> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  if (typeof competitorId !== "string" || !competitorId || competitorId.length > 64) return { ok: false, error: "Unknown competitor." };
  try {
    return wrap(await researchInvestors(a.supabase, a.clientId, competitorId, asLandscapeKind(kind)));
  } catch (err) {
    return fail(err, "The investor research failed.");
  }
}

/** Saves edits to the investor list; with confirm, locks it. */
export async function saveInvestorList(clientId: string, investors: unknown[], confirm: boolean, kind?: unknown): Promise<LandscapeResult> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    return wrap(await saveInvestors(a.supabase, a.clientId, investors, confirm === true, a.email, asLandscapeKind(kind)));
  } catch (err) {
    return fail(err, "The investor list was not saved.");
  }
}

/** Start over for the investor list only; the confirmed competitors stay. */
export async function startOverInvestors(clientId: string, kind?: unknown): Promise<LandscapeResult> {
  const a = await access(clientId);
  if (!a.ok) return a;
  return wrap(await clearInvestors(a.supabase, a.clientId, asLandscapeKind(kind)));
}

/** Step 2C: the confirmed investors checked against the Fund Database and the shortlist. Reads only. */
export async function runInvestorCheck(clientId: string, kind?: unknown): Promise<Result<{ check: CheckResult }>> {
  const a = await access(clientId, false);
  if (!a.ok) return a;
  try {
    const result = await checkAgainstDatabase(a.supabase, a.clientId, asLandscapeKind(kind));
    return result.ok ? { ok: true, check: result.value } : { ok: false, error: result.error };
  } catch (err) {
    return fail(err, "The check did not run.");
  }
}

/** Records a decision on one investor, then returns the check again. */
export async function decideOnInvestor(
  clientId: string,
  investorId: string,
  patch: {
    firmId?: string | null;
    action?: "bring_back" | "leave_out" | null;
    note?: string;
    lesson?: boolean;
    website?: string;
    resetMatch?: boolean;
    clear?: boolean;
    unsure?: boolean;
    removed?: boolean;
  },
  kind?: unknown,
): Promise<Result<{ check: CheckResult }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (typeof investorId !== "string" || !investorId || investorId.length > 64) return { ok: false, error: "Unknown investor." };
  const clean: typeof patch = {};
  if (patch?.firmId === null || typeof patch?.firmId === "string") clean.firmId = patch.firmId === null ? null : patch.firmId.slice(0, 64);
  if (patch?.action === null || patch?.action === "bring_back" || patch?.action === "leave_out") clean.action = patch.action;
  if (typeof patch?.note === "string") clean.note = patch.note;
  if (typeof patch?.lesson === "boolean") clean.lesson = patch.lesson;
  if (typeof patch?.website === "string") clean.website = patch.website.slice(0, 500);
  if (patch?.resetMatch === true) clean.resetMatch = true;
  if (patch?.clear === true) clean.clear = true;
  if (typeof patch?.unsure === "boolean") clean.unsure = patch.unsure;
  if (typeof patch?.removed === "boolean") clean.removed = patch.removed;
  try {
    const saved = await decideInvestor(a.supabase, a.clientId, investorId, clean, a.email, false, asLandscapeKind(kind));
    if (!saved.ok) return { ok: false, error: saved.error };
    return runInvestorCheck(clientId, kind);
  } catch (err) {
    return fail(err, "The decision was not saved.");
  }
}

/** The same action on many investors (the summary table's "apply to all"), then the check again. */
export async function decideForGroup(
  clientId: string,
  investorIds: string[],
  action: "bring_back" | "leave_out" | null,
  kind?: unknown,
): Promise<Result<{ check: CheckResult; changed: number }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!Array.isArray(investorIds) || investorIds.length > 2000) return { ok: false, error: "Unknown investors." };
  if (action !== null && action !== "bring_back" && action !== "leave_out") return { ok: false, error: "Unknown action." };
  try {
    const done = await decideMany(a.supabase, a.clientId, investorIds.filter((id) => typeof id === "string").map((id) => id.slice(0, 64)), action, a.email, asLandscapeKind(kind));
    if (!done.ok) return { ok: false, error: done.error };
    const check = await runInvestorCheck(clientId, kind);
    return check.ok ? { ok: true, check: check.check, changed: done.value } : check;
  } catch (err) {
    return fail(err, "The decisions were not saved.");
  }
}

/** 2C: Apply Default to All, for the funds still on their default. */
export async function applyDefaultsToAll(clientId: string, kind?: unknown): Promise<Result<{ check: CheckResult; broughtBack: number; leftOut: number }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await applyDefaults(a.supabase, a.clientId, a.email, asLandscapeKind(kind));
    if (!done.ok) return { ok: false, error: done.error };
    const check = await runInvestorCheck(clientId, kind);
    return check.ok ? { ok: true, check: check.check, ...done.value } : check;
  } catch (err) {
    return fail(err, "The defaults were not applied.");
  }
}

/** Records the matched investors' investments in the database, company-wide. */
export async function recordInvestmentsInDb(clientId: string, kind?: unknown): Promise<Result<{ check: CheckResult; recorded: number }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await recordInvestments(a.supabase, a.clientId, a.email, asLandscapeKind(kind));
    if (!done.ok) return { ok: false, error: done.error };
    const check = await runInvestorCheck(clientId, kind);
    return check.ok ? { ok: true, check: check.check, recorded: done.value } : check;
  } catch (err) {
    return fail(err, "The investments were not recorded.");
  }
}

/** Find websites for a few investors (the page calls it batch by batch), then the check again. */
export async function findWebsitesFor(clientId: string, investorIds: string[], kind?: unknown): Promise<Result<{ check: CheckResult; found: number }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  if (!Array.isArray(investorIds) || investorIds.length > 20) return { ok: false, error: "Unknown investors." };
  try {
    const done = await findWebsites(a.supabase, a.clientId, investorIds.filter((id) => typeof id === "string").map((id) => id.slice(0, 64)), asLandscapeKind(kind));
    if (!done.ok) return { ok: false, error: done.error };
    const check = await runInvestorCheck(clientId, kind);
    return check.ok ? { ok: true, check: check.check, found: done.value } : check;
  } catch (err) {
    return fail(err, "Find websites failed.");
  }
}

/** The final confirmation of the check, or reopening it. */
export async function confirmInvestorCheck(clientId: string, confirm: boolean, kind?: unknown): Promise<Result<{ check: CheckResult }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await confirmCheck(a.supabase, a.clientId, confirm === true, a.email, asLandscapeKind(kind));
    if (!done.ok) return { ok: false, error: done.error };
    return runInvestorCheck(clientId, kind);
  } catch (err) {
    return fail(err, "The check was not confirmed.");
  }
}

/** Try and Add to DB for one missing investor (the page calls it one by one), then the check again. */
export async function addInvestorToDb(clientId: string, investorId: string, kind?: unknown): Promise<Result<{ check: CheckResult; created: boolean; message: string }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  if (typeof investorId !== "string" || !investorId || investorId.length > 64) return { ok: false, error: "Unknown investor." };
  try {
    const done = await addMissingInvestor(a.supabase, a.clientId, investorId, a.email, asLandscapeKind(kind));
    if (!done.ok) return { ok: false, error: done.error };
    const check = await runInvestorCheck(clientId, kind);
    return check.ok ? { ok: true, check: check.check, created: done.value.created, message: done.value.message } : check;
  } catch (err) {
    return fail(err, "Try and Add to DB failed.");
  }
}

/** Look-alike funds (preview): the shortlist ranked by resemblance to the competitors' investors. Reads only. */
export async function loadLookAlikes(clientId: string, kind?: unknown): Promise<Result<{ preview: LookAlikePreview }>> {
  const a = await access(clientId, false);
  if (!a.ok) return a;
  try {
    const result = await lookAlikePreview(a.supabase, a.clientId, asLandscapeKind(kind));
    return result.ok ? { ok: true, preview: result.value } : { ok: false, error: result.error };
  } catch (err) {
    return fail(err, "The look-alike preview did not load.");
  }
}

/** Confirms Step 2D (Try and Add to DB; what wasn't added is skipped), or reopens it. */
export async function confirmAddedStep(clientId: string, confirm: boolean, kind?: unknown): Promise<Result<{ check: CheckResult }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await confirmAdded(a.supabase, a.clientId, confirm === true, a.email, asLandscapeKind(kind));
    if (!done.ok) return { ok: false, error: done.error };
    return runInvestorCheck(clientId, kind);
  } catch (err) {
    return fail(err, "Step 2D was not confirmed.");
  }
}
