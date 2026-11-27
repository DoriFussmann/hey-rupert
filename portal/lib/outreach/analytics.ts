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

export type OpenedContact = { name: string; title: string; steps: number[]; lastAt: string };
export type OpenedFund = {
  firmId: string;
  fund: string;
  tier: string;
  /** Contacts at the fund who opened, of those emailed in the period. */
  opened: number;
  emailed: number;
  /** Which emails were opened: 1 = first email, 2 = follow-up. */
  steps: number[];
  /** Opens counted once per contact and email. */
  opens: number;
  lastAt: string;
  people: OpenedContact[];
};

/**
 * Who opened, by fund: each fund with an open in the period, newest first. A contact counts once per
 * email it opened (Instantly can report several opens of one email). An estimate: some email apps
 * block opens, and some (Apple Mail) open every email automatically.
 */
export function whoOpened(input: {
  messages: (AnalyticsMessage & { fund_name: string; firm_id: string; person_name?: string; person_title?: string })[];
  events: AnalyticsEvent[];
  timeZone: string;
  period: Period;
}): OpenedFund[] {
  const resolve = messageResolver(input.messages);
  const emailed = new Map<string, Set<string>>();
  const opened = new Map<string, Map<string, { steps: Set<number>; lastAt: string }>>();
  for (const event of input.events) {
    if (!inPeriod(localDate(event.at, input.timeZone), input.period)) continue;
    const m = resolve(event.lead_email);
    if (!m) continue;
    if (event.event_type === "email_sent") {
      if (!emailed.has(m.firm_id)) emailed.set(m.firm_id, new Set());
      emailed.get(m.firm_id)!.add(m.id);
    } else if (event.event_type === "email_opened") {
      if (!opened.has(m.firm_id)) opened.set(m.firm_id, new Map());
      const people = opened.get(m.firm_id)!;
      const entry = people.get(m.id) ?? { steps: new Set<number>(), lastAt: event.at };
      entry.steps.add(event.step ?? 1);
      if (event.at > entry.lastAt) entry.lastAt = event.at;
      people.set(m.id, entry);
    }
  }
  const byId = new Map(input.messages.map((m) => [m.id, m]));
  const funds: OpenedFund[] = [];
  for (const [firmId, people] of Array.from(opened.entries())) {
    const list: OpenedContact[] = Array.from(people.entries()).map(([id, e]) => {
      const m = byId.get(id)!;
      return { name: m.person_name ?? "", title: m.person_title ?? "", steps: Array.from(e.steps).sort((x, y) => x - y), lastAt: e.lastAt };
    });
    list.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    const first = byId.get(Array.from(people.keys())[0])!;
    const steps = Array.from(new Set(list.flatMap((p) => p.steps))).sort((x, y) => x - y);
    funds.push({
      firmId,
      fund: first.fund_name,
      tier: TIER_LABEL[first.tier] ?? "Tier 4",
      opened: list.length,
      emailed: Math.max(list.length, emailed.get(firmId)?.size ?? 0),
      steps,
      opens: list.reduce((n, p) => n + p.steps.length, 0),
      lastAt: list[0].lastAt,
      people: list,
    });
  }
  return funds.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.fund.localeCompare(b.fund));
}

export type ReceivedContact = { name: string; title: string; steps: number[]; bounced: boolean; lastAt: string };
export type ReceivedFund = {
  firmId: string;
  fund: string;
  tier: string;
  /** Contacts emailed at the fund in the period, and how many of them bounced. */
  emailed: number;
  bounced: number;
  /** Emails sent and delivered (sent minus bounced), counted per contact and email. */
  sent: number;
  delivered: number;
  /** Which emails went out: 1 = first email, 2 = follow-up. */
  steps: number[];
  lastAt: string;
  people: ReceivedContact[];
};

/**
 * Who got it, by fund: each fund emailed in the period, newest first, with what was delivered and what
 * bounced. Delivered is sent minus bounced, as in the totals (Instantly has no delivered event).
 */
export function whoGotIt(input: {
  messages: (AnalyticsMessage & { fund_name: string; firm_id: string; person_name?: string; person_title?: string })[];
  events: AnalyticsEvent[];
  timeZone: string;
  period: Period;
}): ReceivedFund[] {
  const resolve = messageResolver(input.messages);
  const byId = new Map(input.messages.map((m) => [m.id, m]));
  const perContact = new Map<string, { steps: Set<number>; bouncedSteps: Set<number>; lastAt: string }>();
  for (const event of input.events) {
    if (event.event_type !== "email_sent" && event.event_type !== "email_bounced") continue;
    if (!inPeriod(localDate(event.at, input.timeZone), input.period)) continue;
    const m = resolve(event.lead_email);
    if (!m) continue;
    const entry = perContact.get(m.id) ?? { steps: new Set<number>(), bouncedSteps: new Set<number>(), lastAt: event.at };
    if (event.event_type === "email_sent") entry.steps.add(event.step ?? 1);
    else entry.bouncedSteps.add(event.step ?? 1);
    if (event.at > entry.lastAt) entry.lastAt = event.at;
    perContact.set(m.id, entry);
  }
  const funds = new Map<string, ReceivedFund>();
  for (const [id, e] of Array.from(perContact.entries())) {
    if (e.steps.size === 0) continue;
    const m = byId.get(id)!;
    const fund =
      funds.get(m.firm_id) ??
      { firmId: m.firm_id, fund: m.fund_name, tier: TIER_LABEL[m.tier] ?? "Tier 4", emailed: 0, bounced: 0, sent: 0, delivered: 0, steps: [], lastAt: e.lastAt, people: [] };
    const bounced = e.bouncedSteps.size > 0;
    fund.emailed += 1;
    if (bounced) fund.bounced += 1;
    fund.sent += e.steps.size;
    fund.delivered += Math.max(0, e.steps.size - e.bouncedSteps.size);
    fund.steps = Array.from(new Set([...fund.steps, ...Array.from(e.steps)])).sort((x, y) => x - y);
    if (e.lastAt > fund.lastAt) fund.lastAt = e.lastAt;
    fund.people.push({ name: m.person_name ?? "", title: m.person_title ?? "", steps: Array.from(e.steps).sort((x, y) => x - y), bounced, lastAt: e.lastAt });
    funds.set(m.firm_id, fund);
  }
  const list = Array.from(funds.values());
  for (const f of list) f.people.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return list.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.fund.localeCompare(b.fund));
}

type PersonMessage = AnalyticsMessage & { fund_name: string; firm_id: string; person_name?: string; person_title?: string };

export type RepliedFund = {
  firmId: string;
  fund: string;
  tier: string;
  /** Replies from the fund's investors in the period (auto-replies left out). */
  replies: number;
  /** Their labels, most recent first, without repeats (e.g. "interested"). */
  labels: string[];
  lastAt: string;
  people: { name: string; title: string; label: string | null; at: string }[];
};

/** Who replied, by fund, newest first. Pass only the replies the viewer may count (the client: released). */
export function whoReplied(input: {
  messages: PersonMessage[];
  replies: (AnalyticsReply & { label?: string | null; fund_name?: string })[];
  timeZone: string;
  period: Period;
}): RepliedFund[] {
  const resolve = messageResolver(input.messages);
  const byId = new Map(input.messages.map((m) => [m.id, m]));
  const funds = new Map<string, RepliedFund>();
  const sorted = [...input.replies].sort((a, b) => b.at.localeCompare(a.at));
  for (const reply of sorted) {
    if (reply.auto || !inPeriod(localDate(reply.at, input.timeZone), input.period)) continue;
    const m = (reply.message_id ? byId.get(reply.message_id) : null) ?? resolve(reply.lead_email);
    const firmId = m?.firm_id ?? `reply:${reply.fund_name || reply.lead_email}`;
    const fund =
      funds.get(firmId) ??
      { firmId, fund: m?.fund_name ?? reply.fund_name ?? "", tier: m ? (TIER_LABEL[m.tier] ?? "Tier 4") : "", replies: 0, labels: [], lastAt: reply.at, people: [] };
    fund.replies += 1;
    if (reply.label && !fund.labels.includes(reply.label)) fund.labels.push(reply.label);
    fund.people.push({ name: m?.person_name ?? "", title: m?.person_title ?? "", label: reply.label ?? null, at: reply.at });
    funds.set(firmId, fund);
  }
  return Array.from(funds.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.fund.localeCompare(b.fund));
}

export type BookedFund = { firmId: string; fund: string; tier: string; meetings: number; lastAt: string; people: { name: string; title: string; at: string }[] };

/** Who booked a meeting, by fund, newest first. */
export function whoBooked(input: { messages: (PersonMessage & { meeting_at?: string | null })[]; timeZone: string; period: Period }): BookedFund[] {
  const funds = new Map<string, BookedFund>();
  for (const m of input.messages) {
    if (!m.meeting_at || !inPeriod(localDate(m.meeting_at, input.timeZone), input.period)) continue;
    const fund = funds.get(m.firm_id) ?? { firmId: m.firm_id, fund: m.fund_name, tier: TIER_LABEL[m.tier] ?? "Tier 4", meetings: 0, lastAt: m.meeting_at, people: [] };
    fund.meetings += 1;
    if (m.meeting_at > fund.lastAt) fund.lastAt = m.meeting_at;
    fund.people.push({ name: m.person_name ?? "", title: m.person_title ?? "", at: m.meeting_at });
    funds.set(m.firm_id, fund);
  }
  return Array.from(funds.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.fund.localeCompare(b.fund));
}
