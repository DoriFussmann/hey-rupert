import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { sendEmail, trackedSender, type EmailResult } from "@/lib/email";
import { plainEmailHtml } from "@/lib/email-html";
import { emailControlsTableError } from "@/lib/email-settings";
import { isTrackedEmail, NO_TRACKING, type TrackingState } from "@/lib/email-tracking";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type EmailLogKind = "automatic" | "reminder" | "manual";

export type EmailLogEntry = {
  id: string;
  kind: EmailLogKind;
  template_key: string | null;
  recipients: string[];
  subject: string;
  body: string;
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
  /** Sent from the tracked sender: opens and clicks are reported for it. */
  tracked: boolean;
  tracking: TrackingState;
};

/** The email_tracking.sql columns are missing: the script has not been run yet. */
function trackingColumnsMissing(message: string, code?: string) {
  return code === "42703" || code === "PGRST204" || /resend_id|tracked|delivered_at|opened_at|open_count|clicked_at|click_count|bounced_at/.test(message);
}

const KINDS: EmailLogKind[] = ["automatic", "reminder", "manual"];
const when = (value: unknown) => (value != null && value !== "" ? String(value) : null);

/**
 * Sends an email to a client and records it in the client's email history,
 * whether it was delivered or not. A failed log write never blocks the send.
 *
 * Client updates are tracked (opens and clicks) once a tracked sender is
 * configured; agreements and access links never are (see isTrackedEmail).
 * A tracked email always carries an HTML part, and Rupert's own copy goes as
 * a separate untracked email, so opening it doesn't count as the client's.
 */
export async function sendClientEmail(
  supabase: ServiceClient,
  {
    clientId,
    kind,
    templateKey,
    to,
    bcc,
    subject,
    text,
    html,
  }: {
    clientId: string;
    kind: EmailLogKind;
    templateKey?: string;
    to: string[];
    bcc?: string[];
    subject: string;
    text: string;
    html?: string;
  },
): Promise<EmailResult> {
  const tracked = Boolean(trackedSender()) && isTrackedEmail(templateKey);
  const copies = (bcc ?? []).filter((address) => address.trim());
  const result = await sendEmail({
    to,
    bcc: tracked ? [] : bcc,
    subject,
    text,
    html: html ?? (tracked ? plainEmailHtml(text) : undefined),
    tracked,
  });
  if (tracked && result.ok && copies.length > 0) {
    const copy = await sendEmail({ to: copies, subject, text, html });
    if (!copy.ok) console.error(`Copy of a client email not sent: ${copy.reason}`);
  }

  const row = {
    client_id: clientId,
    kind,
    template_key: templateKey ?? null,
    recipients: to,
    subject,
    body: text,
    status: result.ok ? "sent" : "failed",
    error: result.ok ? null : result.reason,
  };
  let { error } = await supabase.from("email_log").insert({
    ...row,
    resend_id: result.ok ? result.id ?? null : null,
    tracked: result.ok && result.tracked === true,
  });
  // Before email_tracking.sql is run the new columns don't exist: log it the old way.
  if (error && trackingColumnsMissing(error.message, error.code)) {
    ({ error } = await supabase.from("email_log").insert(row));
  }

  if (error) {
    console.error(`Email log write failed: ${error.message}`);
  }

  return result;
}

export type EmailLogResult =
  | { ok: true; entries: EmailLogEntry[] }
  | { ok: false; error: string };

/** A client's email history, newest first. */
export async function listEmailLog(
  supabase: ServiceClient,
  clientId: string,
  limit = 100,
): Promise<EmailLogResult> {
  const BASE = "id, kind, template_key, recipients, subject, body, status, error, created_at";
  const TRACKING = "tracked, delivered_at, first_opened_at, last_opened_at, open_count, first_clicked_at, click_count, bounced_at";
  const read = (columns: string) =>
    supabase
      .from("email_log")
      .select(columns)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<Record<string, unknown>[]>();
  let { data, error } = await read(`${BASE}, ${TRACKING}`);
  // Before email_tracking.sql is run: the history without tracking.
  if (error && trackingColumnsMissing(error.message, error.code)) ({ data, error } = await read(BASE));

  if (error) {
    return {
      ok: false,
      error: emailControlsTableError(error.message, error.code)
        ? "Email history is not set up yet. Run portal/supabase/email_controls.sql in the Supabase SQL editor."
        : error.message,
    };
  }

  return {
    ok: true,
    entries: (data ?? []).map((row) => ({
      id: String(row.id),
      kind: KINDS.includes(row.kind as EmailLogKind)
        ? (row.kind as EmailLogKind)
        : "automatic",
      template_key: row.template_key != null ? String(row.template_key) : null,
      recipients: Array.isArray(row.recipients)
        ? row.recipients.map((item: unknown) => String(item))
        : [],
      subject: String(row.subject ?? ""),
      body: String(row.body ?? ""),
      status: row.status === "sent" ? "sent" : "failed",
      error: row.error != null ? String(row.error) : null,
      created_at: String(row.created_at),
      tracked: row.tracked === true,
      tracking: {
        delivered_at: when(row.delivered_at),
        first_opened_at: when(row.first_opened_at),
        last_opened_at: when(row.last_opened_at),
        open_count: Number(row.open_count ?? NO_TRACKING.open_count) || 0,
        first_clicked_at: when(row.first_clicked_at),
        click_count: Number(row.click_count ?? NO_TRACKING.click_count) || 0,
        bounced_at: when(row.bounced_at),
      },
    })),
  };
}
