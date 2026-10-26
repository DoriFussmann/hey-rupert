"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import {
  approveCoreMessages,
  editCoreMessage,
  loadCoreWorkspace,
  setCoreSlot,
  syncCoreContacts,
  writeCoreContact,
  type CoreMessageView,
  type CoreWorkspace,
} from "@/lib/outreach/core-server";
import type { CopyEmail } from "@/lib/setup";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdmin(clientId: string) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (!UUID.test(String(clientId))) return { ok: false as const, error: "Unknown client." };
  return { ok: true as const, supabase: createServiceClient(), actor: user.email ?? null };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export async function loadCoreAction(clientId: string): Promise<Result<{ workspace: CoreWorkspace }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const loaded = await loadCoreWorkspace(access.supabase, clientId);
  return loaded.ok ? { ok: true, workspace: loaded.value } : loaded;
}

/** Lines up the contacts at each Core fund (2 active, the rest reserves). */
export async function syncCoreAction(
  clientId: string,
): Promise<Result<{ workspace: CoreWorkspace; added: number; removed: number; leftOut: number }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  try {
    const synced = await syncCoreContacts(access.supabase, clientId);
    if (!synced.ok) return synced;
    const loaded = await loadCoreWorkspace(access.supabase, clientId);
    if (!loaded.ok) return loaded;
    return { ok: true, workspace: loaded.value, added: synced.value.added, removed: synced.value.removed, leftOut: synced.value.leftOut };
  } catch (err) {
    return { ok: false, error: errorText(err, "Unable to line up the contacts.") };
  }
}

/** Researches (unless fresh) and writes one contact's emails. One call per contact keeps each request short. */
export async function writeCoreAction(
  clientId: string,
  messageId: string,
  research: "auto" | "refresh" | "skip",
): Promise<Result<{ message: CoreMessageView }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  if (!isClaudeConfigured()) return { ok: false, error: "Claude is not configured (ANTHROPIC_API_KEY)." };
  if (!UUID.test(String(messageId))) return { ok: false, error: "Unknown contact." };
  const mode = research === "refresh" || research === "skip" ? research : "auto";
  try {
    const written = await writeCoreContact(access.supabase, clientId, messageId, { research: mode });
    return written.ok ? { ok: true, message: written.value } : written;
  } catch (err) {
    return { ok: false, error: errorText(err, "Unable to write this contact's emails.") };
  }
}

export async function editCoreAction(
  clientId: string,
  messageId: string,
  edit: { emails?: CopyEmail[]; note?: string },
): Promise<Result<{ message: CoreMessageView }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  if (!UUID.test(String(messageId))) return { ok: false, error: "Unknown contact." };
  const saved = await editCoreMessage(access.supabase, clientId, messageId, edit);
  return saved.ok ? { ok: true, message: saved.value } : saved;
}

export async function approveCoreAction(
  clientId: string,
  messageIds: string[],
): Promise<Result<{ workspace: CoreWorkspace; approved: number; skipped: { id: string; reason: string }[] }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const ids = (Array.isArray(messageIds) ? messageIds : []).filter((id) => UUID.test(String(id))).slice(0, 500);
  const result = await approveCoreMessages(access.supabase, clientId, ids, access.actor);
  if (!result.ok) return result;
  const loaded = await loadCoreWorkspace(access.supabase, clientId);
  if (!loaded.ok) return loaded;
  revalidatePath("/portal/setup/email-copy");
  return { ok: true, workspace: loaded.value, approved: result.value.approved.length, skipped: result.value.skipped };
}

export async function setCoreSlotAction(
  clientId: string,
  messageId: string,
  slot: "active" | "reserve",
): Promise<Result<{ message: CoreMessageView }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  if (!UUID.test(String(messageId))) return { ok: false, error: "Unknown contact." };
  const saved = await setCoreSlot(access.supabase, clientId, messageId, slot === "reserve" ? "reserve" : "active");
  if (saved.ok) revalidatePath("/portal/setup/email-copy");
  return saved.ok ? { ok: true, message: saved.value } : saved;
}
