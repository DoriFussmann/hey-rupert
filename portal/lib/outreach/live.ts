// Going live: the Instantly campaign, the leads, the gates before Go Live,
// delivery events and reply triage. Pure module, safe on the server and in
// the browser. See claude/rupert-outreach-spec.md in the project.

import type { CopyEmail } from "../setup.ts";
import { optOutFor } from "./copy.ts";
import { isApproved, type CoreMessage } from "./core.ts";
import { waveOf } from "./campaign.ts";

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
  /** Days after Go Live before each fund's second contact starts. */
  wave2_delay_days: number;
  track_opens: boolean;
};

export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  daily_limit: 30,
  timezone: "America/Chicago",
  from: "09:00",
  to: "17:00",
  followup_days: [4, 5],
  wave2_delay_days: 3,
  track_opens: true,
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
  const tz = typeof raw.timezone === "string" && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(raw.timezone) ? raw.timezone : d.timezone;
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
  };
}

// ---------------------------------------------------------------------------
// The Instantly campaign: three steps whose subject and body are per-lead variables

/**
 * Follow-ups are always sent as replies in the same thread (blank subject),
 * so a follow-up subject written in the copy is not used.
 */
export function campaignBody(name: string, inbox: string, settings: LiveSettings, options: { test?: boolean } = {}) {
  const days = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((key) => [key, options.test ? true : key >= "1" && key <= "5"]));
  const delayUnit = options.test ? "minutes" : "days";
  const delays = options.test ? [2, 2] : settings.followup_days;
  return {
    name: name.slice(0, 200),
    campaign_schedule: {
      schedules: [
        {
          name: options.test ? "Test" : "Weekdays",
          timing: options.test ? { from: "00:00", to: "23:59" } : { from: settings.from, to: settings.to },
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
    stop_for_company: true,
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
