// Campaign analytics: Instantly's delivery events counted per period, split
// by tier and by fund type. Pure module (server and browser).
// Delivered = sent − bounced (Instantly has no delivered event). Open rate =
// distinct (contact, email) opens over delivered emails: an estimate, since
// some email apps block opens. Links are not tracked.

import { fundTypeKey, FUND_TYPES } from "./copy.ts";
import { bounceComment, type BounceRecord } from "./bounce.ts";
import { localDate, testAddressId } from "./live.ts";

export const TIER_LABEL: Record<number, string> = { 1: "Core", 2: "Sphere", 3: "Tier 3", 4: "Tier 4" };

export type AnalyticsMessage = {
  id: string;
  email: string;
  tier: number;
  fund_type: string;
  meeting_at?: string | null;
};

export type AnalyticsEvent = { event_type: string; lead_email: string | null; step: number | null; at: string };
export type AnalyticsReply = { message_id: string | null; lead_email: string; at: string; auto: boolean };

/** Local days, inclusive. Null ends: open. */
export type Period = { from: string | null; to: string | null };

export type AnalyticsRow = {
  name: string;
  sent: number;
  bounced: number;
  delivered: number;
  opened: number;
  /** opened / delivered, or null with nothing delivered. */
  openRate: number | null;
  replies: number;
  /** replies / delivered, or null. */
  replyRate: number | null;
  meetings: number;
};

export type Analytics = {
  totals: AnalyticsRow;
  tiers: AnalyticsRow[];
  types: AnalyticsRow[];
  daily: { day: string; sent: number }[];
};

type Counter = { sent: number; bounced: number; opens: Set<string>; replies: number; meetings: number };
const counter = (): Counter => ({ sent: 0, bounced: 0, opens: new Set(), replies: 0, meetings: 0 });

function row(name: string, c: Counter): AnalyticsRow {
  const delivered = Math.max(0, c.sent - c.bounced);
  return {
    name,
    sent: c.sent,
    bounced: c.bounced,
    delivered,
    opened: c.opens.size,
    openRate: delivered > 0 ? Math.min(1, c.opens.size / delivered) : null,
    replies: c.replies,
    replyRate: delivered > 0 ? c.replies / delivered : null,
    meetings: c.meetings,
  };
}

/** Finds the contact for a lead address: exact match, or a test-mode + alias by id prefix. */
export function messageResolver<T extends { id: string; email: string; old_emails?: string[] }>(messages: T[]) {
  // Earlier addresses too (one that bounced before a new one was found), so their events still count.
  const byEmail = new Map<string, T>();
  for (const m of messages) for (const old of m.old_emails ?? []) byEmail.set(old.trim().toLowerCase(), m);
  for (const m of messages) byEmail.set(m.email.trim().toLowerCase(), m);
  return (email: string | null | undefined): T | null => {
    const clean = String(email ?? "").trim().toLowerCase();
    if (!clean) return null;
    const exact = byEmail.get(clean);
    if (exact) return exact;
    const alias = testAddressId(clean);
    return alias ? (messages.find((m) => m.id.replace(/-/g, "").startsWith(alias)) ?? null) : null;
  };
}

export function inPeriod(day: string, period: Period) {
  return (!period.from || day >= period.from) && (!period.to || day <= period.to);
}

/**
 * Counts for one period. `days` lists the days to chart (zero days
 * included); events on other days still count in the totals.
 */
export function computeAnalytics(input: {
  messages: AnalyticsMessage[];
  events: AnalyticsEvent[];
  replies: AnalyticsReply[];
  timeZone: string;
  period: Period;
  days: string[];
}): Analytics {
  const { timeZone, period } = input;
  const resolve = messageResolver(input.messages);
  const byId = new Map(input.messages.map((m) => [m.id, m]));
  const total = counter();
  const tiers = new Map<string, Counter>();
  const types = new Map<string, Counter>();
  const daily = new Map<string, number>(input.days.map((day) => [day, 0]));
  const groups = (m: AnalyticsMessage | null) => {
    const list = [total];
    if (m) {
      const tier = TIER_LABEL[m.tier] ?? "Tier 4";
      const type = fundTypeKey(m.fund_type);
      if (!tiers.has(tier)) tiers.set(tier, counter());
      if (!types.has(type)) types.set(type, counter());
      list.push(tiers.get(tier)!, types.get(type)!);
    }
    return list;
  };

  for (const event of input.events) {
    const day = localDate(event.at, timeZone);
    if (!inPeriod(day, period)) continue;
    const m = resolve(event.lead_email);
    const key = `${m?.id ?? String(event.lead_email ?? "").toLowerCase()}#${event.step ?? 0}`;
    for (const c of groups(m)) {
      if (event.event_type === "email_sent") c.sent += 1;
      else if (event.event_type === "email_bounced") c.bounced += 1;
      else if (event.event_type === "email_opened") c.opens.add(key);
    }
    if (event.event_type === "email_sent") daily.set(day, (daily.get(day) ?? 0) + 1);
  }

  for (const reply of input.replies) {
    if (reply.auto || !inPeriod(localDate(reply.at, timeZone), period)) continue;
    const m = (reply.message_id ? byId.get(reply.message_id) : null) ?? resolve(reply.lead_email);
    for (const c of groups(m)) c.replies += 1;
  }

  for (const m of input.messages) {
    if (!m.meeting_at || !inPeriod(localDate(m.meeting_at, timeZone), period)) continue;
    for (const c of groups(m)) c.meetings += 1;
  }

  const tierOrder = [1, 2, 3, 4].map((t) => TIER_LABEL[t]);
  return {
    totals: row("All", total),
    tiers: tierOrder.filter((name) => tiers.has(name)).map((name) => row(name, tiers.get(name)!)),
    types: FUND_TYPES.filter((name) => types.has(name)).map((name) => row(name, types.get(name)!)),
    daily: Array.from(daily.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, sent]) => ({ day, sent })),
  };
}

/** "48.3%", or "–" with nothing to divide by. */
export function percent(value: number | null) {
  return value == null ? "–" : `${Math.round(value * 1000) / 10}%`;
}

type PersonMessage = AnalyticsMessage & {
  fund_name: string;
  firm_id: string;
  person_name?: string;
  person_title?: string;
  meeting_at?: string | null;
  bounce?: { action: string; email: string; new_email?: string; replaced_by?: string } | null;
};

/** One investor in one of the lists under the Campaign Analytics cards. */
export type ActivityRow = {
  key: string;
  fund: string;
  person: string;
  title: string;
  tier: string;
  /** The emails concerned: 1 = first email, 2 = follow-up. */
  steps: number[];
  /** When it happened (the latest event of this kind in the period). */
  at: string;
  status: string;
  /** Bounced → what Rupert did; opened several times → how many. */
  comment: string;
  alert?: boolean;
};

export type Activity = { sent: ActivityRow[]; delivered: ActivityRow[]; opened: ActivityRow[]; replied: ActivityRow[]; booked: ActivityRow[] };


const newestFirst = (a: ActivityRow, b: ActivityRow) => b.at.localeCompare(a.at) || a.fund.localeCompare(b.fund);

/**
 * The five lists under the cards, one row per investor, newest first: who we sent to (and what
 * bounced), who got it (sent, not bounced), who opened (each email once, however many opens), who
 * replied (pass only the replies the viewer may count), who booked a meeting.
 */
export function contactActivity(input: {
  messages: PersonMessage[];
  events: AnalyticsEvent[];
  replies: (AnalyticsReply & { label?: string | null })[];
  timeZone: string;
  period: Period;
  labelText?: (label: string | null | undefined) => string;
}): Activity {
  const resolve = messageResolver(input.messages);
  const byId = new Map(input.messages.map((m) => [m.id, m]));
  type Acc = { sent: Set<number>; bounced: Set<number>; opened: Set<number>; opens: number; sentAt: string; openAt: string; bounceAt: string };
  const acc = new Map<string, Acc>();
  for (const event of input.events) {
    if (!inPeriod(localDate(event.at, input.timeZone), input.period)) continue;
    const m = resolve(event.lead_email);
    if (!m) continue;
    const a = acc.get(m.id) ?? { sent: new Set<number>(), bounced: new Set<number>(), opened: new Set<number>(), opens: 0, sentAt: "", openAt: "", bounceAt: "" };
    const step = event.step ?? 1;
    if (event.event_type === "email_sent") {
      a.sent.add(step);
      if (event.at > a.sentAt) a.sentAt = event.at;
    } else if (event.event_type === "email_bounced") {
      a.bounced.add(step);
      if (event.at > a.bounceAt) a.bounceAt = event.at;
    } else if (event.event_type === "email_opened") {
      a.opened.add(step);
      a.opens += 1;
      if (event.at > a.openAt) a.openAt = event.at;
    }
    acc.set(m.id, a);
  }
  const base = (m: PersonMessage) => ({
    fund: m.fund_name,
    person: m.person_name ?? "",
    title: m.person_title ?? "",
    tier: TIER_LABEL[m.tier] ?? "Tier 4",
  });
  const steps = (set: Set<number>) => Array.from(set).sort((x, y) => x - y);
  const out: Activity = { sent: [], delivered: [], opened: [], replied: [], booked: [] };
  for (const [id, a] of Array.from(acc.entries())) {
    const m = byId.get(id)!;
    if (a.sent.size) {
      const bounced = a.bounced.size > 0;
      out.sent.push({
        key: `s-${id}`,
        ...base(m),
        steps: steps(a.sent),
        at: a.bounceAt > a.sentAt ? a.bounceAt : a.sentAt,
        status: bounced ? "Bounced" : "Sent",
        comment: bounced ? bounceComment(m.bounce as BounceRecord | null) || "Bounced. Rupert is on it." : "",
        alert: bounced,
      });
      const delivered = Array.from(a.sent).filter((s) => !a.bounced.has(s));
      if (delivered.length) {
        out.delivered.push({ key: `d-${id}`, ...base(m), steps: delivered.sort((x, y) => x - y), at: a.sentAt, status: "Delivered", comment: "" });
      }
    }
    if (a.opened.size) {
      out.opened.push({
        key: `o-${id}`,
        ...base(m),
        steps: steps(a.opened),
        at: a.openAt,
        status: "Opened",
        comment: a.opens > a.opened.size ? `Opened ${a.opens} times` : "",
      });
    }
  }
  for (const reply of input.replies) {
    if (reply.auto || !inPeriod(localDate(reply.at, input.timeZone), input.period)) continue;
    const m = (reply.message_id ? byId.get(reply.message_id) : null) ?? resolve(reply.lead_email);
    if (!m) continue;
    const label = input.labelText ? input.labelText(reply.label) : (reply.label ?? "Replied");
    out.replied.push({ key: `r-${m.id}-${reply.at}`, ...base(m), steps: steps(acc.get(m.id)?.sent ?? new Set([1])), at: reply.at, status: "Replied", comment: label });
  }
  for (const m of input.messages) {
    if (!m.meeting_at || !inPeriod(localDate(m.meeting_at, input.timeZone), input.period)) continue;
    out.booked.push({ key: `b-${m.id}`, ...base(m), steps: steps(acc.get(m.id)?.sent ?? new Set([1])), at: m.meeting_at, status: "Meeting booked", comment: "" });
  }
  for (const list of Object.values(out)) list.sort(newestFirst);
  return out;
}
