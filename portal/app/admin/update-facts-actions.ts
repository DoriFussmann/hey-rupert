"use server";

import { revalidatePath } from "next/cache";
import { isClaudeConfigured } from "@/lib/anthropic";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { listFactUpdates, runUpdateFacts, type FactUpdateRecord } from "@/lib/update-facts-server";

const UUID = /^[0-9a-f-]{36}$/i;

async function requireAdmin(clientId: string) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (!UUID.test(String(clientId ?? ""))) return { ok: false as const, error: "Unknown client." };
  return { ok: true as const, supabase: createServiceClient(), actor: user.email ?? null };
}

/**
 * Update Facts: corrects the facts in everything Rupert wrote about the
 * company from the files and client notes that are new since the last
 * analysis, plus Rupert's own note. Nothing is sent to the client.
 */
export async function updateFactsAction(
  clientId: string,
  note: string,
): Promise<{ ok: true; record: FactUpdateRecord } | { ok: false; error: string }> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  if (!isClaudeConfigured()) return { ok: false, error: "Claude is not configured. Add ANTHROPIC_API_KEY in Vercel." };
  const result = await runUpdateFacts(access.supabase, clientId, { note: String(note ?? ""), actor: access.actor });
  if (!result.ok) return result;
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, record: result.value };
}

/** The last Update Facts runs, newest first. */
export async function factUpdatesAction(
  clientId: string,
): Promise<{ ok: true; records: FactUpdateRecord[] } | { ok: false; error: string }> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const result = await listFactUpdates(access.supabase, clientId);
  return result.ok ? { ok: true, records: result.value } : result;
}
