"use server";

import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { isClaudeConfigured } from "@/lib/anthropic";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  checkAgainstDatabase,
  decideInvestor,
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

async function access(clientId: unknown) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (typeof clientId !== "string" || !/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false as const, error: "Unknown client." };
  return { ok: true as const, supabase: createServiceClient(), email: user.email ?? null, clientId };
}

const fail = (err: unknown, fallback: string) => ({ ok: false as const, error: err instanceof Error ? err.message : fallback });

/** Step 2 for a client: whether Step 1 is confirmed, and the current landscape. */
export async function loadLandscape(clientId: string): Promise<Result<{ stepOneConfirmed: boolean; landscape: Landscape | null }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const dry = await confirmedDryList(a.supabase, a.clientId);
    if (!dry.ok) return { ok: false, error: dry.error };
    const current = await currentLandscape(a.supabase, a.clientId);
    if (!current.ok) return { ok: false, error: current.error };
    return { ok: true, stepOneConfirmed: !!dry.value, landscape: current.value };
  } catch (err) {
    return fail(err, "Step 2 did not load.");
  }
}

/** Show Competitors: web search for funded direct competitors, saved as a draft. Up to a few minutes. */
export async function showCompetitors(clientId: string): Promise<Result<{ landscape: Landscape }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  try {
    const found = await findCompetitors(a.supabase, a.clientId, a.email);
    if (!found.ok) return { ok: false, error: found.error };
    return { ok: true, landscape: found.value };
  } catch (err) {
    return fail(err, "The competitor search failed.");
  }
}

/** Saves edits to the draft list; with confirm, locks it. Links are checked again. */
export async function saveLandscape(clientId: string, competitors: unknown[], confirm: boolean): Promise<Result<{ landscape: Landscape }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const saved = await saveCompetitors(a.supabase, a.clientId, competitors, confirm === true, a.email);
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, landscape: saved.value };
  } catch (err) {
    return fail(err, "The list was not saved.");
  }
}

/** Start over: the current list is set aside (kept on record). */
export async function startOverLandscape(clientId: string): Promise<Result<object>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  const cleared = await clearLandscape(a.supabase, a.clientId, a.email);
  return cleared.ok ? { ok: true } : { ok: false, error: cleared.error };
}

type LandscapeResult = Result<{ landscape: Landscape }>;

function wrap(value: { ok: true; value: Landscape } | { ok: false; error: string }): LandscapeResult {
  return value.ok ? { ok: true, landscape: value.value } : { ok: false, error: value.error };
}

/** Fills the empty primary sectors of the confirmed competitors. */
export async function fillCompetitorSectors(clientId: string): Promise<LandscapeResult> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  try {
    return wrap(await fillSectors(a.supabase, a.clientId));
  } catch (err) {
    return fail(err, "The sectors were not filled.");
  }
}

/** Step 2B: researches one competitor's investors and merges them into the list. The page calls it once per competitor. */
export async function findInvestorsFor(clientId: string, competitorId: string): Promise<LandscapeResult> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  if (typeof competitorId !== "string" || !competitorId || competitorId.length > 64) return { ok: false, error: "Unknown competitor." };
  try {
    return wrap(await researchInvestors(a.supabase, a.clientId, competitorId));
  } catch (err) {
    return fail(err, "The investor research failed.");
  }
}

/** Saves edits to the investor list; with confirm, locks it. */
export async function saveInvestorList(clientId: string, investors: unknown[], confirm: boolean): Promise<LandscapeResult> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    return wrap(await saveInvestors(a.supabase, a.clientId, investors, confirm === true, a.email));
  } catch (err) {
    return fail(err, "The investor list was not saved.");
  }
}

/** Start over for the investor list only; the confirmed competitors stay. */
export async function startOverInvestors(clientId: string): Promise<LandscapeResult> {
  const a = await access(clientId);
  if (!a.ok) return a;
  return wrap(await clearInvestors(a.supabase, a.clientId));
}

/** Step 2C: the confirmed investors checked against the Fund Database and the shortlist. Reads only. */
export async function runInvestorCheck(clientId: string): Promise<Result<{ check: CheckResult }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const result = await checkAgainstDatabase(a.supabase, a.clientId);
    return result.ok ? { ok: true, check: result.value } : { ok: false, error: result.error };
  } catch (err) {
    return fail(err, "The check did not run.");
  }
}

/** Records a decision on one investor, then returns the check again. */
export async function decideOnInvestor(
  clientId: string,
  investorId: string,
  patch: { firmId?: string | null; action?: "bring_back" | "leave_out" | null; note?: string; lesson?: boolean; website?: string; resetMatch?: boolean },
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
  try {
    const saved = await decideInvestor(a.supabase, a.clientId, investorId, clean, a.email);
    if (!saved.ok) return { ok: false, error: saved.error };
    return runInvestorCheck(clientId);
  } catch (err) {
    return fail(err, "The decision was not saved.");
  }
}
