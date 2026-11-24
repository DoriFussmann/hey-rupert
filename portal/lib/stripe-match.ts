// Matching a paid Stripe invoice to a client (pure; used by the Stripe webhook).
//
// The hosted invoice link is not a reliable key: Stripe's link carries a
// token (account, a one-off key, an expiry) and the link in the invoice.paid
// event need not equal the one copied when the invoice was made. So a paid
// invoice is matched, in order, by:
//   1. its metadata: invoices the portal creates carry client_id and kind
//      ("setup_fee" or "monthly");
//   2. its link, when it does equal the saved one;
//   3. the payer's email, when exactly one client with that email has an
//      unpaid invoice of that kind waiting.

/** The fields of a Stripe `invoice.paid` event the portal uses. */
export type PaidInvoice = {
  id: string;
  hostedInvoiceUrl: string | null;
  customerEmail: string | null;
  amountPaid: number | null;
  currency: string | null;
  number: string | null;
  /** metadata.client_id and metadata.kind, set on invoices the portal creates. */
  clientId: string | null;
  kind: "setup_fee" | "monthly" | null;
};

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
    if (url.protocol !== "https:" || !(host === "stripe.com" || host.endsWith(".stripe.com"))) return null;
    return `${host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function readPaidInvoice(event: unknown): PaidInvoice | null {
  if (!event || typeof event !== "object") return null;
  const record = event as { type?: unknown; data?: { object?: unknown } };
  if (record.type !== "invoice.paid") return null;
  const invoice = record.data?.object;
  if (!invoice || typeof invoice !== "object") return null;
  const fields = invoice as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const id = str(fields.id);
  if (!id) return null;
  const metadata = fields.metadata && typeof fields.metadata === "object" ? (fields.metadata as Record<string, unknown>) : {};
  const kind = str(metadata.kind);
  return {
    id,
    hostedInvoiceUrl: str(fields.hosted_invoice_url),
    customerEmail: str(fields.customer_email),
    amountPaid: typeof fields.amount_paid === "number" ? fields.amount_paid : null,
    currency: str(fields.currency),
    number: str(fields.number),
    clientId: str(metadata.client_id),
    kind: kind === "setup_fee" || kind === "monthly" ? kind : null,
  };
}

/** A client's Go Live invoice (the first monthly invoice), as the webhook sees it. */
export type CampaignInvoiceRow = { client_id: string; email: string | null; invoice_url: string | null; invoice_paid_at: string | null };

/** The campaign whose first monthly invoice this pays, or null. Never a Setup Fee invoice. */
export function matchCampaignInvoice(rows: CampaignInvoiceRow[], invoice: PaidInvoice): CampaignInvoiceRow | null {
  if (invoice.kind === "setup_fee") return null;
  if (invoice.kind === "monthly" && invoice.clientId) {
    return rows.find((row) => row.client_id === invoice.clientId) ?? null;
  }
  const target = normalizeInvoiceUrl(invoice.hostedInvoiceUrl);
  if (target) {
    const byLink = rows.find((row) => normalizeInvoiceUrl(row.invoice_url) === target);
    if (byLink) return byLink;
  }
  return byPayer(rows.filter((row) => row.invoice_url && !row.invoice_paid_at), invoice);
}

/** A client's Setup Fee invoice, as the webhook sees it. */
export type SetupFeeRow = { id: string; email: string | null; setup_invoice_url: string | null; payment_received_at: string | null };

/** The client whose Setup Fee this pays, or null. Never a monthly invoice. */
export function matchSetupFee(rows: SetupFeeRow[], invoice: PaidInvoice): SetupFeeRow | null {
  if (invoice.kind === "monthly") return null;
  if (invoice.kind === "setup_fee" && invoice.clientId) {
    return rows.find((row) => row.id === invoice.clientId) ?? null;
  }
  const target = normalizeInvoiceUrl(invoice.hostedInvoiceUrl);
  if (target) {
    const byLink = rows.find((row) => normalizeInvoiceUrl(row.setup_invoice_url) === target);
    if (byLink) return byLink;
  }
  return byPayer(rows.filter((row) => !row.payment_received_at), invoice);
}

function byPayer<T extends { email: string | null }>(waiting: T[], invoice: PaidInvoice): T | null {
  const payer = invoice.customerEmail?.trim().toLowerCase();
  if (!payer) return null;
  const same = waiting.filter((row) => (row.email ?? "").trim().toLowerCase() === payer);
  return same.length === 1 ? same[0] : null;
}
