import "server-only";
import { timingSafeEqual } from "crypto";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  activateCampaign,
  addLeads,
  createCampaign,
  createWebhook,
  enableWarmup,
  getAccount,
  isInstantlyConfigured,
  oauthInit,
  oauthStatus,
  pauseCampaign,
  type OAuthProvider,
} from "@/lib/instantly";
import { advanceStage } from "@/lib/kickoff";
import { loadCampaignState } from "@/lib/outreach/campaign-server";
import { asEmailCopy } from "@/lib/setup";
import { loadSetupSteps } from "@/lib/setup-server";
import { loadOutreachMessages } from "@/lib/outreach/core-server";
import { isApproved } from "@/lib/outreach/core";
import {
  asLiveSettings,
  campaignBody,
  goLiveGaps,
  inboxHealthy,
  inboxStatusText,
  isWave2Due,
  leadFor,
  leadsForWave,
  type LiveSettings,
} from "@/lib/outreach/live";
import { PORTAL_URL } from "@/lib/portal-url";
import { isStripeInvoiceLink, STRIPE_INVOICE_LINK_ERROR } from "@/lib/service-order";
import { normalizeInvoiceUrl, type PaidInvoice } from "@/lib/stripe-webhook";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const OUTREACH_LIVE_MISSING =
  "The Go Live columns are missing. Run portal/supabase/outreach_live.sql in the Supabase SQL editor, then try again.";

function tableError(message: string, code?: string) {
  return code === "42703" || code === "42P01" || /outreach_replies|outreach_events|inbox_email|instantly_campaign_id|pushed_at/.test(message) || message.toLowerCase().includes("schema cache")
    ? OUTREACH_LIVE_MISSING
    : message;
}

const LIVE_STAGES_FROM = ["setup"];

export const CONSENT_TEXT = (inbox: string) =>
  `I authorize Rupert to send the investor emails I approved from ${inbox}, in my name, and to receive the replies so he can pass on the ones that matter.`;

// ---------------------------------------------------------------------------
// The live row

export type LiveRow = {
  settings: LiveSettings;
  inbox_email: string | null;
  inbox_account_id: string | null;
  inbox_connected_at: string | null;
  inbox_status: number | null;
  inbox_checked_at: string | null;
  oauth_session_id: string | null;
  oauth_expires_at: string | null;
  invoice_url: string | null;
  invoice_paid_at: string | null;
  instantly_campaign_id: string | null;
  instantly_webhook_id: string | null;
  live_at: string | null;
  live_by: string | null;
  wave2_pushed_at: string | null;
  paused_at: string | null;
  test_campaign_id: string | null;
  test_sent_at: string | null;
};

const s = (value: unknown) => (value == null || value === "" ? null : String(value));

async function loadLiveRow(supabase: ServiceClient, clientId: string): Promise<Result<LiveRow>> {
  const { data, error } = await supabase.from("outreach_campaigns").select("*").eq("client_id", clientId).maybeSingle();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    value: {
      settings: asLiveSettings(row.settings),
      inbox_email: s(row.inbox_email),
      inbox_account_id: s(row.inbox_account_id),
      inbox_connected_at: s(row.inbox_connected_at),
      inbox_status: row.inbox_status == null ? null : Number(row.inbox_status),
      inbox_checked_at: s(row.inbox_checked_at),
      oauth_session_id: s(row.oauth_session_id),
      oauth_expires_at: s(row.oauth_expires_at),
      invoice_url: s(row.invoice_url),
      invoice_paid_at: s(row.invoice_paid_at),
      instantly_campaign_id: s(row.instantly_campaign_id),
      instantly_webhook_id: s(row.instantly_webhook_id),
      live_at: s(row.live_at),
      live_by: s(row.live_by),
      wave2_pushed_at: s(row.wave2_pushed_at),
      paused_at: s(row.paused_at),
      test_campaign_id: s(row.test_campaign_id),
      test_sent_at: s(row.test_sent_at),
    },
  };
}

async function saveLive(supabase: ServiceClient, clientId: string, patch: Record<string, unknown>): Promise<Result<null>> {
  const { error } = await supabase
    .from("outreach_campaigns")
    .upsert({ client_id: clientId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
  return error ? { ok: false, error: tableError(error.message, error.code) } : { ok: true, value: null };
}

export type LiveState = {
  instantlyReady: boolean;
  campaignReady: boolean;
  /** Why the campaign isn't ready, for Rupert. */
  campaignNote: string | null;
  inbox: { email: string; connectedAt: string | null; status: number | null; statusText: string; healthy: boolean; checkedAt: string | null } | null;
  invoice: { url: string | null; paidAt: string | null };
  settings: LiveSettings;
  live: { at: string; by: string | null; campaignId: string | null; wave2PushedAt: string | null; pausedAt: string | null } | null;
  gaps: string[];
  counts: { wave1: number; wave2: number; pushed: number };
  testSentAt: string | null;
  consentText: string | null;
};

export async function loadLiveState(supabase: ServiceClient, clientId: string): Promise<Result<LiveState>> {
  const [row, campaign, messages] = await Promise.all([
    loadLiveRow(supabase, clientId),
    loadCampaignState(supabase, clientId),
    loadOutreachMessages(supabase, clientId),
  ]);
  if (!row.ok) return row;
  if (!campaign.ok) return campaign;
  if (!messages.ok) return messages;
  const r = row.value;
  const c = campaign.value;
  const campaignNote = !c.built
    ? "Build the campaign first."
    : c.stale
      ? c.stale
      : c.notApproved > 0
        ? `${c.notApproved} contact${c.notApproved === 1 ? " was" : "s were"} edited since approval. Approve them or move them to reserve.`
        : c.blockers[0] ?? null;
  const campaignReady = !campaignNote;
  const healthy = inboxHealthy(r.inbox_status);
  const pushed = messages.value.filter((m) => m.pushed_at).length;
  return {
    ok: true,
    value: {
      instantlyReady: isInstantlyConfigured() && Boolean(process.env.INSTANTLY_WEBHOOK_SECRET),
      campaignReady,
      campaignNote,
      inbox: r.inbox_email
        ? { email: r.inbox_email, connectedAt: r.inbox_connected_at, status: r.inbox_status, statusText: inboxStatusText(r.inbox_status), healthy, checkedAt: r.inbox_checked_at }
        : null,
      invoice: { url: r.invoice_url, paidAt: r.invoice_paid_at },
      settings: r.settings,
      live: r.live_at ? { at: r.live_at, by: r.live_by, campaignId: r.instantly_campaign_id, wave2PushedAt: r.wave2_pushed_at, pausedAt: r.paused_at } : null,
      gaps: goLiveGaps({
        campaignReady,
        inboxConnected: Boolean(r.inbox_email),
        inboxHealthy: healthy,
        invoicePaid: Boolean(r.invoice_paid_at),
        alreadyLive: Boolean(r.live_at),
      }),
      counts: {
        wave1: c.summary?.wave1 ?? 0,
        wave2: c.summary?.wave2 ?? 0,
        pushed,
      },
      testSentAt: r.test_sent_at,
      consentText: r.inbox_email ? CONSENT_TEXT(r.inbox_email) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// The client's inbox

export async function startInboxConnect(supabase: ServiceClient, clientId: string, provider: OAuthProvider): Promise<Result<{ authUrl: string }>> {
  if (!isInstantlyConfigured()) return { ok: false, error: "Sending isn't set up yet. Rupert has been told." };
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  if (row.value.live_at) return { ok: false, error: "Your campaign is live. Ask Rupert before changing the inbox." };
  const init = await oauthInit(provider);
  if (!init.ok) return init;
  const saved = await saveLive(supabase, clientId, { oauth_session_id: init.value.session_id, oauth_expires_at: init.value.expires_at });
  if (!saved.ok) return saved;
  return { ok: true, value: { authUrl: init.value.auth_url } };
}

/** Checks the client's inbox with Instantly and saves its status. */
export async function checkInbox(supabase: ServiceClient, clientId: string): Promise<Result<{ status: number | null }>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  if (!row.value.inbox_email) return { ok: false, error: "No inbox is connected." };
  const account = await getAccount(row.value.inbox_email);
  if (!account.ok) return account;
  const status = typeof account.value.status === "number" ? account.value.status : null;
  const saved = await saveLive(supabase, clientId, { inbox_status: status, inbox_checked_at: new Date().toISOString() });
  return saved.ok ? { ok: true, value: { status } } : saved;
}

export async function pollInboxConnect(
  supabase: ServiceClient,
  clientId: string,
): Promise<Result<{ state: "pending" | "connected" | "failed"; message?: string }>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const session = row.value.oauth_session_id;
  if (!session) return row.value.inbox_email ? { ok: true, value: { state: "connected" } } : { ok: true, value: { state: "failed", message: "Start again." } };
  const status = await oauthStatus(session);
  if (!status.ok) return status;
  const value = status.value;
  if (value.status === "pending") return { ok: true, value: { state: "pending" } };
  if (value.status === "success") {
    const saved = await saveLive(supabase, clientId, {
      inbox_email: value.email,
      inbox_account_id: value.account_id ?? null,
      inbox_connected_at: new Date().toISOString(),
      oauth_session_id: null,
      oauth_expires_at: null,
    });
    if (!saved.ok) return saved;
    await enableWarmup([value.email]);
    await checkInbox(supabase, clientId);
    return { ok: true, value: { state: "connected" } };
  }
  await saveLive(supabase, clientId, { oauth_session_id: null, oauth_expires_at: null });
  if (value.status === "error" && value.error === "account_exists") {
    return { ok: true, value: { state: "failed", message: "This inbox is already connected to Rupert's sending account. Tell Rupert and he'll link it." } };
  }
  return {
    ok: true,
    value: { state: "failed", message: value.status === "expired" ? "The sign-in timed out. Try again." : "The sign-in didn't complete. Try again." },
  };
}

/** Rupert links an inbox that is already in the Instantly workspace. */
export async function linkExistingInbox(supabase: ServiceClient, clientId: string, email: string): Promise<Result<null>> {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { ok: false, error: "Enter the inbox's email address." };
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  if (row.value.live_at) return { ok: false, error: "The campaign is live; the inbox can't change now." };
  const account = await getAccount(clean);
  if (!account.ok) return { ok: false, error: account.status === 404 ? "Instantly has no account with that email." : account.error };
  return saveLive(supabase, clientId, {
    inbox_email: clean,
    inbox_connected_at: new Date().toISOString(),
    inbox_status: typeof account.value.status === "number" ? account.value.status : null,
    inbox_checked_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// The first monthly invoice (Service Order 3.4: paying it confirms the launch)

export async function setInvoiceUrl(supabase: ServiceClient, clientId: string, url: string): Promise<Result<null>> {
  const clean = url.trim();
  if (clean && !isStripeInvoiceLink(clean)) return { ok: false, error: STRIPE_INVOICE_LINK_ERROR };
  return saveLive(supabase, clientId, { invoice_url: clean || null });
}

export async function markInvoicePaid(supabase: ServiceClient, clientId: string, paid: boolean, actor: string | null): Promise<Result<null>> {
  return saveLive(supabase, clientId, { invoice_paid_at: paid ? new Date().toISOString() : null, invoice_marked_by: paid ? actor : null });
}

/** Stripe invoice.paid: marks a client's first monthly invoice paid when the link matches. */
export async function recordCampaignInvoicePayment(supabase: ServiceClient, invoice: PaidInvoice): Promise<"recorded" | "already_paid" | "unmatched" | "error"> {
  const target = normalizeInvoiceUrl(invoice.hostedInvoiceUrl);
  if (!target) return "unmatched";
  const { data, error } = await supabase.from("outreach_campaigns").select("client_id, invoice_url, invoice_paid_at").not("invoice_url", "is", null);
  if (error) return /invoice_url/.test(error.message) ? "unmatched" : "error";
  const match = (data ?? []).find((row) => normalizeInvoiceUrl(String(row.invoice_url)) === target);
  if (!match) return "unmatched";
  if (match.invoice_paid_at) return "already_paid";
  const saved = await saveLive(supabase, String(match.client_id), { invoice_paid_at: new Date().toISOString(), invoice_marked_by: "stripe" });
  return saved.ok ? "recorded" : "error";
}

export async function saveLiveSettings(supabase: ServiceClient, clientId: string, value: unknown): Promise<Result<LiveSettings>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  if (row.value.live_at) return { ok: false, error: "The campaign is live; change its settings in Instantly." };
  const settings = asLiveSettings(value);
  const saved = await saveLive(supabase, clientId, { settings });
  return saved.ok ? { ok: true, value: settings } : saved;
}

// ---------------------------------------------------------------------------
// Pushing to Instantly

async function optOutLine(supabase: ServiceClient, clientId: string) {
  const grouped = await loadSetupSteps(supabase, [clientId]);
  const row = (grouped.get(clientId) ?? []).find((item) => item.step === "email_copy");
  const copy = asEmailCopy(row?.published);
  return copy.typed?.opt_out_line ?? "";
}


async function pushWave(supabase: ServiceClient, clientId: string, campaignId: string, wave: 1 | 2): Promise<Result<number>> {
  const messages = await loadOutreachMessages(supabase, clientId);
  if (!messages.ok) return messages;
  const leads = leadsForWave(messages.value, wave);
  if (leads.length === 0) return { ok: true, value: 0 };
  const optOut = await optOutLine(supabase, clientId);
  let pushed = 0;
  for (let i = 0; i < leads.length; i += 1000) {
    const chunk = leads.slice(i, i + 1000);
    const added = await addLeads(campaignId, chunk.map((m) => leadFor(m, optOut)));
    if (!added.ok) return { ok: false, error: `${added.error} ${pushed} leads were added before this.` };
    const now = new Date().toISOString();
    const ids = new Map((added.value.created_leads ?? []).map((lead) => [lead.index, lead.id]));
    for (let index = 0; index < chunk.length; index += 1) {
      const { error } = await supabase
        .from("outreach_messages")
        .update({ pushed_at: now, instantly_lead_id: ids.get(index) ?? null })
        .eq("id", chunk[index].id);
      if (error) return { ok: false, error: tableError(error.message, error.code) };
    }
    pushed += chunk.length;
  }
  return { ok: true, value: pushed };
}

async function companyName(supabase: ServiceClient, clientId: string) {
  const { data } = await supabase.from("clients").select("company_name").eq("id", clientId).maybeSingle();
  return String(data?.company_name ?? "Client").trim() || "Client";
}

/**
 * The client's Go Live: creates the Instantly campaign, its webhook, adds the
 * first wave and starts it. Each step saves its progress, so a retry after a
 * failure continues where it stopped.
 */
export async function goLive(supabase: ServiceClient, clientId: string, actor: string | null, consent: boolean): Promise<Result<{ wave1: number }>> {
  if (!consent) return { ok: false, error: "Tick the authorization to go live." };
  if (!isInstantlyConfigured() || !process.env.INSTANTLY_WEBHOOK_SECRET) {
    return { ok: false, error: "Sending isn't set up yet (INSTANTLY_API_KEY, INSTANTLY_WEBHOOK_SECRET). Rupert has been told." };
  }
  const state = await loadLiveState(supabase, clientId);
  if (!state.ok) return state;
  if (state.value.gaps.length > 0) return { ok: false, error: state.value.gaps.join(" ") };
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const inbox = row.value.inbox_email!;

  let campaignId = row.value.instantly_campaign_id;
  if (!campaignId) {
    const name = `${await companyName(supabase, clientId)} · investor outreach`;
    const created = await createCampaign(campaignBody(name, inbox, row.value.settings));
    if (!created.ok) return created;
    campaignId = created.value.id;
    const saved = await saveLive(supabase, clientId, { instantly_campaign_id: campaignId });
    if (!saved.ok) return saved;
  }

  if (!row.value.instantly_webhook_id) {
    const hook = await createWebhook({
      target_hook_url: `${PORTAL_URL}/api/instantly/webhook`,
      event_type: "all_events",
      campaign: campaignId,
      name: `Hey Rupert ${clientId.slice(0, 8)}`,
      headers: { Authorization: `Bearer ${process.env.INSTANTLY_WEBHOOK_SECRET}` },
    });
    if (!hook.ok) return hook;
    const saved = await saveLive(supabase, clientId, { instantly_webhook_id: hook.value.id });
    if (!saved.ok) return saved;
  }

  const wave1 = await pushWave(supabase, clientId, campaignId, 1);
  if (!wave1.ok) return wave1;
  const settings = row.value.settings;
  let wave2Pushed: string | null = null;
  if (settings.wave2_delay_days === 0) {
    const wave2 = await pushWave(supabase, clientId, campaignId, 2);
    if (!wave2.ok) return wave2;
    wave2Pushed = new Date().toISOString();
  }

  const activated = await activateCampaign(campaignId);
  if (!activated.ok) return activated;

  const now = new Date().toISOString();
  const saved = await saveLive(supabase, clientId, {
    live_at: now,
    live_by: actor,
    consent_text: CONSENT_TEXT(inbox),
    ...(wave2Pushed ? { wave2_pushed_at: wave2Pushed } : {}),
  });
  if (!saved.ok) return saved;
  await advanceStage(supabase, clientId, LIVE_STAGES_FROM, "live");
  return { ok: true, value: { wave1: wave1.value } };
}

/** Adds each fund's second contact. From the daily cron once due, or by Rupert. */
export async function startWave2(supabase: ServiceClient, clientId: string): Promise<Result<number>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  if (!row.value.live_at || !row.value.instantly_campaign_id) return { ok: false, error: "The campaign isn't live." };
  if (row.value.wave2_pushed_at) return { ok: true, value: 0 };
  const pushed = await pushWave(supabase, clientId, row.value.instantly_campaign_id, 2);
  if (!pushed.ok) return pushed;
  const saved = await saveLive(supabase, clientId, { wave2_pushed_at: new Date().toISOString() });
  return saved.ok ? pushed : saved;
}

/**
 * After Go Live: adds contacts approved since (a reserve Rupert activated to
 * replace a bounce, say). Second contacts wait for wave 2 unless it started.
 */
export async function pushNewlyApproved(supabase: ServiceClient, clientId: string): Promise<Result<number>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const id = row.value.instantly_campaign_id;
  if (!row.value.live_at || !id) return { ok: false, error: "The campaign isn't live." };
  const first = await pushWave(supabase, clientId, id, 1);
  if (!first.ok) return first;
  if (!row.value.wave2_pushed_at) return first;
  const second = await pushWave(supabase, clientId, id, 2);
  return second.ok ? { ok: true, value: first.value + second.value } : second;
}

/** Daily: starts wave 2 for every live campaign that is due. */
export async function runDueWaves(supabase: ServiceClient) {
  const { data, error } = await supabase
    .from("outreach_campaigns")
    .select("client_id, live_at, settings, paused_at")
    .not("live_at", "is", null)
    .is("wave2_pushed_at", null);
  if (error) return { started: 0, errors: [tableError(error.message, error.code)] };
  let started = 0;
  const errors: string[] = [];
  for (const row of data ?? []) {
    if (row.paused_at) continue;
    if (!isWave2Due(String(row.live_at), asLiveSettings(row.settings).wave2_delay_days)) continue;
    const result = await startWave2(supabase, String(row.client_id));
    if (result.ok) started += 1;
    else errors.push(`${row.client_id}: ${result.error}`);
  }
  return { started, errors };
}

export async function setPaused(supabase: ServiceClient, clientId: string, paused: boolean): Promise<Result<null>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const id = row.value.instantly_campaign_id;
  if (!row.value.live_at || !id) return { ok: false, error: "The campaign isn't live." };
  const result = paused ? await pauseCampaign(id) : await activateCampaign(id);
  if (!result.ok) return result;
  return saveLive(supabase, clientId, { paused_at: paused ? new Date().toISOString() : null });
}

/**
 * Sends one contact's three emails to Rupert from the client's inbox, two
 * minutes apart, to check formatting and threading before Go Live.
 */
export async function sendTest(supabase: ServiceClient, clientId: string, to: string): Promise<Result<{ fund: string }>> {
  if (!isInstantlyConfigured()) return { ok: false, error: "Instantly is not configured (INSTANTLY_API_KEY)." };
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  if (!row.value.inbox_email) return { ok: false, error: "Connect the client's inbox first." };
  const messages = await loadOutreachMessages(supabase, clientId);
  if (!messages.ok) return messages;
  const sample = messages.value.find((m) => m.slot === "active" && m.tier === 1 && isApproved(m)) ?? messages.value.find((m) => m.slot === "active" && isApproved(m));
  if (!sample) return { ok: false, error: "Build the campaign first: the test sends one approved contact's emails." };
  const name = `TEST · ${await companyName(supabase, clientId)} · ${new Date().toISOString().slice(0, 16)}`;
  const created = await createCampaign(campaignBody(name, row.value.inbox_email, row.value.settings, { test: true }));
  if (!created.ok) return created;
  const added = await addLeads(created.value.id, [leadFor(sample, await optOutLine(supabase, clientId), to)]);
  if (!added.ok) return added;
  const activated = await activateCampaign(created.value.id);
  if (!activated.ok) return activated;
  const saved = await saveLive(supabase, clientId, { test_campaign_id: created.value.id, test_sent_at: new Date().toISOString() });
  return saved.ok ? { ok: true, value: { fund: sample.fund_name } } : saved;
}

/** Constant-time check of the webhook's Authorization header. */
export function webhookAuthorized(header: string | null) {
  const secret = process.env.INSTANTLY_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
