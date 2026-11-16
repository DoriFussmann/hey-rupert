// Resend webhook signature check. Node only (the route), kept apart from
// ./email-tracking.ts, which the admin page also loads in the browser.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Deliveries older (or newer) than this are refused, so a captured one can't be replayed later. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Resend signs through Svix: base64 HMAC-SHA256 of "<id>.<timestamp>.<raw body>",
 * keyed with the signing secret ("whsec_" + base64). The svix-signature header
 * holds one or more "v1,<signature>" entries separated by spaces; any match passes.
 */
export function resendSignatureValid(
  secret: string,
  rawBody: string,
  headers: { id: string | null | undefined; timestamp: string | null | undefined; signature: string | null | undefined },
  nowMs: number = Date.now(),
) {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(nowMs / 1000 - seconds) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`, "utf8").digest();

  return signature
    .split(/\s+/)
    .filter(Boolean)
    .some((entry) => {
      const [version, value] = entry.split(",");
      if (version !== "v1" || !value) return false;
      const given = Buffer.from(value, "base64");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}
