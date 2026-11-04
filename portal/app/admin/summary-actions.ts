"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { SUMMARY_MIGRATION, currentFinalization, finalizeMatching, pushAllToClient, reopenMatching, type Finalization } from "@/lib/match/summary/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function access(clientId: unknown) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (typeof clientId !== "string" || !/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false as const, error: "Unknown client." };
  return { ok: true as const, supabase: createServiceClient(), email: user.email ?? null, clientId };
}

const fail = (err: unknown, fallback: string) => ({ ok: false as const, error: err instanceof Error ? err.message : fallback });

async function state(supabase: ReturnType<typeof createServiceClient>, clientId: string): Promise<Result<{ finalization: Finalization | null }>> {
  const fin = await currentFinalization(supabase, clientId);
  return fin.ok ? { ok: true, finalization: fin.value } : fin;
}

/** Whether the matching is finalized, with its summaries. Read only. */
export async function loadFinalization(clientId: string): Promise<Result<{ finalization: Finalization | null }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const loaded = await state(a.supabase, a.clientId);
    // Before the tables exist nothing can be finalized: show the steps; Finalize reports the missing SQL.
    if (!loaded.ok && loaded.error === SUMMARY_MIGRATION) return { ok: true, finalization: null };
    return loaded;
  } catch (err) {
    return fail(err, "The summary did not load.");
  }
}

export async function finalizeTheMatching(clientId: string): Promise<Result<{ finalization: Finalization | null }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await finalizeMatching(a.supabase, a.clientId, a.email);
    if (!done.ok) return done;
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The matching was not finalized.");
  }
}

export async function reopenTheMatching(clientId: string): Promise<Result<{ finalization: Finalization | null }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await reopenMatching(a.supabase, a.clientId, a.email);
    if (!done.ok) return done;
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The matching was not reopened.");
  }
}

/** Push to Client: both summaries go to the client's admin page (not the portal). */
export async function pushSummariesToClient(clientId: string): Promise<Result<{ finalization: Finalization | null }>> {
  const a = await access(clientId);
  if (!a.ok) return a;
  try {
    const done = await pushAllToClient(a.supabase, a.clientId, a.email);
    if (!done.ok) return done;
    revalidatePath(`/admin/clients/${a.clientId}`);
    return await state(a.supabase, a.clientId);
  } catch (err) {
    return fail(err, "The summary was not pushed.");
  }
}
