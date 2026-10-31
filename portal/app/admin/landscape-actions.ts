"use server";

import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { isClaudeConfigured } from "@/lib/anthropic";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  clearLandscape,
  confirmedDryList,
  currentLandscape,
  findCompetitors,
  saveCompetitors,
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
