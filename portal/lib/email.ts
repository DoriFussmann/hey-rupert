import "server-only";

// Sends plain-text email through Resend's HTTP API. Email is best effort:
// a missing configuration or a delivery failure never blocks the caller,
// but the result says why, so the admin UI can show it.
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

export type EmailResult = { ok: true } | { ok: false; reason: string };

function adminAddresses() {
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
  subject,
  text,
}: {
  to: string[];
  subject: string;
  text: string;
}): Promise<EmailResult> {
  const notConfigured = missingConfiguration();
  if (notConfigured) return { ok: false, reason: notConfigured };

  const recipients = to.map((address) => address.trim()).filter(Boolean);
  if (recipients.length === 0) {
    return { ok: false, reason: "No recipient email address." };
  }

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
        reply_to: adminAddresses()[0],
        subject,
        text,
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

    return { ok: true };
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
