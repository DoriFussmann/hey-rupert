import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/match/db-server";
import { loadOutreachMessages } from "@/lib/outreach/core-server";
import { isApproved } from "@/lib/outreach/core";
import { computeAnalytics, type Analytics, type AnalyticsEvent, type AnalyticsMessage, type AnalyticsReply } from "@/lib/outreach/analytics";
import {
  addDays,
  asLiveSettings,
  campaignWeek,
  isWeekendDay,
  localDate,
  sendingPlan,
  weekLabel,
  weekRange,
  type LiveSettings,
  type PlanWeek,
} from "@/lib/outreach/live";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type CampaignData = {
  clientId: string;
  liveAt: string;
  launchDay: string;
  today: string;
  currentWeek: number;
  settings: LiveSettings;
  pausedAt: string | null;
  messages: (AnalyticsMessage & {
    fund_name: string;
    firm_id: string;
    pushed_at: string | null;
    slot: string;
    bounced_at: string | null;
    replied_at: string | null;
    unsubscribed_at: string | null;
  })[];
  events: AnalyticsEvent[];
  /** Every reply, with its visibility. */
  replies: (AnalyticsReply & { visibility: string; fund_name: string; label: string | null })[];
  plan: PlanWeek[];
  activeTotal: number;
};

/** Everything a live campaign's analytics need. Null: not live. */
export async function loadCampaignData(supabase: ServiceClient, clientId: string): Promise<Result<CampaignData | null>> {
  const { data: live, error } = await supabase
    .from("outreach_campaigns")
    .select("live_at, settings, paused_at, instantly_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!live?.live_at || !live.instantly_campaign_id) return { ok: true, value: null };
  const settings = asLiveSettings(live.settings);
  const tz = settings.timezone;
  const campaignId = String(live.instantly_campaign_id);

  const [messages, events, replies] = await Promise.all([
    loadOutreachMessages(supabase, clientId),
    selectAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("outreach_events")
        .select("event_type, lead_email, step, received_at")
        .eq("client_id", clientId)
        .eq("instantly_campaign_id", campaignId)
        .in("event_type", ["email_sent", "email_bounced", "email_opened"])
        .order("id")
        .range(from, to),
    ),
    selectAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("outreach_replies")
        .select("message_id, lead_email, received_at, auto_reply, visibility, fund_name, label")
        .eq("client_id", clientId)
        .order("received_at")
        .range(from, to),
    ),
  ]);
  if (!messages.ok) return messages;
  if (!events.ok) return events;
  if (!replies.ok) return replies;

  const active = messages.value.filter((m) => m.slot === "active");
  const launchDay = localDate(String(live.live_at), tz);
  const today = localDate(Date.now(), tz);
  const activeTotal = active.filter((m) => isApproved(m)).length;
  return {
    ok: true,
    value: {
      clientId,
      liveAt: String(live.live_at),
      launchDay,
      today,
      currentWeek: campaignWeek(launchDay, today),
      settings,
      pausedAt: live.paused_at ? String(live.paused_at) : null,
      messages: messages.value.map((m) => ({
        id: m.id,
        email: m.person.email,
        tier: m.tier,
        fund_type: m.fund_type,
        meeting_at: m.meeting_at,
        fund_name: m.fund_name,
        firm_id: m.firm_id,
        pushed_at: m.pushed_at,
        slot: m.slot,
        bounced_at: m.bounced_at,
        replied_at: m.replied_at,
        unsubscribed_at: m.unsubscribed_at,
      })),
      events: events.rows.map((e) => ({
        event_type: String(e.event_type),
        lead_email: e.lead_email ? String(e.lead_email) : null,
        step: e.step == null ? null : Number(e.step),
        at: String(e.received_at),
      })),
      replies: replies.rows.map((r) => ({
        message_id: r.message_id ? String(r.message_id) : null,
        lead_email: String(r.lead_email ?? ""),
        at: String(r.received_at),
        auto: Boolean(r.auto_reply),
        visibility: String(r.visibility ?? "pending"),
        fund_name: String(r.fund_name ?? ""),
        label: r.label ? String(r.label) : null,
      })),
      plan: sendingPlan({
        total: activeTotal,
        settings,
        launchDay,
        today,
        tiers: [1, 2, 3, 4].map((tier) => ({
          label: ["", "Core", "Sphere", "Tier 3", "Tier 4"][tier],
          count: active.filter((m) => m.tier === tier && isApproved(m)).length,
        })),
      }),
      activeTotal,
    },
  };
}

/** Weekdays from `from` to `to`, inclusive. */
export function weekdaysIn(from: string, to: string) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekendDay(d)) days.push(d);
  return days;
}

export type PeriodChoice = { from: number; to: number } | null;

/** Reads ?from=&to= (campaign weeks) into a valid range, or null for all time. */
export function periodChoice(params: { from?: string | string[]; to?: string | string[] }, currentWeek: number): PeriodChoice {
  const num = (value: string | string[] | undefined) => Math.round(Number(Array.isArray(value) ? value[0] : value));
  const from = num(params.from);
  if (!Number.isFinite(from) || from < 1) return null;
  const toRaw = num(params.to);
  const to = Number.isFinite(toRaw) && toRaw >= from ? toRaw : from;
  return { from: Math.min(from, currentWeek), to: Math.min(to, currentWeek) };
}

export type ClientAnalytics = {
  data: CampaignData;
  choice: PeriodChoice;
  label: string;
  dates: string;
  analytics: Analytics;
};

/** The client's Campaign Analytics: released replies only. */
export function clientAnalytics(data: CampaignData, choice: PeriodChoice): ClientAnalytics {
  const start = choice ? weekRange(data.launchDay, choice.from).start : data.launchDay;
  const endRaw = choice ? weekRange(data.launchDay, choice.to).end : data.today;
  const end = endRaw > data.today ? data.today : endRaw;
  const label = !choice ? "All time" : choice.from === choice.to ? `Week ${choice.from}` : `Weeks ${choice.from}–${choice.to}`;
  return {
    data,
    choice,
    label,
    dates: end >= start ? weekLabel(start, end) : weekLabel(start, start),
    analytics: computeAnalytics({
      messages: data.messages,
      events: data.events,
      replies: data.replies.filter((r) => r.visibility === "released"),
      timeZone: data.settings.timezone,
      period: { from: choice ? start : null, to: choice ? end : null },
      days: weekdaysIn(start, end),
    }),
  };
}
