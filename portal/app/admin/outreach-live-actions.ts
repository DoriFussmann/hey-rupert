"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import {
  checkInbox,
  linkExistingInbox,
  loadLiveState,
  markInvoicePaid,
  pushNewlyApproved,
  saveLiveSettings,
  sendTest,
  setInvoiceUrl,
  setPaused,
  startWave2,
  type LiveState,
} from "@/lib/outreach/live-server";
import { decideReply } from "@/lib/outreach/replies-server";
import { labelReply } from "@/lib/outreach/reply-label-server";
import type { ReplyVisibility } from "@/lib/outreach/live";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdmin(id: string) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (!UUID.test(String(id))) return { ok: false as const, error: "Unknown record." };
  return { ok: true as const, supabase: createServiceClient(), actor: user.email ?? null };
}

async function withState(clientId: string, supabase: ReturnType<typeof createServiceClient>, extra: Record<string, unknown> = {}): Promise<Result<{ state: LiveState } & Record<string, unknown>>> {
  const loaded = await loadLiveState(supabase, clientId);
  if (!loaded.ok) return loaded;
  revalidatePath("/portal/setup/go-live");
  return { ok: true, state: loaded.value, ...extra };
}

export async function loadLiveAction(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  return withState(clientId, access.supabase);
}

export async function saveLiveSettingsAction(clientId: string, settings: unknown) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const saved = await saveLiveSettings(access.supabase, clientId, settings);
  if (!saved.ok) return saved;
  return withState(clientId, access.supabase);
}

export async function checkInboxAction(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const checked = await checkInbox(access.supabase, clientId);
  if (!checked.ok) return checked;
  return withState(clientId, access.supabase);
}

export async function linkInboxAction(clientId: string, email: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const linked = await linkExistingInbox(access.supabase, clientId, String(email ?? ""));
  if (!linked.ok) return linked;
  return withState(clientId, access.supabase);
}

export async function setInvoiceAction(clientId: string, url: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const saved = await setInvoiceUrl(access.supabase, clientId, String(url ?? ""));
  if (!saved.ok) return saved;
  return withState(clientId, access.supabase);
}

export async function markInvoiceAction(clientId: string, paid: boolean) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const saved = await markInvoicePaid(access.supabase, clientId, Boolean(paid), access.actor);
  if (!saved.ok) return saved;
  return withState(clientId, access.supabase);
}

export async function sendTestAction(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  if (!access.actor) return { ok: false as const, error: "Your login has no email to send the test to." };
  const sent = await sendTest(access.supabase, clientId, access.actor);
  if (!sent.ok) return sent;
  return withState(clientId, access.supabase, { testFund: sent.value.fund, testTo: access.actor });
}

export async function startWave2Action(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const started = await startWave2(access.supabase, clientId);
  if (!started.ok) return started;
  return withState(clientId, access.supabase, { pushed: started.value });
}

export async function pushApprovedAction(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const pushed = await pushNewlyApproved(access.supabase, clientId);
  if (!pushed.ok) return pushed;
  return withState(clientId, access.supabase, { pushed: pushed.value });
}

export async function setPausedAction(clientId: string, paused: boolean) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const saved = await setPaused(access.supabase, clientId, Boolean(paused));
  if (!saved.ok) return saved;
  return withState(clientId, access.supabase);
}

// Replies

export async function labelReplyAction(replyId: string) {
  const access = await requireAdmin(replyId);
  if (!access.ok) return access;
  if (!isClaudeConfigured()) return { ok: false as const, error: "Claude is not configured (ANTHROPIC_API_KEY)." };
  const labelled = await labelReply(access.supabase, replyId);
  return labelled.ok ? { ok: true as const, ...labelled.value } : labelled;
}

export async function decideReplyAction(replyId: string, decision: { visibility?: ReplyVisibility; reason?: string; label?: string }) {
  const access = await requireAdmin(replyId);
  if (!access.ok) return access;
  const visibility = decision.visibility && ["pending", "released", "withheld"].includes(decision.visibility) ? decision.visibility : undefined;
  const saved = await decideReply(access.supabase, replyId, { visibility, reason: decision.reason, label: decision.label }, access.actor);
  if (!saved.ok) return saved;
  revalidatePath("/admin/replies");
  revalidatePath("/portal/inbox");
  revalidatePath("/portal/pipeline");
  revalidatePath("/portal/campaigns");
  return { ok: true as const };
}
