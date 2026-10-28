// Going live: the Instantly campaign, the leads, the gates before Go Live,
// delivery events and reply triage. Pure module, safe on the server and in
// the browser. See claude/rupert-outreach-spec.md in the project.

import type { CopyEmail } from "../setup.ts";
import { optOutFor } from "./copy.ts";
import { isApproved, type CoreMessage } from "./core.ts";
import { waveOf } from "./campaign.ts";
import { interleaveByTier } from "./mix.ts";

// ---------------------------------------------------------------------------
// Sending settings

export type LiveSettings = {
  /** Emails per day from the client's inbox. */
  daily_limit: number;
  /** An Instantly timezone name. */
  timezone: string;
  from: string;
  to: string;
  /** Days before follow-up 1 and before follow-up 2. */
  followup_days: [number, number];
  /** Days after a fund's first contact is sent before its other contacts start. */
  wave2_delay_days: number;
  track_opens: boolean;
  /** New investors added to the campaign per day at full pace, mixed across tiers. 0: everyone at once. */
  new_per_day: number;
  /** The first weeks' pace, before full pace: [10, 20] = 10 a day in week 1, 20 in week 2. */
  ramp: number[];
  /** Test mode (Test Pilot clients only): every email goes to a + address of this inbox. */
  test_recipient: string;
};

/**
 * Eastern time. Instantly's timezone list doesn't take America/New_York;
 * America/Detroit is the same clock (EST/EDT).
 */
export const EASTERN = "America/Detroit";

export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  // Each investor gets up to 3 emails, so the cap is 3× full pace: 30 new a
  // day needs up to 90 emails a day once follow-ups overlap.
  daily_limit: 90,
  timezone: EASTERN,
  from: "09:00",
  to: "17:00",
  followup_days: [4, 5],
  wave2_delay_days: 3,
  track_opens: true,
  new_per_day: 30,
  ramp: [10, 20],
  test_recipient: "",
};

const int = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const hhmm = (value: unknown, fallback: string) => (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback);

export function asLiveSettings(value: unknown): LiveSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_LIVE_SETTINGS;
  const followups = Array.isArray(raw.followup_days) ? raw.followup_days : [];
  const tzRaw = typeof raw.timezone === "string" && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(raw.timezone) ? raw.timezone : d.timezone;
  // Instantly rejects America/New_York: same clock, accepted name.
  const tz = tzRaw === "America/New_York" ? EASTERN : tzRaw;
  const ramp = Array.isArray(raw.ramp)
    ? raw.ramp.slice(0, 8).map((n) => int(n, 0, 500, -1)).filter((n) => n >= 0)
    : d.ramp;
  const from = hhmm(raw.from, d.from);
  const to = hhmm(raw.to, d.to);
  return {
    daily_limit: int(raw.daily_limit, 1, 200, d.daily_limit),
    timezone: tz,
    from: from < to ? from : d.from,
    to: from < to ? to : d.to,
    followup_days: [int(followups[0], 1, 30, d.followup_days[0]), int(followups[1], 1, 30, d.followup_days[1])],
    wave2_delay_days: int(raw.wave2_delay_days, 0, 14, d.wave2_delay_days),
    track_opens: typeof raw.track_opens === "boolean" ? raw.track_opens : d.track_opens,
    new_per_day: int(raw.new_per_day, 0, 500, d.new_per_day),
    ramp,
    test_recipient: typeof raw.test_recipient === "string" && EMAIL.test(raw.test_recipient.trim()) ? raw.test_recipient.trim().toLowerCase() : "",
  };
}

const EMAIL = /^[^\s@+]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Test mode: a Test Pilot client's campaign only ever emails Rupert's own inbox

const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);

/**
 * The address a contact gets in test mode: a + alias of the test inbox that
 * names the fund and person and ends with the contact's id, so replies map
 * back. Google Workspace delivers every + alias to the inbox itself.
 */
export function testAddress(recipient: string, message: { id: string; fund_name: string; person: { first_name: string } }) {
  const [local, domain] = recipient.split("@");
  const tag = [slug(message.fund_name), slug(message.person.first_name), message.id.replace(/-/g, "").slice(0, 8)].filter(Boolean).join("-");
  return `${local}+${tag}@${domain}`;
}

/** The contact id prefix in a test address, or null when it isn't one. */
export function testAddressId(email: string) {
  const match = /\+[a-z0-9-]*?([0-9a-f]{8})@/i.exec(email.trim());
  return match ? match[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Sending order: a proportional mix of tiers, every batch

export { interleaveByTier };

export type QueueMessage = LeadMessage & { tier: number; firm_id: string; pushed_at?: string | null };

/**
 * The next contacts to add to the live campaign: approved, active, not yet
 * added, one per address. A fund's first contact is always eligible; its
 * other contacts once the first was added at least `delayDays` ago (or when
 * Rupert released them early). Due second contacts go first, then first
 * contacts, each group in a proportional mix of tiers. `limit` 0 = no limit.
 */
export function dripQueue<T extends QueueMessage>(
  messages: T[],
  options: { delayDays: number; releasedEarly: boolean; limit: number; now?: number },
): T[] {
  const now = options.now ?? Date.now();
  const firstPushed = new Map<string, number>();
  for (const m of messages) {
    if (m.slot === "active" && m.pushed_at && waveOf(m) === 1) firstPushed.set(m.firm_id, Date.parse(m.pushed_at));
  }
  const firmHasFirst = new Set(messages.filter((m) => m.slot === "active" && waveOf(m) === 1).map((m) => m.firm_id));
  const seen = new Set(messages.filter((m) => m.pushed_at).map((m) => m.person.email.trim().toLowerCase()));
  const firsts: T[] = [];
  const seconds: T[] = [];
  for (const m of messages) {
    const email = m.person.email.trim().toLowerCase();
    if (m.slot !== "active" || !email || seen.has(email) || m.pushed_at || !isApproved(m)) continue;
    if (waveOf(m) === 1) {
      firsts.push(m);
    } else {
      const at = firstPushed.get(m.firm_id);
      // A fund whose first contact was moved out: its next contact counts as a first one.
      if (!firmHasFirst.has(m.firm_id)) firsts.push(m);
      else if (options.releasedEarly ? at !== undefined : at !== undefined && now >= at + options.delayDays * 86_400_000) seconds.push(m);
      else continue;
    }
    seen.add(email);
  }
  const queue = [...interleaveByTier(seconds), ...interleaveByTier(firsts)];
  return options.limit > 0 ? queue.slice(0, options.limit) : queue;
}

// ---------------------------------------------------------------------------
// The Instantly campaign: three steps whose subject and body are per-lead variables

/**
 * Follow-ups are always sent as replies in the same thread (blank subject),
 * so a follow-up subject written in the copy is not used.
 */
export function campaignBody(
  name: string,
  inbox: string,
  settings: LiveSettings,
  options: { test?: boolean; testMode?: boolean } = {},
) {
  // A test send, or a Test Pilot campaign in test mode: every day, minutes instead of days.
  const fast = Boolean(options.test || options.testMode);
  const days = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((key) => [key, fast ? true : key >= "1" && key <= "5"]));
  const delayUnit = fast ? "minutes" : "days";
  // Test send: 2 minutes apart. Test mode: the settings' days, read as minutes.
  const delays = options.test ? [2, 2] : settings.followup_days;
  return {
    name: name.slice(0, 200),
    campaign_schedule: {
      schedules: [
        {
          name: fast ? "Test" : "Weekdays",
          timing: fast ? { from: "00:00", to: "23:59" } : { from: settings.from, to: settings.to },
          days,
          timezone: settings.timezone,
        },
      ],
    },
    sequences: [
      {
        steps: [
          { type: "email", delay: delays[0], delay_unit: delayUnit, variants: [{ subject: "{{subject_1}}", body: "{{body_1}}" }] },
          { type: "email", delay: delays[1], delay_unit: delayUnit, variants: [{ subject: "", body: "{{body_2}}" }] },
          { type: "email", delay: 0, delay_unit: delayUnit, variants: [{ subject: "", body: "{{body_3}}" }] },
        ],
      },
    ],
    email_list: [inbox],
    daily_limit: settings.daily_limit,
    stop_on_reply: true,
    // Test addresses all share one domain: stopping "for the company" would stop them all.
    stop_for_company: !fast,
    stop_on_auto_reply: false,
    open_tracking: settings.track_opens,
    link_tracking: false,
    text_only: false,
  };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text as Instantly HTML: line breaks become <br/>. */
export function toInstantlyHtml(value: string) {
  return escapeHtml(value.trim()).replace(/\r?\n/g, "<br/>");
}

export type LeadMessage = Pick<CoreMessage, "id" | "person" | "fund_name" | "emails" | "slot" | "status" | "approved_hash" | "position">;

/** One contact as an Instantly lead: their own three emails as variables. */
export function leadFor(message: LeadMessage, optOutLine: string, overrideEmail?: string) {
  const vars: Record<string, string> = {};
  message.emails.forEach((email: CopyEmail, index) => {
    const optOut = optOutFor(index, optOutLine).trim();
    const body = optOut ? `${email.body.trimEnd()}\n\n${optOut}` : email.body;
    vars[`subject_${index + 1}`] = email.subject.trim();
    vars[`body_${index + 1}`] = toInstantlyHtml(body);
  });
  return {
    email: overrideEmail ?? message.person.email.trim(),
    first_name: message.person.first_name || null,
    last_name: message.person.name.replace(message.person.first_name, "").trim() || null,
    company_name: message.fund_name,
    job_title: message.person.title || null,
    custom_variables: vars,
  };
}

/** The leads to push for a wave: active, approved, not pushed yet, one per address. */
export function leadsForWave<T extends LeadMessage & { pushed_at?: string | null }>(messages: T[], wave: 1 | 2) {
  const seen = new Set<string>();
  return messages.filter((m) => {
    const email = m.person.email.trim().toLowerCase();
    if (m.slot !== "active" || !email || seen.has(email) || m.pushed_at || waveOf(m) !== wave || !isApproved(m)) return false;
    seen.add(email);
    return true;
  });
}

export function isWave2Due(liveAt: string | null, delayDays: number, now = Date.now()) {
  if (!liveAt) return false;
  const at = Date.parse(liveAt);
  return Number.isFinite(at) && now >= at + delayDays * 86_400_000;
}

// ---------------------------------------------------------------------------
// Campaign weeks and the sending plan. A campaign week is 5 weekdays counted
// from the launch day (Week 1 = launch day and the next 4 weekdays). Dates
// are local calendar days ("YYYY-MM-DD") in the campaign's timezone.

/** The calendar day of an instant in a timezone, as YYYY-MM-DD. */
export function localDate(at: string | number | Date, timeZone: string) {
  const date = at instanceof Date ? at : new Date(at);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const dayMs = 86_400_000;
const toUtc = (day: string) => Date.parse(`${day}T12:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const isWeekendDay = (day: string) => {
  const dow = new Date(toUtc(day)).getUTCDay();
  return dow === 0 || dow === 6;
};
export const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * dayMs);

/** The weekday on or after `day`. */
export function nextWeekday(day: string) {
  let d = day;
  while (isWeekendDay(d)) d = addDays(d, 1);
  return d;
}

/** `n` weekdays after `day` (n = 0: `day` itself, moved to a weekday). */
export function addWeekdays(day: string, n: number) {
  let d = nextWeekday(day);
  for (let i = 0; i < n; i += 1) d = nextWeekday(addDays(d, 1));
  return d;
}

/** Weekdays after `start`, up to and including `day`. */
export function weekdaysBetween(start: string, day: string) {
  if (day <= start) return 0;
  let n = 0;
  for (let d = addDays(start, 1); d <= day; d = addDays(d, 1)) if (!isWeekendDay(d)) n += 1;
  return n;
}

/** The campaign week (1-based) a day falls in, counted from the launch day. */
export function campaignWeek(launchDay: string, day: string) {
  return Math.floor(weekdaysBetween(nextWeekday(launchDay), day) / 5) + 1;
}

/** The first and last weekday of campaign week `week`. */
export function weekRange(launchDay: string, week: number) {
  const start = addWeekdays(launchDay, (week - 1) * 5);
  return { start, end: addWeekdays(start, 4) };
}

/** New investors a day in a given campaign week. 0 = everyone at once. */
export function perDayForWeek(settings: Pick<LiveSettings, "ramp" | "new_per_day">, week: number) {
  if (settings.new_per_day === 0) return 0;
  return week >= 1 && week <= settings.ramp.length ? settings.ramp[week - 1] : settings.new_per_day;
}

export type PlanPhase = "Warm-up" | "Ramp-up" | "Full pace" | "Follow-ups only";

export type PlanWeek = {
  week: number;
  start: string;
  end: string;
  phase: PlanPhase;
  perDay: number;
  newInvestors: number;
  /** Approximate: first emails plus follow-ups, capped by the daily limit. */
  emails: number;
  status: "done" | "current" | "next" | "planned";
};

/**
 * The week-by-week sending plan for `total` contacts from `launchDay`.
 * Follow-up delays are counted in weekdays and each investor is assumed to
 * get all three emails, so the email counts are an upper estimate. `today`
 * marks the current week (or, before launch, the first week as next).
 */
export function sendingPlan(input: {
  total: number;
  settings: Pick<LiveSettings, "ramp" | "new_per_day" | "followup_days" | "daily_limit">;
  launchDay: string;
  today: string | null;
}): PlanWeek[] {
  const { settings } = input;
  const start = nextWeekday(input.launchDay);
  const [f1, f2] = settings.followup_days;
  const due = new Map<number, number>();
  let remaining = Math.max(0, Math.floor(input.total));
  let backlog = 0;
  const weeks: PlanWeek[] = [];
  const currentWeek = input.today ? campaignWeek(start, input.today) : 0;
  for (let w = 1; w <= 26; w += 1) {
    const perDay = perDayForWeek(settings, w);
    let newInvestors = 0;
    let emails = 0;
    for (let i = 0; i < 5; i += 1) {
      const day = (w - 1) * 5 + i;
      const fresh = perDay === 0 ? remaining : Math.min(perDay, remaining);
      remaining -= fresh;
      newInvestors += fresh;
      if (fresh > 0) {
        due.set(day + f1, (due.get(day + f1) ?? 0) + fresh);
        due.set(day + f1 + f2, (due.get(day + f1 + f2) ?? 0) + fresh);
      }
      backlog += fresh + (due.get(day) ?? 0);
      due.delete(day);
      const sent = Math.min(backlog, settings.daily_limit);
      backlog -= sent;
      emails += sent;
    }
    if (newInvestors === 0 && emails === 0) break;
    const range = weekRange(start, w);
    const phase: PlanPhase =
      newInvestors === 0 ? "Follow-ups only" : w <= settings.ramp.length && settings.new_per_day > 0 ? (w === 1 ? "Warm-up" : "Ramp-up") : "Full pace";
    const status = !input.today ? (w === 1 ? "next" : "planned") : w < currentWeek ? "done" : w === currentWeek ? "current" : "planned";
    weeks.push({ week: w, ...range, phase, perDay: newInvestors === 0 ? 0 : perDay === 0 ? newInvestors : perDay, newInvestors, emails, status });
    if (remaining === 0 && due.size === 0 && backlog === 0) break;
  }
  return weeks;
}

/** "Nov 2 – 6" or "Nov 30 – Dec 4". */
export function weekLabel(start: string, end: string) {
  const fmt = (day: string, withMonth: boolean) =>
    new Intl.DateTimeFormat("en-US", withMonth ? { month: "short", day: "numeric", timeZone: "UTC" } : { day: "numeric", timeZone: "UTC" }).format(new Date(toUtc(day)));
  return `${fmt(start, true)} – ${fmt(end, start.slice(0, 7) !== end.slice(0, 7))}`;
}

// ---------------------------------------------------------------------------
// Gates before Go Live

export type GoLiveInput = {
  campaignReady: boolean;
  inboxConnected: boolean;
  inboxHealthy: boolean;
  invoicePaid: boolean;
  alreadyLive: boolean;
};

/** What still stands between the client and Go Live, in the client's words. */
export function goLiveGaps(input: GoLiveInput): string[] {
  if (input.alreadyLive) return ["Your campaign is already live."];
  const gaps: string[] = [];
  if (!input.campaignReady) gaps.push("Rupert is finishing your campaign.");
  if (!input.inboxConnected) gaps.push("Connect your inbox.");
  else if (!input.inboxHealthy) gaps.push("Your inbox needs attention: Rupert will check it with you.");
  if (!input.invoicePaid) gaps.push("Pay the first monthly invoice.");
  return gaps;
}

/** Instantly account status: 1 is active. Anything else is not treated as healthy. */
export function inboxHealthy(status: number | null | undefined) {
  return status === 1;
}

export function inboxStatusText(status: number | null | undefined) {
  if (status === 1) return "Active";
  if (status === 2) return "Paused";
  if (status == null) return "Not checked";
  return status < 0 ? `Error (${status}): reconnect the inbox` : `Status ${status}`;
}

// ---------------------------------------------------------------------------
// Delivery events (Instantly webhook)

export type DeliveryPatch = Partial<{
  sent_at: string;
  last_step: number;
  opened_at: string;
  replied_at: string;
  bounced_at: string;
  unsubscribed_at: string;
  meeting_at: string;
}>;

/** How one webhook event changes a contact's row. Null: no change. */
export function deliveryPatch(eventType: string, at: string, step: number | null): DeliveryPatch | null {
  switch (eventType) {
    case "email_sent":
      return step ? { sent_at: at, last_step: step } : { sent_at: at };
    case "email_opened":
      return { opened_at: at };
    case "reply_received":
      return { replied_at: at };
    case "email_bounced":
      return { bounced_at: at };
    case "lead_unsubscribed":
      return { unsubscribed_at: at };
    case "lead_meeting_booked":
      return { meeting_at: at };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Reply triage: everything reaches Rupert first; he releases what the client should see

export const REPLY_LABELS = [
  { value: "interested", label: "Interested", release: true },
  { value: "question", label: "Question", release: true },
  { value: "not_now", label: "Not now", release: true },
  { value: "pass", label: "Pass", release: true },
  { value: "out_of_office", label: "Out of office", release: false },
  { value: "wrong_person", label: "Wrong person / left", release: false },
  { value: "bounce", label: "Bounce", release: false },
  { value: "opt_out", label: "Opt-out", release: false },
  { value: "other", label: "Other", release: false },
] as const;

export type ReplyLabel = (typeof REPLY_LABELS)[number]["value"];
export type ReplyVisibility = "pending" | "released" | "withheld";

export function asReplyLabel(value: unknown): ReplyLabel | null {
  return REPLY_LABELS.some((item) => item.value === value) ? (value as ReplyLabel) : null;
}

export function replyLabelText(value: string | null | undefined) {
  return REPLY_LABELS.find((item) => item.value === value)?.label ?? "Not labelled";
}

/** Whether the label suggests releasing the reply to the client. Rupert decides. */
export function suggestsRelease(label: string | null | undefined) {
  return REPLY_LABELS.find((item) => item.value === label)?.release ?? false;
}

/** Plain text of an email reply: HTML stripped, quoted history dropped. */
export function replyText(text: string | null | undefined, html: string | null | undefined) {
  const source =
    text && text.trim()
      ? text
      : String(html ?? "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/p>/gi, "\n\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
  const lines = source.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex((line) => /^On .+ wrote:\s*$/.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line.trim()) || /^From: /.test(line.trim()));
  return (cut > 0 ? lines.slice(0, cut) : lines).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// What the client sees: funds by stage, and totals

export type PipelineStage = "queued" | "contacted" | "replied" | "meeting" | "passed";

export type DeliveryRow = {
  firm_id: string;
  fund_name: string;
  pushed_at: string | null;
  sent_at: string | null;
  opened_at: string | null;
  meeting_at: string | null;
  bounced_at: string | null;
};

export type ReleasedReply = { firm_id: string; label: string | null };

/** One stage per fund: the furthest any of its contacts reached. Only released replies count. */
export function fundStage(rows: DeliveryRow[], replies: ReleasedReply[]): PipelineStage | null {
  if (rows.some((row) => row.meeting_at)) return "meeting";
  if (replies.length > 0) {
    return replies.every((reply) => reply.label === "pass") ? "passed" : "replied";
  }
  if (rows.some((row) => row.sent_at)) return "contacted";
  if (rows.some((row) => row.pushed_at)) return "queued";
  return null;
}

export function clientTotals(rows: DeliveryRow[], replies: ReleasedReply[]) {
  return {
    funds: new Set(rows.filter((row) => row.pushed_at).map((row) => row.firm_id)).size,
    contacted: rows.filter((row) => row.sent_at).length,
    opened: rows.filter((row) => row.opened_at).length,
    replied: new Set(replies.map((reply) => reply.firm_id)).size,
    meetings: new Set(rows.filter((row) => row.meeting_at).map((row) => row.firm_id)).size,
  };
}
