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
  updateAccount,
  updateCampaign,
  type OAuthProvider,
} from "@/lib/instantly";
import { advanceStage } from "@/lib/kickoff";
import { loadCampaignState } from "@/lib/outreach/campaign-server";
import { asEmailCopy } from "@/lib/setup";
import { loadSetupStep, loadSetupSteps } from "@/lib/setup-server";
import { loadOutreachMessages } from "@/lib/outreach/core-server";
import { isApproved } from "@/lib/outreach/core";
import {
  asLiveSettings,
  campaignBody,
  goLiveGaps,
  inboxHealthy,
  inboxStatusText,
  dripQueue,
  leadFor,
  testAddress,
  addDays,
  campaignWeek,
  capForWeek,
  localDate,
  MAX_DAILY_EMAILS,
  newInvestorRoom,
  nextWeekday,
  sendingPlan,
  type LiveSettings,
  type PlanWeek,
} from "@/lib/outreach/live";
import { PORTAL_URL } from "@/lib/portal-url";
import { isStripeInvoiceLink, STRIPE_INVOICE_LINK_ERROR } from "@/lib/service-order";
import { normalizeInvoiceUrl, type PaidInvoice } from "@/lib/stripe-webhook";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const OUTREACH_LIVE_MISSING =
  "The Go Live columns are missing. Run portal/supabase/outreach_live.sql and portal/supabase/launch_request.sql in the Supabase SQL editor, then try again.";

function tableError(message: string, code?: string) {
  return code === "42703" || code === "42P01" || /outreach_replies|outreach_events|inbox_email|instantly_campaign_id|pushed_at|launch_requested/.test(message) || message.toLowerCase().includes("schema cache")
    ? OUTREACH_LIVE_MISSING
    : message;
}

const LIVE_STAGES_FROM = ["setup"];

const TIER_NAMES: Record<number, string> = { 1: "Core", 2: "Sphere", 3: "Tier 3", 4: "Tier 4" };

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
  launch_requested_at: string | null;
  launch_requested_by: string | null;
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
      launch_requested_at: s(row.launch_requested_at),
      launch_requested_by: s(row.launch_requested_by),
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
  counts: { funds: number; wave1: number; wave2: number; pushed: number; waiting: number };
  /** Setup step 4: pushed to the client (with the invoice and an email), and confirmed when live. */
  step: { version: number; pushedAt: string | null; emailedAt: string | null; status: string } | null;
  testSentAt: string | null;
  consentText: string | null;
  /** Test Pilot client: every email goes to a + address of `testRecipient`. */
  testMode: boolean;
  testRecipient: string;
  /** The client approved the launch; Rupert clicks Go Live (within 24 hours). */
  requested: { at: string; by: string | null } | null;
  /** Week by week: projected before launch, with the current week once live. */
  plan: PlanWeek[];
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
  const testMode = await isTestPilot(supabase, clientId);
  const waiting = messages.value.filter((m) => m.slot === "active" && !m.pushed_at && isApproved(m)).length;
  const total = (c.summary?.wave1 ?? 0) + (c.summary?.wave2 ?? 0) || messages.value.filter((m) => m.slot === "active" && isApproved(m)).length;
  const today = localDate(Date.now(), r.settings.timezone);
  const approvedActive = messages.value.filter((m) => m.slot === "active" && isApproved(m));
  const tiers = [1, 2, 3, 4].map((tier) => ({ label: TIER_NAMES[tier], count: approvedActive.filter((m) => m.tier === tier).length }));
  const plan = sendingPlan({
    total,
    tiers,
    settings: r.settings,
    launchDay: r.live_at ? localDate(r.live_at, r.settings.timezone) : nextWeekday(addDays(today, 1)),
    today: r.live_at ? today : null,
  });
  const stepRead = await loadSetupStep(supabase, clientId, "go_live");
  const stepRow = stepRead.ok ? stepRead.row : null;
  const step =
    stepRow && stepRow.version > 0
      ? {
          version: stepRow.version,
          pushedAt: stepRow.published_at,
          emailedAt: stepRow.history.find((entry) => entry.version === stepRow.version)?.emailed_at ?? null,
          status: stepRow.status,
        }
      : null;
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
      step,
      counts: {
        funds: c.summary?.funds ?? 0,
        wave1: c.summary?.wave1 ?? 0,
        wave2: c.summary?.wave2 ?? 0,
        pushed,
        waiting,
      },
      testSentAt: r.test_sent_at,
      consentText: r.inbox_email ? CONSENT_TEXT(r.inbox_email) : null,
      testMode,
      testRecipient: testMode ? testRecipientOf(r.settings) : "",
      requested: r.launch_requested_at ? { at: r.launch_requested_at, by: r.launch_requested_by } : null,
      plan,
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


/** Test Pilot clients run in test mode: their emails only ever reach Rupert's own inbox. */
export async function isTestPilot(supabase: ServiceClient, clientId: string) {
  const { data } = await supabase.from("clients").select("is_test_pilot").eq("id", clientId).maybeSingle();
  return Boolean(data?.is_test_pilot);
}

/** The inbox test emails go to: the setting, else the first admin notification address. */
export function testRecipientOf(settings: LiveSettings) {
  if (settings.test_recipient) return settings.test_recipient;
  const first = (process.env.ADMIN_NOTIFY_EMAIL ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return /^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(first) ? first : "";
}

/**
 * Adds the next batch of contacts to the live campaign, in a proportional mix
 * of tiers (dripQueue). `limit` 0 adds everyone eligible. In test mode every
 * address is replaced with a + address of the test inbox.
 */
async function pushBatch(supabase: ServiceClient, clientId: string, campaignId: string): Promise<Result<number>> {
  const [row, messages, testMode] = await Promise.all([
    loadLiveRow(supabase, clientId),
    loadOutreachMessages(supabase, clientId),
    isTestPilot(supabase, clientId),
  ]);
  if (!row.ok) return row;
  if (!messages.ok) return messages;
  const settings = row.value.settings;
  // Today's room under this week's email cap (the ramp, then full pace; never
  // above 30): follow-ups due today and first emails already added come first.
  const tz = settings.timezone;
  const today = localDate(Date.now(), tz);
  const week = row.value.live_at ? campaignWeek(localDate(row.value.live_at, tz), today) : 1;
  const limit = newInvestorRoom(messages.value, today, settings, capForWeek(settings, week));
  if (limit <= 0) return { ok: true, value: 0 };
  const recipient = testMode ? testRecipientOf(settings) : "";
  if (testMode && !recipient) return { ok: false, error: "Test mode needs a test inbox: set it in the Go Live panel." };
  const leads = dripQueue(messages.value, {
    delayDays: settings.wave2_delay_days,
    releasedEarly: Boolean(row.value.wave2_pushed_at),
    limit,
  });
  if (leads.length === 0) return { ok: true, value: 0 };
  const optOut = await optOutLine(supabase, clientId);
  let pushed = 0;
  for (let i = 0; i < leads.length; i += 1000) {
    const chunk = leads.slice(i, i + 1000);
    const added = await addLeads(
      campaignId,
      chunk.map((m) => leadFor(m, optOut, testMode ? testAddress(recipient, m) : undefined)),
    );
    if (!added.ok) return { ok: false, error: `${added.error} ${pushed} contacts were added before this.` };
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
 * Instantly reports every send, open and reply to `${PORTAL_URL}/api/instantly/webhook`.
 * Reachable means the portal answered there: an unsigned request is refused
 * with 401. A 404 or 405 means the request landed somewhere else (the
 * marketing site), and no reply would ever reach the portal.
 */
export async function checkWebhookReachable(): Promise<Result<null>> {
  const url = `${PORTAL_URL}/api/instantly/webhook`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 503) return { ok: true, value: null };
    return {
      ok: false,
      error: `Reply tracking is not reachable: ${url} answered ${response.status}. Instantly could not report sends or replies. Check that this address reaches the portal (site/vercel.json forwards /api/* to it), then try again.`,
    };
  } catch (err) {
    return { ok: false, error: `Reply tracking could not be checked (${url}): ${err instanceof Error ? err.message : "network error"}.` };
  }
}

/**
 * The client approves the launch: their consent is recorded, Rupert is told,
 * and he clicks Go Live (within 24 hours). Nothing is sent yet.
 */
export async function requestLaunch(supabase: ServiceClient, clientId: string, actor: string | null, consent: boolean): Promise<Result<{ already: boolean }>> {
  if (!consent) return { ok: false, error: "Tick the authorization to approve the launch." };
  const state = await loadLiveState(supabase, clientId);
  if (!state.ok) return state;
  if (state.value.live) return { ok: false, error: "Your campaign is already live." };
  if (state.value.requested) return { ok: true, value: { already: true } };
  if (state.value.gaps.length > 0) return { ok: false, error: state.value.gaps.join(" ") };
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const saved = await saveLive(supabase, clientId, {
    launch_requested_at: new Date().toISOString(),
    launch_requested_by: actor,
    consent_text: CONSENT_TEXT(row.value.inbox_email ?? ""),
  });
  return saved.ok ? { ok: true, value: { already: false } } : saved;
}

/**
 * Rupert's Go Live, after the client approved the launch (Test Pilot clients
 * need no approval): creates the Instantly campaign and its webhook, adds the
 * first batch and starts it. Each step saves its progress, so a retry after a
 * failure continues where it stopped.
 */
export async function goLive(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<{ wave1: number }>> {
  if (!isInstantlyConfigured() || !process.env.INSTANTLY_WEBHOOK_SECRET) {
    return { ok: false, error: "Sending isn't set up yet (INSTANTLY_API_KEY, INSTANTLY_WEBHOOK_SECRET)." };
  }
  const state = await loadLiveState(supabase, clientId);
  if (!state.ok) return state;
  if (state.value.gaps.length > 0) return { ok: false, error: state.value.gaps.join(" ") };
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const inbox = row.value.inbox_email!;
  const testMode = state.value.testMode;
  if (testMode && !state.value.testRecipient) return { ok: false, error: "Test mode needs a test inbox: set it in the Go Live panel." };
  if (!testMode && !row.value.launch_requested_at) return { ok: false, error: "The client hasn't approved the launch yet." };
  if (!row.value.instantly_webhook_id) {
    const reachable = await checkWebhookReachable();
    if (!reachable.ok) return reachable;
  }

  let campaignId = row.value.instantly_campaign_id;
  if (!campaignId) {
    const name = `${testMode ? "TEST · " : ""}${await companyName(supabase, clientId)} · investor outreach`;
    const created = await createCampaign(campaignBody(name, inbox, { ...row.value.settings, daily_limit: capForWeek(row.value.settings, 1) }, { testMode }));
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

  // The inbox itself never sends more than 30 a day, whatever the campaign.
  const capped = await updateAccount(inbox, { daily_limit: MAX_DAILY_EMAILS });
  if (!capped.ok) console.error(`Instantly account daily limit not set for ${inbox}: ${capped.error}`);

  // The first daily batch: a proportional mix of first contacts.
  const wave1 = await pushBatch(supabase, clientId, campaignId);
  if (!wave1.ok) return wave1;

  const activated = await activateCampaign(campaignId);
  if (!activated.ok) return activated;

  const now = new Date().toISOString();
  const saved = await saveLive(supabase, clientId, {
    live_at: now,
    live_by: actor,
    ...(row.value.launch_requested_at ? {} : { consent_text: CONSENT_TEXT(inbox) }),
  });
  if (!saved.ok) return saved;
  await advanceStage(supabase, clientId, LIVE_STAGES_FROM, "live");
  // The client's go-live date, shown on their Live card. Kept if already set.
  await supabase.from("clients").update({ live_at: now }).eq("id", clientId).is("live_at", null);
  return { ok: true, value: { wave1: wave1.value } };
}

/**
 * Lets every fund's other contacts start now, without waiting the delay after
 * their fund's first contact, and adds the next batch.
 */
export async function startWave2(supabase: ServiceClient, clientId: string): Promise<Result<number>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  if (!row.value.live_at || !row.value.instantly_campaign_id) return { ok: false, error: "The campaign isn't live." };
  if (!row.value.wave2_pushed_at) {
    const saved = await saveLive(supabase, clientId, { wave2_pushed_at: new Date().toISOString() });
    if (!saved.ok) return saved;
  }
  return pushBatch(supabase, clientId, row.value.instantly_campaign_id);
}

/** Adds the next batch now, without waiting for tomorrow's (and any newly approved contacts). */
export async function pushNewlyApproved(supabase: ServiceClient, clientId: string): Promise<Result<number>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const id = row.value.instantly_campaign_id;
  if (!row.value.live_at || !id) return { ok: false, error: "The campaign isn't live." };
  return pushBatch(supabase, clientId, id);
}

/** Saturday or Sunday in the campaign's timezone. */
function isWeekend(timeZone: string, now = new Date()) {
  try {
    const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
    return day === "Sat" || day === "Sun";
  } catch {
    return false;
  }
}

/** Daily: adds the next mixed batch to every live, unpaused campaign. */
export async function runDueWaves(supabase: ServiceClient) {
  const { data, error } = await supabase
    .from("outreach_campaigns")
    .select("client_id, live_at, settings, paused_at, instantly_campaign_id")
    .not("live_at", "is", null);
  if (error) return { started: 0, added: 0, errors: [tableError(error.message, error.code)] };
  let started = 0;
  let added = 0;
  const errors: string[] = [];
  for (const row of data ?? []) {
    if (row.paused_at || !row.instantly_campaign_id) continue;
    const settings = asLiveSettings(row.settings);
    // Real campaigns send on weekdays: no new contacts on a weekend, so Monday isn't doubled.
    if (isWeekend(settings.timezone) && !(await isTestPilot(supabase, String(row.client_id)))) continue;
    // This week's email cap in Instantly: 10, then 20, then 30 (never more).
    const week = campaignWeek(localDate(String(row.live_at), settings.timezone), localDate(Date.now(), settings.timezone));
    const limited = await updateCampaign(String(row.instantly_campaign_id), { daily_limit: capForWeek(settings, week) });
    if (!limited.ok) errors.push(`${row.client_id}: daily limit not updated: ${limited.error}`);
    const result = await pushBatch(supabase, String(row.client_id), String(row.instantly_campaign_id));
    if (!result.ok) errors.push(`${row.client_id}: ${result.error}`);
    else if (result.value > 0) {
      started += 1;
      added += result.value;
    }
  }
  return { started, added, errors };
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
