import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { sendAdminEmail, type EmailResult } from "@/lib/email";
import { getAccount, isInstantlyConfigured } from "@/lib/instantly";
import { computeAnalytics, percent, TIER_LABEL } from "@/lib/outreach/analytics";
import { loadCampaignData, type CampaignData } from "@/lib/outreach/analytics-server";
import {
  addDays,
  campaignWeek,
  inboxStatusText,
  isWeekendDay,
  localDate,
  nextWeekday,
  perDayForWeek,
  replyLabelText,
  weekLabel,
} from "@/lib/outreach/live";
import { PORTAL_URL } from "@/lib/portal-url";

// Rupert's daily summary, weekdays at 5pm Eastern: per live client, what was
// sent today, what needs him (replies to review, bounces to replace), the
// campaign so far and tomorrow's batch.

type ServiceClient = ReturnType<typeof createServiceClient>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type ClientSummary = { text: string; sent: number; pending: number; bounces: number };

function summarize(data: CampaignData, company: string, test: boolean, inbox: string): ClientSummary {
  const tz = data.settings.timezone;
  const today = data.today;
  const sameDay = (at: string | null | undefined) => Boolean(at) && localDate(at as string, tz) === today;

  const todayStats = computeAnalytics({
    messages: data.messages,
    events: data.events,
    replies: data.replies,
    timeZone: tz,
    period: { from: today, to: today },
    days: [today],
  }).totals;
  const allTime = computeAnalytics({
    messages: data.messages,
    events: data.events,
    replies: data.replies,
    timeZone: tz,
    period: { from: null, to: null },
    days: [],
  }).totals;

  const pending = data.replies.filter((r) => r.visibility === "pending" && !r.auto);
  const bouncedToday = data.messages.filter((m) => sameDay(m.bounced_at));
  const startedToday = data.messages.filter((m) => sameDay(m.pushed_at));
  const byTier = [1, 2, 3, 4]
    .map((t) => [TIER_LABEL[t], startedToday.filter((m) => m.tier === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name} ${n}`)
    .join(", ");
  const started = data.messages.filter((m) => m.pushed_at).length;

  const tomorrow = nextWeekday(addDays(today, 1));
  const perDay = perDayForWeek(data.settings, campaignWeek(data.launchDay, tomorrow));
  const remaining = Math.max(0, data.activeTotal - started);
  const tomorrowNew = perDay === 0 ? remaining : Math.min(perDay, remaining);
  const lastFirst = [...data.plan].reverse().find((w) => w.newInvestors > 0);

  const needs: string[] = [];
  if (pending.length > 0) {
    const names = pending.slice(0, 5).map((r) => `${r.fund_name || r.lead_email}${r.label ? ` (${replyLabelText(r.label).toLowerCase()})` : ""}`);
    needs.push(`- ${plural(pending.length, "reply")} to review: ${names.join(", ")}${pending.length > 5 ? "…" : ""}. ${PORTAL_URL}/admin/replies`);
  }
  for (const m of bouncedToday) {
    const reserves = data.messages.filter((r) => r.firm_id === m.firm_id && r.slot === "reserve").length;
    needs.push(`- Bounce at ${m.fund_name}. ${reserves > 0 ? `${plural(reserves, "reserve contact")} available.` : "No reserve contacts."} ${PORTAL_URL}/admin/clients/${data.clientId}/setup`);
  }

  const lines = [
    `${company}${test ? " (Test Pilot)" : ""} · Week ${data.currentWeek}${data.pausedAt ? " · PAUSED" : ""}`,
    `Today: ${todayStats.sent} sent · ${todayStats.opened} opened · ${plural(todayStats.replies, "reply")} · ${plural(todayStats.bounced, "bounce")}`,
    needs.length ? `Needs you:\n${needs.join("\n")}` : "Needs you: nothing.",
    `Started today: ${startedToday.length} new investor${startedToday.length === 1 ? "" : "s"}${byTier ? ` (${byTier})` : ""}.`,
    `Inbox: ${inbox}.`,
    `So far: ${allTime.sent} sent · ${percent(allTime.sent ? allTime.delivered / allTime.sent : null)} delivered · ${percent(allTime.openRate)} opened · ${plural(allTime.replies, "reply")} · ${plural(allTime.meetings, "meeting")}. ${started} of ${data.activeTotal} investors started${lastFirst && remaining > 0 ? `; first emails done by ${weekLabel(lastFirst.end, lastFirst.end)}` : ""}.`,
    data.pausedAt
      ? "Tomorrow: paused, nothing goes out."
      : `Tomorrow (${weekLabel(tomorrow, tomorrow)}): ${tomorrowNew} new investor${tomorrowNew === 1 ? "" : "s"} plus follow-ups, ${data.settings.from}–${data.settings.to}.`,
    `Analytics: ${PORTAL_URL}/admin/clients/${data.clientId}/view`,
  ];
  return { text: lines.join("\n\n"), sent: todayStats.sent, pending: pending.length, bounces: bouncedToday.length };
}

/**
 * Builds and emails the summary for every live campaign. Skipped on
 * weekends (Eastern) unless `force`, and when nothing is live.
 */
export async function sendDailySummary(
  supabase: ServiceClient,
  { force = false }: { force?: boolean } = {},
): Promise<{ sent: boolean; clients: number; reason?: string; errors: string[]; email?: EmailResult }> {
  const todayEastern = localDate(Date.now(), "America/New_York");
  if (!force && isWeekendDay(todayEastern)) return { sent: false, clients: 0, reason: "weekend", errors: [] };

  const { data: rows, error } = await supabase
    .from("outreach_campaigns")
    .select("client_id, inbox_email")
    .not("live_at", "is", null);
  if (error) return { sent: false, clients: 0, reason: error.message, errors: [error.message] };
  if (!rows || rows.length === 0) return { sent: false, clients: 0, reason: "nothing live", errors: [] };

  const ids = rows.map((r) => String(r.client_id));
  const { data: clients } = await supabase.from("clients").select("id, company_name, is_test_pilot").in("id", ids);
  const byId = new Map((clients ?? []).map((c) => [String(c.id), c]));

  const sections: ClientSummary[] = [];
  const errors: string[] = [];
  for (const row of rows) {
    const id = String(row.client_id);
    const loaded = await loadCampaignData(supabase, id);
    if (!loaded.ok) {
      errors.push(`${id}: ${loaded.error}`);
      continue;
    }
    if (!loaded.value) continue;
    let inbox = row.inbox_email ? String(row.inbox_email) : "not connected";
    if (row.inbox_email && isInstantlyConfigured()) {
      const account = await getAccount(String(row.inbox_email));
      inbox = account.ok ? `${row.inbox_email}, ${inboxStatusText(typeof account.value.status === "number" ? account.value.status : null).toLowerCase()}` : `${row.inbox_email}, couldn't check (${account.error})`;
    }
    const client = byId.get(id);
    sections.push(summarize(loaded.value, String(client?.company_name ?? "Client"), Boolean(client?.is_test_pilot), inbox));
  }
  if (sections.length === 0) return { sent: false, clients: 0, reason: "nothing live", errors };

  const total = (key: "sent" | "pending" | "bounces") => sections.reduce((sum, s) => sum + s[key], 0);
  const subject = `Rupert daily: ${total("sent")} sent · ${plural(total("pending"), "reply")} to review · ${plural(total("bounces"), "bounce")}`;
  const body = [...sections.map((s) => s.text), errors.length ? `Couldn't summarize:\n${errors.join("\n")}` : ""].filter(Boolean).join("\n\n————————\n\n");
  const email = await sendAdminEmail(subject, body);
  return { sent: email.ok, clients: sections.length, errors, email };
}
