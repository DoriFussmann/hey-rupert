import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Verifies Stripe's webhook signature without the Stripe SDK.
// Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 using the endpoint's
// signing secret and sends `Stripe-Signature: t=<timestamp>,v1=<hex>[,v1=…]`.
const TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!header) return false;

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((piece) => piece?.trim());
    if (key === "t" && value) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }

  if (
    timestamp === null ||
    !Number.isFinite(timestamp) ||
    signatures.length === 0 ||
    Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS
  ) {
    return false;
  }

  const expected = Buffer.from(
    createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex"),
    "utf8",
  );

  return signatures.some((signature) => {
    const candidate = Buffer.from(signature, "utf8");
    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  });
}

export {
  normalizeInvoiceUrl,
  readPaidInvoice,
  type PaidInvoice,
} from "./stripe-match.ts";
