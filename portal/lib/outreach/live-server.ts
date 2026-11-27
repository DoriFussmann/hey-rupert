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
  createGoogleAccountWithAppPassword,
  oauthInit,
  oauthStatus,
  pauseCampaign,
  updateAccount,
  updateCampaign,
  type OAuthProvider,
} from "@/lib/instantly";
import { advanceStage } from "@/lib/kickoff";
import { loadCampaignState, rebuildAfterCopyConfirmed } from "@/lib/outreach/campaign-server";
import { federalHolidayOn } from "@/lib/outreach/holidays";
import { appPasswordFailure, checkAppPasswordForm, type AppPasswordInput } from "@/lib/outreach/inbox-connect";
import {
  launchStage,
  resolveStuck,
  runActivate,
  runAddLeads,
  settingsBlocker,
  type LaunchRow,
  type LaunchStage,
  type PushOutcome,
} from "@/lib/outreach/launch";
import { emailsPerContact } from "@/lib/outreach/campaign";
import { asEmailCopy } from "@/lib/setup";
import { loadSetupStep, loadSetupSteps } from "@/lib/setup-server";
import { loadOutreachMessages } from "@/lib/outreach/core-server";
import type { OutreachMessageView } from "@/lib/outreach/core-server";
import { pushInstant, targetSendDay } from "@/lib/outreach/presend";
import { isApproved } from "@/lib/outreach/core";
import {
  asLiveSettings,
  campaignBody,
  goLiveGaps,
  inboxHealthy,
  inboxStatusText,
  dripQueue,
  leadFor,
  FALLBACK_OPT_OUT_LINE,
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
import { isStripeInvoiceLink, monthlyFeeOf, STRIPE_INVOICE_LINK_ERROR } from "@/lib/service-order";
import {
  DEFAULT_LAUNCH_CONFIRMATION,
  cleanPostalAddress,
  fillLaunchConfirmation,
  planMonthsOf,
  postalAddressProblem,
  withPostalAddress,
} from "@/lib/launch-confirmation";
import { LAUNCH_CONFIRMATION_SLUG, SERVICE_ORDER_SLUG } from "@/lib/form-fields";
import { type PaidInvoice } from "@/lib/stripe-webhook";
import { matchCampaignInvoice } from "@/lib/stripe-match";

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
  /** Go Live step 1 (Add leads, paused): claimed, then done. See lib/outreach/launch.ts. */
  leads_adding_at: string | null;
  leads_added_at: string | null;
  leads_added_count: number | null;
  leads_add_note: string | null;
  holiday_paused_at: string | null;
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
      leads_adding_at: s(row.leads_adding_at),
      leads_added_at: s(row.leads_added_at),
      leads_added_count: row.leads_added_count == null ? null : Number(row.leads_added_count),
      leads_add_note: s(row.leads_add_note),
      holiday_paused_at: s(row.holiday_paused_at),
    },
  };
}

function launchRowOf(row: LiveRow): LaunchRow {
  return {
    live_at: row.live_at,
    leads_adding_at: row.leads_adding_at,
    leads_added_at: row.leads_added_at,
    leads_added_count: row.leads_added_count,
    leads_add_note: row.leads_add_note,
  };
}

async function saveLive(supabase: ServiceClient, clientId: string, patch: Record<string, unknown>): Promise<Result<null>> {
  const { error } = await supabase
    .from("outreach_campaigns")
    .upsert({ client_id: clientId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
  return error ? { ok: false, error: tableError(error.message, error.code) } : { ok: true, value: null };
}

export type NextBatch = {
  /** The send day (YYYY-MM-DD) the batch is for. */
  day: string;
  week: number;
  warmup: boolean;
  /** Emails a day that week (first emails and follow-ups). */
  cap: number;
  /** New investors that fit that day: the batch size. */
  room: number;
  /** Of them, contacts that passed the check and are next in line. */
  ready: number;
  /** Contacts still in line that haven't been checked yet. */
  unchecked: number;
};

/** The next send day's batch, as the pre-send check and Add Leads see it. */
function nextBatchOf(messages: OutreachMessageView[], r: LiveRow, now = Date.now()): NextBatch {
  const settings = r.settings;
  const tz = settings.timezone;
  const day = targetSendDay(now, tz);
  const week = r.live_at ? campaignWeek(localDate(r.live_at, tz), day) : 1;
  const cap = capForWeek(settings, week);
  const room = newInvestorRoom(messages, day, settings, cap, emailsPerContact(messages) - 1);
  const queue = dripQueue(messages, { delayDays: settings.wave2_delay_days, releasedEarly: Boolean(r.wave2_pushed_at), limit: 0, now: pushInstant(day) });
  return {
    day,
    week,
    warmup: week <= settings.ramp.length,
    cap,
    room,
    ready: Math.min(room, queue.filter((m) => m.send_check === "pass").length),
    unchecked: queue.filter((m) => !m.send_check).length,
  };
}

export type LiveState = {
  instantlyReady: boolean;
  campaignReady: boolean;
  /** Why the campaign isn't ready, for Rupert. */
  campaignNote: string | null;
  inbox: { email: string; connectedAt: string | null; status: number | null; statusText: string; healthy: boolean; checkedAt: string | null } | null;
  invoice: { url: string | null; paidAt: string | null };
  settings: LiveSettings;
  live: {
    at: string;
    by: string | null;
    campaignId: string | null;
    wave2PushedAt: string | null;
    pausedAt: string | null;
    /** Paused for a US federal holiday; starts again on the next Business Day. */
    holidayPausedAt: string | null;
  } | null;
  gaps: string[];
  counts: { funds: number; wave1: number; wave2: number; pushed: number; waiting: number };
  /** Pre-send email check, for contacts not yet in Instantly: passed, failed (moved out), not checked yet. */
  presend: { passed: number; failed: number; unchecked: number; lastAt: string | null };
  /** The next send day's batch: its size (warm-up or full pace) and how much of it passed the pre-send check. */
  nextBatch: NextBatch;
  /** Setup step 4: pushed to the client (with the invoice and an email), and confirmed when live. */
  step: { version: number; pushedAt: string | null; emailedAt: string | null; status: string } | null;
  testSentAt: string | null;
  consentText: string | null;
  /** Test Pilot client: every email goes to a + address of `testRecipient`, minutes apart. */
  testMode: boolean;
  /** A real client in a test run: every email goes to a + address of `testRecipient`, at the real pace. */
  redirected: boolean;
  testRecipient: string;
  /** Emails each contact gets: 3 for copy by fund type, 2 for copy by source. */
  emailsPerContact: number;
  /** Go Live in two steps: Add leads (paused), then Activate. */
  launch: {
    stage: LaunchStage;
    addingSince: string | null;
    addedAt: string | null;
    addedCount: number;
    note: string | null;
    campaignId: string | null;
  };
  /** The client approved the launch; Rupert clicks Go Live (within 24 hours). */
  requested: { at: string; by: string | null } | null;
  /** Week by week: projected before launch, with the current week once live. */
  plan: PlanWeek[];
  /** The Launch Confirmation the client confirmed when approving the launch. */
  confirmation: { at: string; version: number | null; text: string } | null;
  /** The client's postal address, for the foot of the first email. */
  postalAddress: string;
};

/** What the client confirmed and their postal address. Empty before launch_confirmation.sql has run. */
async function loadConfirmed(supabase: ServiceClient, clientId: string) {
  const [doc, client] = await Promise.all([
    supabase
      .from("signed_documents")
      .select("signed_content, signed_at, template_version")
      .eq("client_id", clientId)
      .eq("doc_type", LAUNCH_CONFIRMATION_SLUG)
      .is("archived_at", null)
      .maybeSingle(),
    supabase.from("clients").select("postal_address").eq("id", clientId).maybeSingle(),
  ]);
  return {
    confirmation:
      doc.data?.signed_at && doc.data.signed_content
        ? {
            at: String(doc.data.signed_at),
            version: doc.data.template_version != null ? Number(doc.data.template_version) : null,
            text: String(doc.data.signed_content),
          }
        : null,
    postalAddress: cleanPostalAddress(client.data?.postal_address != null ? String(client.data.postal_address) : ""),
  };
}

export async function loadLiveState(supabase: ServiceClient, clientId: string): Promise<Result<LiveState>> {
  // A copy the client re-confirmed after the build: rebuild before reading, so neither side waits on the other.
  await rebuildAfterCopyConfirmed(supabase, clientId);
  const [row, campaign, messages, confirmed] = await Promise.all([
    loadLiveRow(supabase, clientId),
    loadCampaignState(supabase, clientId),
    loadOutreachMessages(supabase, clientId),
    loadConfirmed(supabase, clientId),
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
  const redirected = !testMode && r.settings.redirect_to_test_inbox;
  const perContact = emailsPerContact(messages.value);
  const waiting = messages.value.filter((m) => m.slot === "active" && !m.pushed_at && isApproved(m)).length;
  const all = (c.summary?.wave1 ?? 0) + (c.summary?.wave2 ?? 0) || messages.value.filter((m) => m.slot === "active" && isApproved(m)).length;
  const total = (testMode || redirected) && r.settings.contact_limit > 0 ? Math.min(all, r.settings.contact_limit) : all;
  const today = localDate(Date.now(), r.settings.timezone);
  const approvedActive = messages.value.filter((m) => m.slot === "active" && isApproved(m));
  const tiers = [1, 2, 3, 4].map((tier) => ({ label: TIER_NAMES[tier], count: approvedActive.filter((m) => m.tier === tier).length }));
  const plan = sendingPlan({
    total,
    tiers,
    settings: r.settings,
    launchDay: r.live_at ? localDate(r.live_at, r.settings.timezone) : nextWeekday(addDays(today, 1)),
    today: r.live_at ? today : null,
    followups: perContact - 1,
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
      live: r.live_at
        ? { at: r.live_at, by: r.live_by, campaignId: r.instantly_campaign_id, wave2PushedAt: r.wave2_pushed_at, pausedAt: r.paused_at, holidayPausedAt: r.holiday_paused_at }
        : null,
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
      presend: {
        passed: messages.value.filter((m) => m.slot === "active" && !m.pushed_at && m.send_check === "pass").length,
        failed: messages.value.filter((m) => !m.pushed_at && m.send_check === "fail").length,
        unchecked: messages.value.filter((m) => m.slot === "active" && !m.pushed_at && !m.send_check && isApproved(m)).length,
        lastAt: messages.value.reduce<string | null>((at, m) => (m.send_check_at && (!at || m.send_check_at > at) ? m.send_check_at : at), null),
      },
      nextBatch: nextBatchOf(messages.value, r),
      testSentAt: r.test_sent_at,
      consentText: r.inbox_email ? CONSENT_TEXT(r.inbox_email) : null,
      testMode,
      redirected,
      testRecipient: testMode || redirected ? testRecipientOf(r.settings) : "",
      emailsPerContact: perContact,
      launch: {
        stage: launchStage(launchRowOf(r)),
        addingSince: r.leads_adding_at,
        addedAt: r.leads_added_at,
        addedCount: r.leads_added_count ?? 0,
        note: r.leads_add_note,
        campaignId: r.instantly_campaign_id,
      },
      requested: r.launch_requested_at ? { at: r.launch_requested_at, by: r.launch_requested_by } : null,
      plan,
      confirmation: confirmed.confirmation,
      postalAddress: confirmed.postalAddress,
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

/**
 * Connects the client's Gmail or Google Workspace inbox with a Google app
 * password, when Google blocked the sign-in. The password goes straight to
 * the sending platform; it is never saved or logged here.
 */
export async function connectInboxWithAppPassword(supabase: ServiceClient, clientId: string, input: AppPasswordInput): Promise<Result<{ email: string }>> {
  if (!isInstantlyConfigured()) return { ok: false, error: "Sending isn't set up yet. Rupert has been told." };
  const form = checkAppPasswordForm(input);
  if (!form.ok) return form;
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  if (row.value.live_at) return { ok: false, error: "Your campaign is live. Ask Rupert before changing the inbox." };
  const created = await createGoogleAccountWithAppPassword(form);
  if (!created.ok) {
    console.error(`Inbox connect by app password failed for ${clientId} (${form.email}): ${created.status ?? ""} ${created.error}`);
    return { ok: false, error: appPasswordFailure(created.status, created.error) };
  }
  const saved = await saveLive(supabase, clientId, {
    inbox_email: form.email,
    inbox_connected_at: new Date().toISOString(),
    oauth_session_id: null,
    oauth_expires_at: null,
  });
  if (!saved.ok) return saved;
  await enableWarmup([form.email]);
  await checkInbox(supabase, clientId);
  return { ok: true, value: { email: form.email } };
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
  if (invoice.kind === "setup_fee") return "unmatched";
  const { data, error } = await supabase.from("outreach_campaigns").select("client_id, invoice_url, invoice_paid_at");
  if (error) return "error";
  const rows = (data ?? []) as { client_id: string; invoice_url: string | null; invoice_paid_at: string | null }[];
  const ids = rows.filter((row) => row.invoice_url).map((row) => row.client_id);
  const emails = new Map<string, string | null>();
  if (ids.length > 0) {
    const clients = await supabase.from("clients").select("id, email").in("id", ids);
    if (clients.error) return "error";
    for (const c of clients.data ?? []) emails.set(String(c.id), c.email ? String(c.email) : null);
  }
  const match = matchCampaignInvoice(
    rows.map((row) => ({ ...row, email: emails.get(row.client_id) ?? null })),
    invoice,
  );
  if (!match) return "unmatched";
  if (match.invoice_paid_at) return "already_paid";
  const saved = await saveLive(supabase, String(match.client_id), { invoice_paid_at: new Date().toISOString(), invoice_marked_by: "stripe" });
  return saved.ok ? "recorded" : "error";
}

export async function saveLiveSettings(supabase: ServiceClient, clientId: string, value: unknown): Promise<Result<LiveSettings>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const blocked = settingsBlocker(launchRowOf(row.value));
  if (blocked) return { ok: false, error: blocked };
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
  // Every campaign email carries an opt-out line (Service Order 7.5).
  return (copy.copy_version === 3 ? copy.by_source?.opt_out_line?.trim() : copy.typed?.opt_out_line?.trim()) || FALLBACK_OPT_OUT_LINE;
}

/** The client's postal address, for the foot of the first email. */
async function postalAddressOf(supabase: ServiceClient, clientId: string) {
  const { data } = await supabase.from("clients").select("postal_address").eq("id", clientId).maybeSingle();
  return cleanPostalAddress(data?.postal_address != null ? String(data.postal_address) : "");
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
  const outcome = await pushBatchDetailed(supabase, clientId, campaignId);
  return outcome.ok ? { ok: true, value: outcome.pushed } : { ok: false, error: outcome.error };
}

/** pushBatch, saying whether any request reached Instantly when it fails. */
async function pushBatchDetailed(supabase: ServiceClient, clientId: string, campaignId: string): Promise<PushOutcome> {
  const fail = (error: string, pushed = 0, touched = false): PushOutcome => ({ ok: false, error, pushed, touched });
  const [row, messages, testMode] = await Promise.all([
    loadLiveRow(supabase, clientId),
    loadOutreachMessages(supabase, clientId),
    isTestPilot(supabase, clientId),
  ]);
  if (!row.ok) return fail(row.error);
  if (!messages.ok) return fail(messages.error);
  const settings = row.value.settings;
  // Today's room under this week's email cap (the ramp, then full pace; never
  // above 30): follow-ups due today and first emails already added come first.
  const tz = settings.timezone;
  const today = localDate(Date.now(), tz);
  const week = row.value.live_at ? campaignWeek(localDate(row.value.live_at, tz), today) : 1;
  const followups = emailsPerContact(messages.value) - 1;
  const room = newInvestorRoom(messages.value, today, settings, capForWeek(settings, week), followups);
  // A test run's contact limit (test runs only): never more than that many contacts in Instantly.
  const redirect = testMode || settings.redirect_to_test_inbox;
  const pushedSoFar = messages.value.filter((m) => m.pushed_at).length;
  const limit = redirect && settings.contact_limit > 0 ? Math.min(room, settings.contact_limit - pushedSoFar) : room;
  if (limit <= 0) return { ok: true, pushed: 0 };
  const recipient = redirect ? testRecipientOf(settings) : "";
  if (redirect && !recipient) return fail("Test mode needs a test inbox: set it in the Go Live panel.");
  // Only contacts that passed the pre-send check go out (presend-server.ts);
  // the rest wait for it. Test Pilot clients skip the check.
  const queue = dripQueue(messages.value, {
    delayDays: settings.wave2_delay_days,
    releasedEarly: Boolean(row.value.wave2_pushed_at),
    limit: 0,
  });
  const leads = (testMode ? queue : queue.filter((m) => m.send_check === "pass")).slice(0, limit);
  if (leads.length === 0) return { ok: true, pushed: 0 };
  const [optOut, postalAddress] = await Promise.all([optOutLine(supabase, clientId), postalAddressOf(supabase, clientId)]);
  let pushed = 0;
  for (let i = 0; i < leads.length; i += 1000) {
    const chunk = leads.slice(i, i + 1000);
    const added = await addLeads(
      campaignId,
      chunk.map((m) => leadFor(m, optOut, redirect ? testAddress(recipient, m) : undefined, postalAddress)),
    );
    // A failed request may still have added some leads in Instantly: from here on, "touched".
    if (!added.ok) return fail(`${added.error} ${pushed} contacts were added before this.`, pushed, true);
    const now = new Date().toISOString();
    const ids = new Map((added.value.created_leads ?? []).map((lead) => [lead.index, lead.id]));
    for (let index = 0; index < chunk.length; index += 1) {
      const { error } = await supabase
        .from("outreach_messages")
        .update({ pushed_at: now, instantly_lead_id: ids.get(index) ?? null })
        .eq("id", chunk[index].id);
      if (error) return fail(tableError(error.message, error.code), pushed + index, true);
    }
    pushed += chunk.length;
  }
  return { ok: true, pushed };
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
      // Instantly doesn't follow redirects, so a redirect is a failure here too.
      redirect: "manual",
    });
    if (response.status === 401 || response.status === 503) return { ok: true, value: null };
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        error: `Reply tracking is not reachable: ${url} redirects to ${response.headers.get("location") ?? "another address"}, and Instantly doesn't follow redirects. Set NEXT_PUBLIC_PORTAL_URL in Vercel to the final address.`,
      };
    }
    return {
      ok: false,
      error: `Reply tracking is not reachable: ${url} answered ${response.status}. Instantly could not report sends or replies. Check that this address reaches the portal (site/vercel.json forwards /api/* to it), then try again.`,
    };
  } catch (err) {
    return { ok: false, error: `Reply tracking could not be checked (${url}): ${err instanceof Error ? err.message : "network error"}.` };
  }
}

// ---------------------------------------------------------------------------
// Launch Confirmation: the agreement the client confirms when approving launch

export type LaunchConfirmation = {
  /** The text for this client, with the postal address still to fill in (withPostalAddress). */
  text: string;
  /** The Launch Confirmation version in use; null when it has no versions yet. */
  version: number | null;
  /** The address on file, to start the field with. */
  postalAddress: string;
  /** What the client confirmed, once they have. */
  confirmed: { at: string; version: number | null; text: string } | null;
};

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "long", day: "numeric" });

/** The Launch Confirmation as this client would confirm it now, and their confirmation if they have. */
export async function loadLaunchConfirmation(
  supabase: ServiceClient,
  clientId: string,
  state: Pick<LiveState, "counts" | "inbox" | "plan" | "confirmation" | "settings" | "emailsPerContact">,
): Promise<Result<LaunchConfirmation>> {
  const [templates, client, order] = await Promise.all([
    supabase.from("form_templates").select("slug, content, active_version").in("slug", [LAUNCH_CONFIRMATION_SLUG, SERVICE_ORDER_SLUG]),
    supabase.from("clients").select("company_name, postal_address, service_order_content").eq("id", clientId).maybeSingle(),
    supabase
      .from("service_order_sends")
      .select("content, signed_at, template_version")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .maybeSingle(),
  ]);
  if (templates.error) return { ok: false, error: templates.error.message };
  if (client.error) return { ok: false, error: client.error.message };
  if (!client.data) return { ok: false, error: "Client not found." };
  if (order.error) return { ok: false, error: tableError(order.error.message, order.error.code) };

  const bySlug = new Map((templates.data ?? []).map((row) => [String(row.slug), row]));
  const template = bySlug.get(LAUNCH_CONFIRMATION_SLUG);
  const activeOrder = bySlug.get(SERVICE_ORDER_SLUG)?.active_version;
  const orderContent = String(order.data?.content ?? client.data.service_order_content ?? "");
  const signedVersion = order.data?.template_version != null ? Number(order.data.template_version) : null;
  // A client whose signed Service Order is an earlier version moves to the one in use.
  const earlier =
    order.data?.signed_at && activeOrder != null && signedVersion != null && signedVersion < Number(activeOrder)
      ? { currentVersion: Number(activeOrder), signedOn: longDate(String(order.data.signed_at)) }
      : null;
  const contacts = state.counts.wave1 + state.counts.wave2;
  const text = fillLaunchConfirmation(String(template?.content ?? "").trim() || DEFAULT_LAUNCH_CONFIRMATION, {
    company: String(client.data.company_name ?? ""),
    funds: state.counts.funds,
    contacts,
    inbox: state.inbox?.email ?? "",
    monthlyFee: monthlyFeeOf(orderContent) ?? "$1,000",
    // The whole approved list, not a test run's contact limit.
    planMonths: planMonthsOf(
      sendingPlan({
        total: contacts,
        settings: state.settings,
        launchDay: nextWeekday(addDays(localDate(Date.now(), state.settings.timezone), 1)),
        today: null,
        followups: state.emailsPerContact - 1,
      }).length,
    ),
    earlierServiceOrder: earlier,
  });
  return {
    ok: true,
    value: {
      text,
      version: template?.active_version != null ? Number(template.active_version) : null,
      postalAddress: cleanPostalAddress(client.data.postal_address != null ? String(client.data.postal_address) : ""),
      confirmed: state.confirmation,
    },
  };
}

/**
 * The client approves the launch: they confirm the Launch Confirmation (kept
 * exactly as they saw it, with its version), their postal address is saved
 * for the campaign emails, their consent is recorded, Rupert is told, and he
 * clicks Go Live (within 24 hours). Nothing is sent yet.
 */
export async function requestLaunch(
  supabase: ServiceClient,
  clientId: string,
  actor: string | null,
  consent: boolean,
  input: { postalAddress: string; ip?: string | null; userAgent?: string | null },
): Promise<Result<{ already: boolean }>> {
  if (!consent) return { ok: false, error: "Tick the box to confirm and approve the launch." };
  const state = await loadLiveState(supabase, clientId);
  if (!state.ok) return state;
  if (state.value.live) return { ok: false, error: "Your campaign is already live." };
  if (state.value.requested) return { ok: true, value: { already: true } };
  if (state.value.gaps.length > 0) return { ok: false, error: state.value.gaps.join(" ") };
  const problem = postalAddressProblem(input.postalAddress);
  if (problem) return { ok: false, error: problem };
  const postalAddress = cleanPostalAddress(input.postalAddress);
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const confirmation = await loadLaunchConfirmation(supabase, clientId, state.value);
  if (!confirmation.ok) return confirmation;

  const { error: addressError } = await supabase.from("clients").update({ postal_address: postalAddress }).eq("id", clientId);
  if (addressError) return { ok: false, error: launchConfirmationError(addressError.message, addressError.code) };

  const at = new Date().toISOString();
  const text = withPostalAddress(confirmation.value.text, postalAddress);
  // An earlier confirmation (a launch that was reset) is kept, archived.
  const archived = await supabase
    .from("signed_documents")
    .update({ archived_at: at })
    .eq("client_id", clientId)
    .eq("doc_type", LAUNCH_CONFIRMATION_SLUG)
    .is("archived_at", null);
  if (archived.error) return { ok: false, error: launchConfirmationError(archived.error.message, archived.error.code) };
  const { error: insertError } = await supabase.from("signed_documents").insert({
    client_id: clientId,
    doc_type: LAUNCH_CONFIRMATION_SLUG,
    content: text,
    sent_at: at,
    signed_at: at,
    signer_email: actor,
    signed_content: text,
    signed_ip: input.ip ?? null,
    signed_user_agent: input.userAgent ?? null,
    template_version: confirmation.value.version,
    customized: false,
  });
  if (insertError) return { ok: false, error: launchConfirmationError(insertError.message, insertError.code) };

  const saved = await saveLive(supabase, clientId, {
    launch_requested_at: at,
    launch_requested_by: actor,
    consent_text: CONSENT_TEXT(row.value.inbox_email ?? ""),
  });
  return saved.ok ? { ok: true, value: { already: false } } : saved;
}

function launchConfirmationError(message: string, code?: string) {
  return code === "42703" || code === "23514" || /postal_address|signed_documents_doc_type_check|template_version/.test(message)
    ? "The Launch Confirmation isn't set up in the database yet. Run portal/supabase/launch_confirmation.sql in Supabase."
    : message;
}

/**
 * Go Live step 1, after the client approved the launch (Test Pilot clients
 * need no approval): creates the Instantly campaign (paused: a new campaign
 * doesn't send until it is activated), its webhook and the inbox cap, and
 * adds the first batch, so Rupert can check every lead in Instantly before
 * anything is sent. Never adds a second first batch: see runAddLeads.
 */
export async function addLeadsPaused(
  supabase: ServiceClient,
  clientId: string,
): Promise<Result<{ added: number; already: boolean; note: string | null; campaignId: string | null }>> {
  if (!isInstantlyConfigured() || !process.env.INSTANTLY_WEBHOOK_SECRET) {
    return { ok: false, error: "Sending isn't set up yet (INSTANTLY_API_KEY, INSTANTLY_WEBHOOK_SECRET)." };
  }
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const launch = launchRowOf(row.value);
  // Already claimed, added or live: no checks needed, runAddLeads answers without touching Instantly.
  if (launchStage(launch) === "ready") {
    const state = await loadLiveState(supabase, clientId);
    if (!state.ok) return state;
    if (state.value.gaps.length > 0) return { ok: false, error: state.value.gaps.join(" ") };
    if ((state.value.testMode || state.value.redirected) && !state.value.testRecipient) {
      return { ok: false, error: "Test mode needs a test inbox: set it in the Go Live panel." };
    }
    if (!state.value.testMode && !row.value.launch_requested_at) return { ok: false, error: "The client hasn't approved the launch yet." };
    if (!state.value.testMode) {
      const messages = await loadOutreachMessages(supabase, clientId);
      if (!messages.ok) return messages;
      const passed = messages.value.filter((m) => m.slot === "active" && !m.pushed_at && m.send_check === "pass").length;
      if (passed === 0) return { ok: false, error: "No contact has passed the pre-send email check yet. Click \"Check next batch\" first." };
    }
  }

  let campaignId = row.value.instantly_campaign_id;
  const result = await runAddLeads(launch, {
    now: () => new Date().toISOString(),
    async claim(now) {
      const { data, error } = await supabase
        .from("outreach_campaigns")
        .update({ leads_adding_at: now, updated_at: now })
        .eq("client_id", clientId)
        .is("leads_adding_at", null)
        .is("leads_added_at", null)
        .is("live_at", null)
        .select("client_id");
      if (error) throw new Error(tableError(error.message, error.code));
      return (data ?? []).length === 1;
    },
    async reload() {
      const fresh = await loadLiveRow(supabase, clientId);
      if (!fresh.ok) throw new Error(fresh.error);
      return launchRowOf(fresh.value);
    },
    async release() {
      const saved = await saveLive(supabase, clientId, { leads_adding_at: null });
      if (!saved.ok) console.error(`Go Live: claim not released for ${clientId}: ${saved.error}`);
    },
    async markAdded(now, count, note) {
      const saved = await saveLive(supabase, clientId, { leads_added_at: now, leads_added_count: count, leads_add_note: note });
      if (!saved.ok) throw new Error(`Leads were added but not recorded: ${saved.error}. Don't click again; tell Rupert's developer.`);
    },
    async setup() {
      const fresh = await loadLiveRow(supabase, clientId);
      if (!fresh.ok) return fresh;
      const state = await loadLiveState(supabase, clientId);
      if (!state.ok) return state;
      const inbox = fresh.value.inbox_email!;
      const { testMode, redirected } = state.value;
      if (!fresh.value.instantly_webhook_id) {
        const reachable = await checkWebhookReachable();
        if (!reachable.ok) return reachable;
      }
      campaignId = fresh.value.instantly_campaign_id;
      if (!campaignId) {
        const name = `${testMode || redirected ? "TEST · " : ""}${await companyName(supabase, clientId)} · investor outreach`;
        const created = await createCampaign(
          campaignBody(name, inbox, { ...fresh.value.settings, daily_limit: capForWeek(fresh.value.settings, 1) }, { testMode, redirected, steps: state.value.emailsPerContact }),
        );
        if (!created.ok) return created;
        campaignId = created.value.id;
        const saved = await saveLive(supabase, clientId, { instantly_campaign_id: campaignId });
        if (!saved.ok) return saved;
      }
      if (!fresh.value.instantly_webhook_id) {
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
      return { ok: true };
    },
    async push() {
      if (!campaignId) return { ok: false, error: "No Instantly campaign.", pushed: 0, touched: false };
      return pushBatchDetailed(supabase, clientId, campaignId);
    },
  }).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : "Adding leads failed." }));
  if (!result.ok) return result;
  return { ok: true, value: { added: result.added, already: result.already, note: result.note, campaignId: campaignId ?? null } };
}

/** Go Live step 2: starts the paused campaign. Adds no leads. */
export async function activateLaunch(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<{ already: boolean }>> {
  const row = await loadLiveRow(supabase, clientId);
  if (!row.ok) return row;
  const campaignId = row.value.instantly_campaign_id;
  const result = await runActivate(launchRowOf(row.value), {
    now: () => new Date().toISOString(),
    async activate() {
      if (!campaignId) return { ok: false, error: "No Instantly campaign." };
      const started = await activateCampaign(campaignId);
      return started.ok ? { ok: true } : started;
    },
    async markLive(now) {
      const saved = await saveLive(supabase, clientId, {
        live_at: now,
        live_by: actor,
        ...(row.value.launch_requested_at ? {} : { consent_text: CONSENT_TEXT(row.value.inbox_email ?? "") }),
      });
      if (!saved.ok) throw new Error(`The campaign started in Instantly but wasn't recorded as live: ${saved.error}.`);
      await advanceStage(supabase, clientId, LIVE_STAGES_FROM, "live");
      // The client's go-live date, shown on their Live card. Kept if already set.
      await supabase.from("clients").update({ live_at: now }).eq("id", clientId).is("live_at", null);
    },
  }).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : "Activate failed." }));
  if (!result.ok) return result;
  return { ok: true, value: { already: result.already } };
}

/**
 * A stuck Add leads (its server stopped after claiming): Rupert looked at the
 * campaign in Instantly. "added": leads are there, keep them as the first
 * batch. "empty": no leads there, Add leads can run again.
 */
export async function resolveStuckLaunch(supabase: ServiceClient, clientId: string, choice: "added" | "empty"): Promise<Result<null>> {
  const [row, messages] = await Promise.all([loadLiveRow(supabase, clientId), loadOutreachMessages(supabase, clientId)]);
  if (!row.ok) return row;
  if (!messages.ok) return messages;
  const pushedHere = messages.value.filter((m) => m.pushed_at).length;
  const checked = resolveStuck(launchRowOf(row.value), choice, pushedHere);
  if (!checked.ok) return checked;
  return choice === "added"
    ? saveLive(supabase, clientId, {
        leads_added_at: new Date().toISOString(),
        leads_added_count: pushedHere,
        leads_add_note: `Resolved by Rupert: the leads were in Instantly (${pushedHere} recorded here).`,
      })
    : saveLive(supabase, clientId, { leads_adding_at: null });
}

/** Both steps at once, for Test Pilot clients (fast test mode). */
export async function goLive(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<{ wave1: number }>> {
  const added = await addLeadsPaused(supabase, clientId);
  if (!added.ok) return added;
  const started = await activateLaunch(supabase, clientId, actor);
  if (!started.ok) return started;
  return { ok: true, value: { wave1: added.value.added } };
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
    // Real campaigns send on Business Days: no new contacts on a weekend or a
    // federal holiday, so the next Business Day isn't doubled.
    const realClient = !(await isTestPilot(supabase, String(row.client_id)));
    if (realClient && (isWeekend(settings.timezone) || federalHolidayOn(localDate(Date.now(), settings.timezone)))) continue;
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

/**
 * Daily, before the sending window: on a US federal holiday (in the
 * campaign's timezone) every live, running campaign is paused in Instantly,
 * so nothing is sent that day (Service Order 1.5 and 4.2). The next run on a
 * Business Day starts it again. A campaign Rupert paused himself is left alone.
 */
export async function runHolidayGuard(supabase: ServiceClient, now = Date.now()) {
  const { data, error } = await supabase
    .from("outreach_campaigns")
    .select("client_id, live_at, settings, paused_at, holiday_paused_at, instantly_campaign_id")
    .not("live_at", "is", null);
  if (error) return { paused: [] as string[], resumed: [] as string[], errors: [tableError(error.message, error.code)] };
  const paused: string[] = [];
  const resumed: string[] = [];
  const errors: string[] = [];
  for (const row of data ?? []) {
    const id = row.instantly_campaign_id ? String(row.instantly_campaign_id) : null;
    const clientId = String(row.client_id);
    if (!id || (await isTestPilot(supabase, clientId))) continue;
    const settings = asLiveSettings(row.settings);
    const holiday = federalHolidayOn(localDate(now, settings.timezone));
    if (holiday && !row.paused_at && !row.holiday_paused_at) {
      const result = await pauseCampaign(id);
      if (!result.ok) {
        errors.push(`${clientId}: not paused for ${holiday}: ${result.error}`);
        continue;
      }
      const saved = await saveLive(supabase, clientId, { holiday_paused_at: new Date(now).toISOString() });
      if (!saved.ok) errors.push(`${clientId}: paused for ${holiday} but not recorded: ${saved.error}`);
      paused.push(clientId);
    } else if (!holiday && row.holiday_paused_at) {
      if (!row.paused_at) {
        const result = await activateCampaign(id);
        if (!result.ok) {
          errors.push(`${clientId}: not restarted after the holiday: ${result.error}`);
          continue;
        }
        resumed.push(clientId);
      }
      const saved = await saveLive(supabase, clientId, { holiday_paused_at: null });
      if (!saved.ok) errors.push(`${clientId}: holiday pause not cleared: ${saved.error}`);
    }
  }
  return { paused, resumed, errors };
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
  const created = await createCampaign(campaignBody(name, row.value.inbox_email, row.value.settings, { test: true, steps: emailsPerContact(messages.value) }));
  if (!created.ok) return created;
  const added = await addLeads(created.value.id, [leadFor(sample, await optOutLine(supabase, clientId), to, await postalAddressOf(supabase, clientId))]);
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
