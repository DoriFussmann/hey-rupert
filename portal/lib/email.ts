import "server-only";

// Sends plain-text email through Resend's HTTP API. Email is best effort:
// a missing configuration or a delivery failure never blocks the caller.
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

export function isEmailConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY &&
      process.env.EMAIL_FROM &&
      process.env.ADMIN_NOTIFY_EMAIL,
  );
}

export async function sendAdminEmail(subject: string, text: string) {
  if (!isEmailConfigured()) return { ok: false as const, skipped: true };

  const to = process.env
    .ADMIN_NOTIFY_EMAIL!.split(",")
    .map((address) => address.trim())
    .filter(Boolean);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        `Admin email failed (${response.status}): ${await response.text()}`,
      );
      return { ok: false as const, skipped: false };
    }

    return { ok: true as const };
  } catch (err) {
    console.error(
      `Admin email failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false as const, skipped: false };
  }
}
