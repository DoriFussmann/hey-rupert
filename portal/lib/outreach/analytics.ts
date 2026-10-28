// Campaign analytics: Instantly's delivery events counted per period, split
// by tier and by fund type. Pure module (server and browser).
// Delivered = sent − bounced (Instantly has no delivered event). Open rate =
// distinct (contact, email) opens over delivered emails: an estimate, since
// some email apps block opens. Links are not tracked.

import { fundTypeKey, FUND_TYPES } from "./copy.ts";
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
export function messageResolver<T extends { id: string; email: string }>(messages: T[]) {
  const byEmail = new Map(messages.map((m) => [m.email.trim().toLowerCase(), m]));
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
