"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import {
  goLive,
  isTestPilot,
  pollInboxConnect,
  startInboxConnect,
  checkInbox,
  checkWebhookReachable,
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
import { notifyAdmin, notifyClient } from "@/lib/notify";
import { sendDailySummary } from "@/lib/outreach/daily-summary-server";
import { confirmGoLiveStep, pushGoLive, renderGoLiveEmail, type GoLiveEmail } from "@/lib/outreach/go-live-step-server";
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

// Test Pilot only: Rupert takes the client's steps (connect an inbox, Go Live).
// In test mode every email goes to a + address of the test inbox.

async function requireTestPilot(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  if (!(await isTestPilot(access.supabase, clientId))) {
    return { ok: false as const, error: "Only for Test Pilot clients. A real client connects their own inbox and clicks Go Live." };
  }
  return access;
}

export async function startTestInboxAction(clientId: string, provider: "google" | "microsoft") {
  const access = await requireTestPilot(clientId);
  if (!access.ok) return access;
  const started = await startInboxConnect(access.supabase, clientId, provider === "microsoft" ? "microsoft" : "google");
  return started.ok ? { ok: true as const, authUrl: started.value.authUrl } : started;
}

export async function pollTestInboxAction(clientId: string) {
  const access = await requireTestPilot(clientId);
  if (!access.ok) return access;
  const polled = await pollInboxConnect(access.supabase, clientId);
  return polled.ok ? { ok: true as const, ...polled.value } : polled;
}

export async function goLiveTestAction(clientId: string) {
  const access = await requireTestPilot(clientId);
  if (!access.ok) return access;
  const launched = await goLive(access.supabase, clientId, access.actor);
  if (!launched.ok) return launched;
  await confirmGoLiveStep(access.supabase, clientId, access.actor);
  revalidateClient(clientId);
  return withState(clientId, access.supabase, { added: launched.value.wave1 });
}

function revalidateClient(clientId: string) {
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/setup", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);
}

/**
 * The real Go Live, after the client approved the launch: the campaign is
 * created and starts, the client is emailed that they're live.
 */
export async function goLiveNowAction(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const launched = await goLive(access.supabase, clientId, access.actor);
  if (!launched.ok) return launched;
  await confirmGoLiveStep(access.supabase, clientId, access.actor);
  await notifyAdmin(access.supabase, clientId, "went_live", { email: false });
  const emailed = await notifyClient(access.supabase, clientId, "campaign_live");
  revalidateClient(clientId);
  revalidatePath("/portal/live-campaign");
  return withState(clientId, access.supabase, { added: launched.value.wave1, emailError: emailed.ok ? null : emailed.reason });
}

/** Emails Rupert today's daily summary now (it also goes out weekdays at 5pm Eastern). */
export async function sendSummaryNowAction(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const result = await sendDailySummary(access.supabase, { force: true });
  if (!result.sent) return { ok: false as const, error: result.email && !result.email.ok ? result.email.reason : `Not sent: ${result.reason ?? "unknown"}.` };
  return withState(clientId, access.supabase, { clients: result.clients });
}

/** Checks that Instantly can reach the portal's webhook (reply tracking). */
export async function checkReplyTrackingAction(clientId: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const checked = await checkWebhookReachable();
  if (!checked.ok) return checked;
  return withState(clientId, access.supabase);
}

// Setup step 4: Send launch package (email, with the first monthly invoice).

export async function draftGoLiveEmailAction(clientId: string, invoiceUrl: string) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const rendered = await renderGoLiveEmail(access.supabase, clientId, String(invoiceUrl ?? ""));
  return rendered.ok ? { ok: true as const, ...rendered.value } : rendered;
}

export async function pushGoLiveAction(clientId: string, invoiceUrl: string, email: GoLiveEmail) {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const pushed = await pushGoLive(access.supabase, clientId, { invoiceUrl: String(invoiceUrl ?? ""), email });
  if (!pushed.ok) return pushed;
  revalidateClient(clientId);
  return withState(clientId, access.supabase, {
    version: pushed.value.version,
    emailError: pushed.value.clientEmail.ok ? null : pushed.value.clientEmail.reason,
  });
}
