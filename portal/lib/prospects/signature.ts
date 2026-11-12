// Cal.com webhook signature check. Node only (the route), kept apart from
// ./core.ts, which the prospect page also loads in the browser.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Cal.com signs the raw body: lowercase hex HMAC-SHA256 in x-cal-signature-256. */
export function calSignatureValid(secret: string, rawBody: string, given: string | null | undefined) {
  if (!secret || !given) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
