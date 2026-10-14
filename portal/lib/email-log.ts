import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { sendEmail, type EmailResult } from "@/lib/email";
import { emailControlsTableError } from "@/lib/email-settings";

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
};

const KINDS: EmailLogKind[] = ["automatic", "reminder", "manual"];

/**
 * Sends an email to a client and records it in the client's email history,
 * whether it was delivered or not. A failed log write never blocks the send.
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
  }: {
    clientId: string;
    kind: EmailLogKind;
    templateKey?: string;
    to: string[];
    bcc?: string[];
    subject: string;
    text: string;
  },
): Promise<EmailResult> {
  const result = await sendEmail({ to, bcc, subject, text });

  const { error } = await supabase.from("email_log").insert({
    client_id: clientId,
    kind,
    template_key: templateKey ?? null,
    recipients: to,
    subject,
    body: text,
    status: result.ok ? "sent" : "failed",
    error: result.ok ? null : result.reason,
  });

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
  const { data, error } = await supabase
    .from("email_log")
    .select("id, kind, template_key, recipients, subject, body, status, error, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);

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
    })),
  };
}
