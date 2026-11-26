import "server-only";
import { callClaudeAgent, isClaudeConfigured, webSearchTool, type ClaudeUsage } from "@/lib/anthropic";
import { isHunterConfigured, verifyEmail } from "@/lib/hunter";
import { loadDecisions } from "@/lib/match/corrections-server";
import { selectAll } from "@/lib/match/db-server";
import {
  addCost,
  CLAUDE_USD_PER_MTOK_IN,
  CLAUDE_USD_PER_MTOK_OUT,
  emailKey,
  finalStatus,
  safeUrl,
  USD_PER_SEARCH,
  ZERO_COST,
  type CheckCost,
  type CheckSteps,
  type Evidence,
  type MailboxStep,
} from "@/lib/match/verify";
import { promptSystem, type ActivePrompt } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import { emailsPerContact } from "@/lib/outreach/campaign";
import { emailsHash } from "@/lib/outreach/core";
import { loadOutreachMessages, type OutreachMessageView } from "@/lib/outreach/core-server";
import {
  asLiveSettings,
  campaignWeek,
  capForWeek,
  dripQueue,
  localDate,
  newInvestorRoom,
} from "@/lib/outreach/live";
import {
  DELIVERED_AFTER_MS,
  presendVerdict,
  pushInstant,
  spareFor,
  stepsVerdict,
  targetSendDay,
  type DeliveryProof,
  type StoredCheck,
} from "@/lib/outreach/presend";
import { isTestPilot } from "@/lib/outreach/live-server";
import { PORTAL_URL } from "@/lib/portal-url";
import type { createServiceClient } from "@/lib/supabase/admin";

// The nightly pre-send check (rules in presend.ts). For each campaign with
// leads in Instantly: works out the contacts the next morning's push will add,
// checks the ones not already settled, replaces a contact that fails with the
// next person at the same fund, and records each verdict on the contact row
// (send_check), which the push reads. Then emails Rupert a summary.

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const WEB_MAX_SEARCHES = 4;
const CONCURRENCY = 8;
/** Stop starting new checks after this long, so the function finishes; the 5am run picks up the rest. */
const TIME_BUDGET_MS = 230_000;
const REPLACEMENT_TRIES = 3;

export type ContactOutcome = {
  fund: string;
  person: string;
  email: string;
  pass: boolean;
  reason: string;
  /** How it was settled: reused proof, or a new check this run. */
  how: "reused" | "web" | "hunter";
  replacedBy?: string;
  replacement?: boolean;
};

export type CampaignOutcome = {
  clientId: string;
  company: string;
  day: string;
  room: number;
  ready: number;
  outcomes: ContactOutcome[];
  cost: CheckCost;
  errors: string[];
  outOfTime: boolean;
};

// ---------------------------------------------------------------------------
// Stored checks and delivery proof

type CheckRow = StoredCheck & { firm_id: string; email_key: string; email: string; cost: CheckCost | null };

async function loadChecks(supabase: ServiceClient, firmIds: string[]): Promise<Result<Map<string, CheckRow>>> {
  const out = new Map<string, CheckRow>();
  for (let i = 0; i < firmIds.length; i += 200) {
    const rows = await selectAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("contact_checks")
        .select("firm_id, email_key, email, status, steps, checked_at, had_error, cost")
        .in("firm_id", firmIds.slice(i, i + 200))
        .range(from, to),
    );
    if (!rows.ok) return { ok: false, error: rows.error };
    for (const row of rows.rows) {
      const check: CheckRow = {
        firm_id: String(row.firm_id),
        email_key: String(row.email_key),
        email: String(row.email ?? ""),
        status: row.status ? String(row.status) : null,
        steps: (row.steps ?? {}) as CheckSteps,
        checked_at: row.checked_at ? String(row.checked_at) : null,
        had_error: Boolean(row.had_error),
        cost: (row.cost ?? null) as CheckCost | null,
      };
      // Keyed by fund and the address checked (a corrected address is checked under its original key).
      out.set(`${check.firm_id}|${emailKey(check.email || check.email_key)}`, check);
    }
  }
  return { ok: true, value: out };
}

async function loadDelivery(supabase: ServiceClient, emails: string[]): Promise<Result<Map<string, DeliveryProof>>> {
  const out = new Map<string, DeliveryProof>();
  const keys = Array.from(new Set(emails.map(emailKey).filter(Boolean)));
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await supabase
      .from("contact_delivery")
      .select("email_key, last_sent_at, delivered_at, replied_at, bounced_at")
      .in("email_key", keys.slice(i, i + 200));
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      out.set(String(row.email_key), {
        last_sent_at: row.last_sent_at ? String(row.last_sent_at) : null,
        delivered_at: row.delivered_at ? String(row.delivered_at) : null,
        replied_at: row.replied_at ? String(row.replied_at) : null,
        bounced_at: row.bounced_at ? String(row.bounced_at) : null,
      });
    }
  }
  return { ok: true, value: out };
}

/**
 * From the Instantly webhook, real sends only (never a test run's redirected
 * address): sent, replied and bounced per address, shared by every client.
 */
export async function recordDeliveryEvent(
  supabase: ServiceClient,
  input: { email: string; firmId: string; eventType: string; at: string },
) {
  const key = emailKey(input.email);
  if (!key) return;
  const column =
    input.eventType === "email_sent"
      ? "last_sent_at"
      : input.eventType === "reply_received"
        ? "replied_at"
        : input.eventType === "email_bounced"
          ? "bounced_at"
          : null;
  if (!column) return;
  const { error } = await supabase
    .from("contact_delivery")
    .upsert({ email_key: key, firm_id: input.firmId, [column]: input.at, updated_at: new Date().toISOString() }, { onConflict: "email_key" });
  if (error) console.error(`Delivery not recorded for ${key}: ${error.message}`);
}

/** Sent more than 72 hours ago and not bounced since: delivered. */
async function markDelivered(supabase: ServiceClient, now: number) {
  const cutoff = new Date(now - DELIVERED_AFTER_MS).toISOString();
  const { data, error } = await supabase
    .from("contact_delivery")
    .select("email_key, last_sent_at, delivered_at, bounced_at")
    .not("last_sent_at", "is", null)
    .lte("last_sent_at", cutoff)
    .limit(5000);
  if (error) return { marked: 0, error: error.message };
  let marked = 0;
  for (const row of data ?? []) {
    const sent = Date.parse(String(row.last_sent_at));
    const bounced = row.bounced_at ? Date.parse(String(row.bounced_at)) : NaN;
    const delivered = row.delivered_at ? Date.parse(String(row.delivered_at)) : NaN;
    if (Number.isFinite(bounced) && bounced >= sent) continue;
    if (Number.isFinite(delivered) && delivered >= sent) continue;
    const { error: saveError } = await supabase
      .from("contact_delivery")
      .update({ delivered_at: row.last_sent_at, updated_at: new Date().toISOString() })
      .eq("email_key", row.email_key);
    if (!saveError) marked += 1;
  }
  return { marked, error: null };
}

// ---------------------------------------------------------------------------
// The checks

const PRESEND_TOOL = {
  name: "report_presend",
  description: "Report whether this exact address belongs to this person, whether they are still at the fund, and the firm's address format.",
  input_schema: {
    type: "object",
    properties: {
      email_evidence: { type: "string", enum: ["exact", "none"], description: "exact: a page you found shows this exact address for this person." },
      email_evidence_url: { type: "string", description: "Only for exact: the page that shows it." },
      at_firm: { type: "string", enum: ["confirmed", "role_changed", "left_firm", "not_found"] },
      current_title: { type: "string" },
      new_firm: { type: "string", description: "Only for left_firm." },
      new_firm_website: { type: "string", description: "Only for left_firm." },
      new_title: { type: "string", description: "Only for left_firm." },
      domain_pattern: { type: "string", enum: ["matches", "differs", "unknown"] },
      pattern_example: { type: "string", description: "The domain's format, for example first.last@" },
      summary: { type: "string" },
      evidence: {
        type: "array",
        items: { type: "object", properties: { url: { type: "string" }, note: { type: "string" } }, required: ["url", "note"] },
      },
    },
    required: ["email_evidence", "at_firm", "domain_pattern", "summary", "evidence"],
  },
};

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function usageCost(usage: ClaudeUsage): Partial<CheckCost> {
  return {
    usd:
      (usage.inputTokens * CLAUDE_USD_PER_MTOK_IN) / 1_000_000 +
      (usage.outputTokens * CLAUDE_USD_PER_MTOK_OUT) / 1_000_000 +
      usage.webSearches * USD_PER_SEARCH,
    searches: usage.webSearches,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

function evidenceOf(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return { url: safeUrl(record.url), note: clip(record.note, 200) };
    })
    .filter((item) => item.url)
    .slice(0, 4);
}

async function webStep(message: OutreachMessageView, prompt: ActivePrompt) {
  const domain = message.person.email.split("@")[1] ?? "";
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt),
    content: [
      {
        type: "text",
        text: [
          `Person: ${message.person.name}`,
          `Email address to check: ${message.person.email}`,
          `Title in our database: ${message.person.title || "(none)"}`,
          `Fund: ${message.fund_name}`,
          `Email domain: ${domain}`,
        ].join("\n"),
      },
    ],
    tool: PRESEND_TOOL,
    serverTools: [webSearchTool(WEB_MAX_SEARCHES)],
    requireServerTools: true,
    maxTokens: 2000,
    timeoutMs: 120_000,
  });
  const cost = usageCost(result.usage);
  if (!result.ok) return { ok: false as const, error: result.reason, cost };
  const input = result.input;
  const atFirm = String(input.at_firm ?? "");
  if (!["confirmed", "role_changed", "left_firm", "not_found"].includes(atFirm)) {
    return { ok: false as const, error: "Claude returned an unreadable answer.", cost };
  }
  const evidence = evidenceOf(input.evidence);
  const exactUrl = safeUrl(input.email_evidence_url);
  // "Exact" needs a page we can show.
  const exact = input.email_evidence === "exact" && Boolean(exactUrl || evidence.length);
  const left = atFirm === "left_firm";
  const steps: CheckSteps = {
    role: {
      result: atFirm as "confirmed" | "role_changed" | "left_firm" | "not_found",
      currentTitle: clip(input.current_title, 200),
      newFirm: left ? clip(input.new_firm, 200) : "",
      newFirmWebsite: left ? safeUrl(input.new_firm_website) : "",
      newTitle: left ? clip(input.new_title, 200) : "",
      summary: clip(input.summary, 400),
      evidence,
      promptVersion: prompt.version,
    },
    public: {
      result: exact ? "found" : "not_found",
      summary: exact ? "A page shows this exact address for this person." : "No page found showing this exact address.",
      evidence: exact ? (exactUrl ? [{ url: exactUrl, note: "Shows this address" }] : evidence.slice(0, 1)) : [],
    },
    pattern: {
      result: (["matches", "differs", "unknown"].includes(String(input.domain_pattern)) ? input.domain_pattern : "unknown") as "matches" | "differs" | "unknown",
      pattern: clip(input.pattern_example, 60),
    },
  };
  return { ok: true as const, steps, cost };
}

async function mailboxStep(email: string): Promise<{ step: MailboxStep; hunter: number } | { error: string }> {
  if (!isHunterConfigured()) return { error: "Hunter is not set up (HUNTER_API_KEY)." };
  const verified = await verifyEmail(email);
  if (!verified.ok) return { error: verified.reason };
  return { step: { result: verified.value.status, score: verified.value.score, summary: `Hunter: ${verified.value.status}.`, suggestedEmail: "" }, hunter: 1 };
}

type Checked = { pass: boolean; reason: string; how: ContactOutcome["how"]; cost: Partial<CheckCost>; error?: string };

/** Settles one contact: reused proof, else the web search, then Hunter if needed. Saves a new check for every client. */
async function settle(
  supabase: ServiceClient,
  message: OutreachMessageView,
  ctx: { checks: Map<string, CheckRow>; delivery: Map<string, DeliveryProof>; decisions: Map<string, { decision: "keep" | "remove" }>; prompt: ActivePrompt | null; now: number },
): Promise<Checked> {
  const email = message.person.email.trim();
  const key = `${message.firm_id}|${emailKey(email)}`;
  const stored = ctx.checks.get(key) ?? null;
  const verdict = presendVerdict({
    delivery: ctx.delivery.get(emailKey(email)) ?? null,
    check: stored,
    decision: ctx.decisions.get(message.person_key)?.decision ?? null,
    now: ctx.now,
  });
  if (verdict.kind === "pass") return { pass: true, reason: verdict.reason, how: "reused", cost: {} };
  if (verdict.kind === "fail") return { pass: false, reason: verdict.reason, how: "reused", cost: {} };
  if (!ctx.prompt) return { pass: false, reason: "Not checked: the web search isn't available.", how: "web", cost: {}, error: "Claude is not set up." };

  const web = await webStep(message, ctx.prompt);
  if (!web.ok) return { pass: false, reason: `Not checked: ${web.error}`, how: "web", cost: web.cost, error: web.error };
  const steps: CheckSteps = { ...web.steps };
  let cost: CheckCost = addCost({ ...ZERO_COST }, web.cost);
  let how: ContactOutcome["how"] = "web";
  let error: string | undefined;
  if (!stepsVerdict(steps)) {
    const reused = verdict.reuseMailbox ? stored?.steps.mailbox : undefined;
    if (reused) steps.mailbox = reused;
    else {
      const mailbox = await mailboxStep(email);
      if ("error" in mailbox) error = mailbox.error;
      else {
        steps.mailbox = mailbox.step;
        cost = addCost(cost, { hunter: mailbox.hunter });
      }
    }
    how = "hunter";
  }
  const settled = stepsVerdict(steps);
  const status = finalStatus(steps);
  const { error: saveError } = await supabase.from("contact_checks").upsert(
    {
      firm_id: message.firm_id,
      email_key: stored?.email_key ?? emailKey(email),
      email,
      status,
      steps,
      suggestion: null,
      cost: { ...cost, pipeline: 3 },
      had_error: Boolean(error),
      checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "firm_id,email_key" },
  );
  if (saveError) console.error(`Pre-send check not saved for ${email}: ${saveError.message}`);
  if (!settled) return { pass: false, reason: error ? `Not confirmed: ${error}` : "Not confirmed.", how, cost, error };
  return { pass: settled.pass, reason: settled.reason, how, cost };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// One campaign

function writtenFor(message: OutreachMessageView) {
  return message.emails.some((e) => e.body.trim()) && !message.emails.some((e) => /\{\{[^}]*\}\}/.test(`${e.subject}\n${e.body}`));
}

async function saveVerdict(supabase: ServiceClient, id: string, pass: boolean, note: string) {
  return supabase
    .from("outreach_messages")
    .update({ send_check: pass ? "pass" : "fail", send_check_at: new Date().toISOString(), send_check_note: note.slice(0, 500) })
    .eq("id", id);
}

/**
 * A contact that failed: moved out of the campaign (to reserve, marked
 * failed), and the next unchecked reserve at the same fund that passes takes
 * its place, with the same group copy already written for that person.
 */
async function replace(
  supabase: ServiceClient,
  failed: OutreachMessageView,
  messages: OutreachMessageView[],
  check: (m: OutreachMessageView) => Promise<Checked>,
  outcomes: ContactOutcome[],
  costs: Partial<CheckCost>[],
  taken: Set<string>,
): Promise<string | null> {
  await supabase.from("outreach_messages").update({ slot: "reserve" }).eq("id", failed.id);
  const reserves = messages
    .filter((m) => m.firm_id === failed.firm_id && m.slot === "reserve" && m.id !== failed.id && m.send_check !== "fail" && !m.pushed_at && writtenFor(m))
    .sort((a, b) => a.position - b.position)
    .slice(0, REPLACEMENT_TRIES);
  for (const reserve of reserves) {
    if (taken.has(reserve.id)) continue;
    taken.add(reserve.id);
    const result = await check(reserve);
    costs.push(result.cost);
    await saveVerdict(supabase, reserve.id, result.pass, result.reason);
    if (!result.pass) {
      outcomes.push({ fund: reserve.fund_name, person: reserve.person.name, email: reserve.person.email, pass: false, reason: result.reason, how: result.how, replacement: true });
      continue;
    }
    // The replacement takes the failed contact's place in the fund's order.
    const swapped = await supabase
      .from("outreach_messages")
      .update({
        slot: "active",
        position: failed.position,
        status: "approved",
        approved_by: `replacement for ${failed.person.name} (pre-send check)`,
        approved_at: new Date().toISOString(),
        approved_hash: emailsHash(reserve.emails),
        replaces_message_id: failed.id,
      })
      .eq("id", reserve.id);
    if (swapped.error) return null;
    await supabase.from("outreach_messages").update({ position: reserve.position }).eq("id", failed.id);
    outcomes.push({ fund: reserve.fund_name, person: reserve.person.name, email: reserve.person.email, pass: true, reason: result.reason, how: result.how, replacement: true });
    return reserve.person.name;
  }
  return null;
}

async function checkCampaign(
  supabase: ServiceClient,
  row: Record<string, unknown>,
  prompt: ActivePrompt | null,
  started: number,
  now: number,
): Promise<CampaignOutcome> {
  const clientId = String(row.client_id);
  const settings = asLiveSettings(row.settings);
  const tz = settings.timezone;
  const day = targetSendDay(now, tz);
  const { data: client } = await supabase.from("clients").select("company_name").eq("id", clientId).maybeSingle();
  const outcome: CampaignOutcome = {
    clientId,
    company: String(client?.company_name ?? clientId),
    day,
    room: 0,
    ready: 0,
    outcomes: [],
    cost: { ...ZERO_COST },
    errors: [],
    outOfTime: false,
  };
  const decisions = await loadDecisions(supabase, clientId);
  const decisionMap = decisions.ok ? decisions.value : new Map();
  const costs: Partial<CheckCost>[] = [];
  // Contacts whose check couldn't run this time: not tried again in this run.
  const skipped = new Set<string>();
  // Replacements at one fund run one after another, so two never take the same reserve.
  const fundLocks = new Map<string, Promise<unknown>>();
  const taken = new Set<string>();

  for (let round = 0; round < 4; round += 1) {
    const loaded = await loadOutreachMessages(supabase, clientId);
    if (!loaded.ok) {
      outcome.errors.push(loaded.error);
      break;
    }
    const messages = loaded.value;
    const week = row.live_at ? campaignWeek(localDate(String(row.live_at), tz), day) : 1;
    const room = newInvestorRoom(messages, day, settings, capForWeek(settings, week), emailsPerContact(messages) - 1);
    const pushed = messages.filter((m) => m.pushed_at).length;
    const redirect = settings.redirect_to_test_inbox;
    outcome.room = redirect && settings.contact_limit > 0 ? Math.max(0, Math.min(room, settings.contact_limit - pushed)) : room;
    const queue = dripQueue(messages, {
      delayDays: settings.wave2_delay_days,
      releasedEarly: Boolean(row.wave2_pushed_at),
      limit: 0,
      now: pushInstant(day),
    });
    const want = outcome.room + spareFor(outcome.room);
    // Walk the queue in order: passed ones count; unchecked ones are checked, up to what the day needs plus spares.
    const toCheck: OutreachMessageView[] = [];
    let counted = 0;
    for (const m of queue) {
      if (counted >= want) break;
      if (skipped.has(m.id)) continue;
      if (m.send_check === "pass" || !m.send_check) {
        counted += 1;
        if (m.send_check !== "pass") toCheck.push(m);
      }
    }
    // Already-passed ones are re-read from the shared proof (a bounce at another client counts); no new search.
    outcome.ready = Math.min(outcome.room, queue.filter((m) => m.send_check === "pass").length);
    if (toCheck.length === 0) break;
    if (Date.now() - started > TIME_BUDGET_MS) {
      outcome.outOfTime = true;
      break;
    }

    const firmIds = Array.from(new Set(messages.map((m) => m.firm_id)));
    const [checks, delivery] = await Promise.all([loadChecks(supabase, firmIds), loadDelivery(supabase, messages.map((m) => m.person.email))]);
    if (!checks.ok || !delivery.ok) {
      outcome.errors.push(!checks.ok ? checks.error : (delivery as { error: string }).error);
      break;
    }
    const ctx = { checks: checks.value, delivery: delivery.value, decisions: decisionMap, prompt, now };
    const check = (m: OutreachMessageView) => settle(supabase, m, ctx);

    await mapLimit(toCheck, CONCURRENCY, async (m) => {
      if (Date.now() - started > TIME_BUDGET_MS) {
        outcome.outOfTime = true;
        return;
      }
      const result = await check(m);
      costs.push(result.cost);
      if (result.error) outcome.errors.push(`${m.person.email}: ${result.error}`);
      // A check that couldn't run is left unchecked, so the next run tries again; nothing is sent meanwhile.
      if (result.error && !result.pass && result.reason.startsWith("Not checked")) {
        skipped.add(m.id);
        outcome.outcomes.push({ fund: m.fund_name, person: m.person.name, email: m.person.email, pass: false, reason: result.reason, how: result.how });
        return;
      }
      await saveVerdict(supabase, m.id, result.pass, result.reason);
      const entry: ContactOutcome = { fund: m.fund_name, person: m.person.name, email: m.person.email, pass: result.pass, reason: result.reason, how: result.how };
      if (!result.pass) {
        const turn = (fundLocks.get(m.firm_id) ?? Promise.resolve()).then(() =>
          replace(supabase, m, messages.filter((r) => !taken.has(r.id)), check, outcome.outcomes, costs, taken),
        );
        fundLocks.set(m.firm_id, turn.catch(() => null));
        const by = await turn;
        if (by) entry.replacedBy = by;
      }
      outcome.outcomes.push(entry);
    });
    if (outcome.outOfTime || outcome.errors.some((e) => /not set up|isn't set up/.test(e))) break;
  }

  // Final count of contacts ready for the day.
  const final = await loadOutreachMessages(supabase, clientId);
  if (final.ok) {
    const queue = dripQueue(final.value, {
      delayDays: settings.wave2_delay_days,
      releasedEarly: Boolean(row.wave2_pushed_at),
      limit: 0,
      now: pushInstant(day),
    });
    outcome.ready = Math.min(outcome.room, queue.filter((m) => m.send_check === "pass").length);
  }
  outcome.cost = costs.reduce<CheckCost>((sum, c) => addCost(sum, c), { ...ZERO_COST });
  return outcome;
}

// ---------------------------------------------------------------------------
// The run

/**
 * Checks every campaign that is live, has leads in Instantly, or whose
 * client has approved the launch, except paused ones and Test Pilot clients.
 * `clientId`: one campaign only (the admin button). The summary email is sent
 * by presend-report-server.ts: code that runs AI calls never sends email.
 */
export async function checkPresend(
  supabase: ServiceClient,
  options: { clientId?: string; now?: number } = {},
): Promise<{ campaigns: CampaignOutcome[]; delivered: number; error: string | null }> {
  const started = Date.now();
  const now = options.now ?? started;
  const delivered = await markDelivered(supabase, now);

  // Nightly: campaigns that are live, have leads in Instantly, or whose client
  // has approved the launch (so the first batch is checked before Rupert adds
  // it). The admin button checks one client whatever its state.
  let query = supabase
    .from("outreach_campaigns")
    .select("client_id, live_at, leads_added_at, launch_requested_at, settings, paused_at, wave2_pushed_at, instantly_campaign_id");
  if (options.clientId) query = query.eq("client_id", options.clientId);
  const { data, error } = await query;
  if (error) return { campaigns: [], delivered: delivered.marked, error: error.message };

  const rows: Record<string, unknown>[] = [];
  for (const row of data ?? []) {
    if (!options.clientId && !row.live_at && !row.leads_added_at && !row.launch_requested_at) continue;
    if (row.paused_at && !options.clientId) continue;
    if (await isTestPilot(supabase, String(row.client_id))) continue;
    rows.push(row as Record<string, unknown>);
  }

  let prompt: ActivePrompt | null = null;
  if (rows.length > 0 && isClaudeConfigured()) {
    const loaded = await loadPrompt(supabase, "verify_presend_check", { purpose: "Pre-send email check" });
    if (loaded.ok) prompt = loaded.value;
  }

  const campaigns: CampaignOutcome[] = [];
  for (const row of rows) campaigns.push(await checkCampaign(supabase, row, prompt, started, now));

  return { campaigns, delivered: delivered.marked, error: delivered.error };
}

// ---------------------------------------------------------------------------
// The summary email

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const dayText = (day: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

export function summarySubject(campaigns: CampaignOutcome[]) {
  const failed = campaigns.reduce((n, c) => n + c.outcomes.filter((o) => !o.pass && !o.replacement).length, 0);
  const short = campaigns.filter((c) => c.ready < c.room).length;
  const day = campaigns[0]?.day;
  const flags = [failed ? plural(failed, "failed") : "", short ? `${plural(short, "campaign")} short` : ""].filter(Boolean).join(", ");
  return `Pre-send check for ${day ? dayText(day) : "the next send"}: ${flags || "all clear"}`;
}

export function summaryText(campaigns: CampaignOutcome[], delivered: number) {
  const parts: string[] = [];
  for (const c of campaigns) {
    const checkedNew = c.outcomes.filter((o) => o.how !== "reused");
    const reused = c.outcomes.filter((o) => o.how === "reused");
    const byWeb = checkedNew.filter((o) => o.pass && o.how === "web").length;
    const byHunter = checkedNew.filter((o) => o.pass && o.how === "hunter").length;
    const failed = c.outcomes.filter((o) => !o.pass);
    const lines = [
      `${c.company}: ${dayText(c.day)}`,
      `${c.ready} of ${c.room} contacts ready to add.${c.ready < c.room ? " The day is short: the rest of the queue didn't pass or wasn't checked." : ""}`,
      `Checked tonight: ${checkedNew.length} (${byWeb} passed by web search, ${byHunter} by Hunter). Reused earlier proof: ${reused.length}.`,
      `Cost: $${c.cost.usd.toFixed(2)}, ${plural(c.cost.searches, "search")}, ${plural(c.cost.hunter, "Hunter credit")}.`,
    ];
    if (failed.length) {
      lines.push("", "Did not pass (not sent):");
      for (const o of failed) {
        lines.push(`- ${o.person} <${o.email}>, ${o.fund}${o.replacement ? " (replacement)" : ""}: ${o.reason}${o.replacedBy ? ` Replaced by ${o.replacedBy}.` : !o.replacement ? " No replacement at this fund." : ""}`);
      }
    }
    const replacements = c.outcomes.filter((o) => o.replacement && o.pass);
    if (replacements.length) {
      lines.push("", "Replacements added (same fund, same copy):");
      for (const o of replacements) lines.push(`- ${o.person} <${o.email}>, ${o.fund}: ${o.reason}`);
    }
    if (c.outOfTime) lines.push("", "Ran out of time; the 5am run checks the rest before the morning push.");
    if (c.errors.length) lines.push("", "Errors:", ...Array.from(new Set(c.errors)).slice(0, 10).map((e) => `- ${e}`));
    lines.push("", `Open: ${PORTAL_URL}/admin/clients/${c.clientId}/setup`);
    parts.push(lines.join("\n"));
  }
  parts.push(`Addresses newly marked delivered (sent 72+ hours ago, no bounce): ${delivered}.`);
  return parts.join("\n\n---\n\n");
}
