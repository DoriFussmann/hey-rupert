"use server";

import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { cleanInputs, confirmPlan, loadPlan, reopenPlan, type PlanState } from "@/lib/match/plan/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function access(clientId: unknown) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (typeof clientId !== "string" || !/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false as const, error: "Unknown client." };
  return { ok: true as const, supabase: createServiceClient(), email: user.email ?? null, clientId };
}

const fail = (err: unknown, fallback: string) => ({ ok: false as const, error: err instanceof Error ? err.message : fallback });

async function state(supabase: ReturnType<typeof createServiceClient>, clientId: string): Promise<Result<{ state: PlanState }>> {
  const loaded = await loadPlan(supabase, clientId);
  return loaded.ok ? { ok: true, state: loaded.value } : loaded;
}

/** Step 4: the Roster in tiers and ranked, and the confirmed Plan. Read only. */
export async function loadThePlan(clientId: string): Promise<Result<{ state: PlanState }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The Plan did not load.");
  }
}

export async function confirmThePlan(clientId: string, inputs: unknown): Promise<Result<{ state: PlanState }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  const clean = cleanInputs(inputs);
  if (!clean) return { ok: false, error: "Fill in every input." };
  try {
    const done = await confirmPlan(a.supabase, a.clientId, clean, a.email);
    if (!done.ok) return done;
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The Plan was not saved.");
  }
}

export async function reopenThePlan(clientId: string): Promise<Result<{ state: PlanState }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await reopenPlan(a.supabase, a.clientId, a.email);
    if (!done.ok) return done;
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The Plan was not reopened.");
  }
}
