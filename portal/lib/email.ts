import "server-only";

// Sends plain-text email through Resend's HTTP API. Email is best effort:
// a missing configuration or a delivery failure never blocks the caller,
// but the result says why, so the admin UI can show it.
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

/** `id` is Resend's id for the email (used to cancel a scheduled one). */
export type EmailResult = { ok: true; id?: string } | { ok: false; reason: string };

export function adminAddresses() {
  return (process.env.ADMIN_NOTIFY_EMAIL ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

function missingConfiguration() {
  const missing = [
    ["RESEND_API_KEY", process.env.RESEND_API_KEY],
    ["EMAIL_FROM", process.env.EMAIL_FROM],
    ["ADMIN_NOTIFY_EMAIL", adminAddresses().length > 0 ? "set" : ""],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return missing.length > 0
    ? `Email is not configured: ${missing.join(", ")} missing.`
    : null;
}

export async function sendEmail({
  to,
  bcc = [],
  subject,
  text,
  html,
  scheduledAt,
}: {
  to: string[];
  /** Blind copies, e.g. a copy to Rupert of an email to a client. */
  bcc?: string[];
  subject: string;
  text: string;
  /** HTML part. The plain-text body is always sent as well. */
  html?: string;
  /** ISO time to deliver it later (Resend allows up to 30 days ahead). */
  scheduledAt?: string;
}): Promise<EmailResult> {
  const notConfigured = missingConfiguration();
  if (notConfigured) return { ok: false, reason: notConfigured };

  const recipients = to.map((address) => address.trim()).filter(Boolean);
  if (recipients.length === 0) {
    return { ok: false, reason: "No recipient email address." };
  }
  const blindCopies = bcc
    .map((address) => address.trim())
    .filter((address) => address && !recipients.includes(address));

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: recipients,
        ...(blindCopies.length > 0 ? { bcc: blindCopies } : {}),
        reply_to: adminAddresses()[0],
        subject,
        text,
        ...(html?.trim() ? { html } : {}),
        ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      const reason = `Resend rejected the email (${response.status}): ${detail}`;
      console.error(reason);
      return { ok: false, reason };
    }

    const sent = (await response.json().catch(() => null)) as { id?: unknown } | null;
    return { ok: true, ...(typeof sent?.id === "string" ? { id: sent.id } : {}) };
  } catch (err) {
    const reason = `Email could not be sent: ${
      err instanceof Error ? err.message : String(err)
    }`;
    console.error(reason);
    return { ok: false, reason };
  }
}

export async function sendAdminEmail(subject: string, text: string) {
  return sendEmail({ to: adminAddresses(), subject, text });
}

/** Cancels an email scheduled with `scheduledAt`. Already sent or unknown: says so. */
export async function cancelScheduledEmail(id: string): Promise<EmailResult> {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY is not configured." };
  try {
    const response = await fetch(`${RESEND_ENDPOINT}/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, reason: `Resend did not cancel the email (${response.status}): ${(await response.text()).slice(0, 300)}` };
    }
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: `Email could not be cancelled: ${err instanceof Error ? err.message : String(err)}` };
  }
}
