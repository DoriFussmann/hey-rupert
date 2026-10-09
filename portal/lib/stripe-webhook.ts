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

/**
 * Normalizes a Stripe hosted invoice link for comparison: host lowercased,
 * query string, fragment and trailing slash removed. Returns null for
 * anything that is not an https stripe.com link.
 */
export function normalizeInvoiceUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !(host === "stripe.com" || host.endsWith(".stripe.com"))
    ) {
      return null;
    }
    return `${host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** The fields of a Stripe `invoice.paid` event the portal uses. */
export type PaidInvoice = {
  id: string;
  hostedInvoiceUrl: string | null;
  customerEmail: string | null;
  amountPaid: number | null;
  currency: string | null;
  number: string | null;
};

export function readPaidInvoice(event: unknown): PaidInvoice | null {
  if (!event || typeof event !== "object") return null;
  const record = event as { type?: unknown; data?: { object?: unknown } };
  if (record.type !== "invoice.paid") return null;

  const invoice = record.data?.object;
  if (!invoice || typeof invoice !== "object") return null;
  const fields = invoice as Record<string, unknown>;
  const str = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  const id = str(fields.id);
  if (!id) return null;

  return {
    id,
    hostedInvoiceUrl: str(fields.hosted_invoice_url),
    customerEmail: str(fields.customer_email),
    amountPaid:
      typeof fields.amount_paid === "number" ? fields.amount_paid : null,
    currency: str(fields.currency),
    number: str(fields.number),
  };
}
