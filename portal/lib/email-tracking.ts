// Email tracking: which client emails are tracked, what Resend's events mean,
// and how they read in the client's email history. Pure module (no server
// imports): the admin page loads it in the browser too.

/**
 * Emails that are never tracked: agreements, money and access links.
 * Tracking rewrites links and adds a pixel, which doesn't belong in these.
 * Everything else sent to a client is tracked.
 */
const UNTRACKED_KEYS = new Set([
  "client:statement_of_work_ready",
  "client:service_order_ready",
  "client:nda_ready",
  "nudge:sow",
  "nudge:service_order",
  "nudge:nda",
  "viewer_welcome",
  "welcome",
  "password_reset",
]);

export function isTrackedEmail(templateKey: string | null | undefined) {
  return !UNTRACKED_KEYS.has(String(templateKey ?? ""));
}

export type TrackingEventType = "delivered" | "opened" | "clicked" | "bounced" | "complained";

export type TrackingEvent = {
  type: TrackingEventType;
  /** Resend's id for the email: `email_log.resend_id`. */
  emailId: string;
  /** When it happened (ISO). */
  at: string;
  /** The link clicked, for a click. */
  link: string | null;
};

const EVENT_TYPES: Record<string, TrackingEventType> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const isoOrEmpty = (value: unknown) => {
  const raw = text(value);
  if (!raw) return "";
  const time = Date.parse(raw);
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
};

/** A Resend webhook body as a tracking event, or null for anything else (sent, scheduled, contacts…). */
export function parseResendEvent(body: unknown, receivedAt: string): TrackingEvent | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const type = EVENT_TYPES[text(root.type)];
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null;
  const emailId = text(data?.email_id);
  if (!type || !emailId) return null;
  const click = data?.click && typeof data.click === "object" ? (data.click as Record<string, unknown>) : null;
  return {
    type,
    emailId,
    // A click carries its own time; the rest use the event's.
    at: (type === "clicked" ? isoOrEmpty(click?.timestamp) : "") || isoOrEmpty(root.created_at) || receivedAt,
    link: type === "clicked" ? text(click?.link) || null : null,
  };
}

/** What the email history shows for one email. Matches the tracking columns on `email_log`. */
export type TrackingState = {
  delivered_at: string | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  first_clicked_at: string | null;
  click_count: number;
  bounced_at: string | null;
};

export const NO_TRACKING: TrackingState = {
  delivered_at: null,
  first_opened_at: null,
  last_opened_at: null,
  open_count: 0,
  first_clicked_at: null,
  click_count: 0,
  bounced_at: null,
};

/**
 * The state of one email from every event stored for it. Worked out from the
 * whole list each time, so events that arrive late, twice or out of order
 * give the same answer.
 */
export function summarizeEvents(events: Pick<TrackingEvent, "type" | "at">[]): TrackingState {
  const of = (type: TrackingEventType) => events.filter((e) => e.type === type).map((e) => e.at).sort();
  const delivered = of("delivered");
  const opened = of("opened");
  const clicked = of("clicked");
  const bounced = [...of("bounced"), ...of("complained")].sort();
  return {
    delivered_at: delivered[0] ?? null,
    first_opened_at: opened[0] ?? null,
    last_opened_at: opened[opened.length - 1] ?? null,
    open_count: opened.length,
    first_clicked_at: clicked[0] ?? null,
    click_count: clicked.length,
    bounced_at: bounced[0] ?? null,
  };
}

/** The setup step a "ready to review" email points at, by its template key. */
const STEP_BY_KEY: Record<string, string> = {
  "client:framing_ready": "framing",
  "client:investor_list_ready": "investor_list",
  "client:email_copy_ready": "email_copy",
};

export type StepView = { step: string; client_viewed_at: string | null };

/**
 * "Viewed in portal" for the emails that announce a setup step. Only the
 * newest email of each step gets an answer: the view belongs to the version
 * the client has now. A view from before that email doesn't count for it.
 * Returns email id → the time viewed, or null for "not viewed yet".
 */
export function portalViews(
  emails: { id: string; template_key: string | null; status: string; created_at: string }[],
  steps: StepView[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, step] of Object.entries(STEP_BY_KEY)) {
    const row = steps.find((s) => s.step === step);
    if (!row) continue;
    const newest = emails
      .filter((e) => e.template_key === key && e.status === "sent")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!newest) continue;
    const viewed = row.client_viewed_at;
    // The step is published a moment before its email is logged.
    const counts = viewed && Date.parse(viewed) >= Date.parse(newest.created_at) - 60_000;
    out[newest.id] = counts ? viewed : null;
  }
  return out;
}

export type TrackingPart = { text: string; tone: "ok" | "muted" | "error" };

/**
 * The status line under one sent email, as short parts. Empty for an email
 * that isn't tracked and announces no step.
 * `viewedAt`: undefined = this email announces no step; null = not viewed yet.
 */
export function trackingParts(
  entry: { tracked: boolean; tracking: TrackingState },
  viewedAt: string | null | undefined,
  when: (iso: string) => string,
): TrackingPart[] {
  const parts: TrackingPart[] = [];
  const t = entry.tracking;
  if (t.bounced_at) parts.push({ text: `Bounced ${when(t.bounced_at)}`, tone: "error" });
  else if (t.delivered_at) parts.push({ text: "Delivered", tone: "muted" });
  if (entry.tracked) {
    if (t.open_count > 0 && t.last_opened_at) {
      parts.push({ text: `Opened ${t.open_count > 1 ? `${t.open_count}× (last ${when(t.last_opened_at)})` : when(t.last_opened_at)}`, tone: "ok" });
    } else if (!t.bounced_at) {
      parts.push({ text: "Not opened yet", tone: "muted" });
    }
    if (t.click_count > 0 && t.first_clicked_at) parts.push({ text: `Clicked a link ${when(t.first_clicked_at)}`, tone: "ok" });
  }
  if (viewedAt) parts.push({ text: `Viewed in portal ${when(viewedAt)}`, tone: "ok" });
  else if (viewedAt === null) parts.push({ text: "Not viewed in portal yet", tone: "muted" });
  return parts;
}
