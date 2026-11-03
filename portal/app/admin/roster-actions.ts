"use server";

import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { confirmRoster, dismissMissing, fillMissing, loadRoster, reopenRoster, suggestMissing, type RosterState } from "@/lib/match/roster/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function access(clientId: unknown) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (typeof clientId !== "string" || !/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false as const, error: "Unknown client." };
  return { ok: true as const, supabase: createServiceClient(), email: user.email ?? null, clientId };
}

const fail = (err: unknown, fallback: string) => ({ ok: false as const, error: err instanceof Error ? err.message : fallback });

async function state(supabase: ReturnType<typeof createServiceClient>, clientId: string): Promise<Result<{ state: RosterState }>> {
  const loaded = await loadRoster(supabase, clientId);
  return loaded.ok ? { ok: true, state: loaded.value } : loaded;
}

/** Step 3: the Final Roster as it stands, and the confirmed one. Read only. */
export async function loadFinalRoster(clientId: string): Promise<Result<{ state: RosterState }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The Final Roster did not load.");
  }
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : undefined);

/** 3A: fills in an added investor's missing stage, geography or sector. */
export async function fillRosterFields(clientId: string, addedId: string, fields: unknown): Promise<Result<{ state: RosterState }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (typeof addedId !== "string" || !/^[0-9a-f-]{36}$/i.test(addedId)) return { ok: false, error: "Unknown investor." };
  const f = (fields ?? {}) as Record<string, unknown>;
  try {
    const done = await fillMissing(a.supabase, a.clientId, addedId, { stages: strings(f.stages), geographies: strings(f.geographies), sectors: strings(f.sectors) });
    if (!done.ok) return done;
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The fields were not saved.");
  }
}

export async function confirmFinalRoster(clientId: string): Promise<Result<{ state: RosterState }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await confirmRoster(a.supabase, a.clientId, a.email);
    if (!done.ok) return done;
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The Final Roster was not saved.");
  }
}

export async function reopenFinalRoster(clientId: string): Promise<Result<{ state: RosterState }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await reopenRoster(a.supabase, a.clientId, a.email);
    if (!done.ok) return done;
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The Final Roster was not reopened.");
  }
}

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 8) : []);

/** 3A: Fill missing fields with AI, for a few investors at once (suggestions only). */
export async function suggestRosterFields(clientId: string, addedIds: unknown): Promise<Result<{ problems: string[] }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await suggestMissing(a.supabase, a.clientId, ids(addedIds));
    return done.ok ? { ok: true, problems: done.value.problems } : done;
  } catch (err) {
    return fail(err, "The search did not run.");
  }
}

export async function dismissRosterSuggestion(clientId: string, addedId: string): Promise<Result<object>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  if (!ids([addedId]).length) return { ok: false, error: "Unknown investor." };
  const done = await dismissMissing(a.supabase, addedId);
  return done.ok ? { ok: true } : done;
}
