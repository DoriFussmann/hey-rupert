import "server-only";

// Minimal Stripe REST client (no SDK) for the Setup Fee invoice. Requests are
// form-encoded, as the Stripe API expects. The API version is the account's
// default.
const API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 20_000;

/** Setup Fee in cents. Matches SETUP_FEE_LABEL in lib/service-order.ts. */
export const SETUP_FEE_CENTS = 25_000;
const SETUP_FEE_CURRENCY = "usd";
/** Stripe requires a due date for invoices that are paid by link. */
const DAYS_UNTIL_DUE = 7;

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

type StripeResult<T> = { ok: true; value: T } | { ok: false; error: string };

type StripeInvoice = {
  id: string;
  status: string | null;
  hosted_invoice_url: string | null;
};

async function stripe<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string> = {},
  idempotencyKey?: string,
): Promise<StripeResult<T>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "STRIPE_SECRET_KEY is not configured." };

  const body = new URLSearchParams(params).toString();
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(method === "POST"
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: method === "POST" ? body : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as
      | (T & { error?: { message?: string } })
      | null;
    if (!response.ok || !data) {
      const message = data?.error?.message ?? `HTTP ${response.status}`;
      return { ok: false, error: `Stripe: ${message}` };
    }
    return { ok: true, value: data };
  } catch (err) {
    return {
      ok: false,
      error: `Stripe request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function findOrCreateCustomer(input: {
  clientId: string;
  email: string;
  name: string;
}): Promise<StripeResult<string>> {
  const found = await stripe<{ data: { id: string }[] }>("GET", "/customers", {
    email: input.email,
    limit: "1",
  });
  if (!found.ok) return found;
  if (found.value.data[0]) return { ok: true, value: found.value.data[0].id };

  const created = await stripe<{ id: string }>(
    "POST",
    "/customers",
    {
      email: input.email,
      name: input.name,
      "metadata[client_id]": input.clientId,
    },
    `customer-${input.clientId}`,
  );
  return created.ok ? { ok: true, value: created.value.id } : created;
}

/**
 * Creates and finalizes the Setup Fee invoice and returns its hosted link
 * (the page where the client pays). Stripe does not email it: the portal
 * shows the link. `attempt` makes each issue (after an archive) distinct.
 */
export async function createSetupFeeInvoice(input: {
  clientId: string;
  email: string;
  name: string;
  attempt: string;
}): Promise<StripeResult<{ id: string; url: string }>> {
  const customer = await findOrCreateCustomer(input);
  if (!customer.ok) return customer;

  const key = `setup-fee-${input.clientId}-${input.attempt}`;
  const invoice = await stripe<StripeInvoice>(
    "POST",
    "/invoices",
    {
      customer: customer.value,
      collection_method: "send_invoice",
      days_until_due: String(DAYS_UNTIL_DUE),
      auto_advance: "false",
      pending_invoice_items_behavior: "exclude",
      description: "Hey Rupert: Setup Fee",
      "metadata[client_id]": input.clientId,
      "metadata[kind]": "setup_fee",
    },
    `${key}-invoice`,
  );
  if (!invoice.ok) return invoice;

  const item = await stripe<{ id: string }>(
    "POST",
    "/invoiceitems",
    {
      customer: customer.value,
      invoice: invoice.value.id,
      amount: String(SETUP_FEE_CENTS),
      currency: SETUP_FEE_CURRENCY,
      description: "Setup Fee (one-time)",
    },
    `${key}-item`,
  );
  if (!item.ok) return item;

  const finalized = await stripe<StripeInvoice>(
    "POST",
    `/invoices/${invoice.value.id}/finalize`,
    {},
    `${key}-finalize`,
  );
  if (!finalized.ok) return finalized;
  if (!finalized.value.hosted_invoice_url) {
    return { ok: false, error: "Stripe did not return a payment link for the invoice." };
  }
  return {
    ok: true,
    value: { id: finalized.value.id, url: finalized.value.hosted_invoice_url },
  };
}

type StripeInvoiceDetail = StripeInvoice & {
  amount_due: number;
  currency: string;
  customer_email: string | null;
  number: string | null;
};

function sameInvoiceUrl(a: string, b: string) {
  const clean = (v: string) => v.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  return clean(a) === clean(b);
}

/**
 * Finds the invoice behind a hosted invoice link (Stripe has no direct
 * lookup by URL), searching open then draft/paid invoices, newest first.
 */
export async function findInvoiceByHostedUrl(
  url: string,
): Promise<StripeResult<StripeInvoiceDetail>> {
  for (const status of ["open", "paid"]) {
    const list = await stripe<{ data: StripeInvoiceDetail[] }>("GET", "/invoices", {
      status,
      limit: "100",
    });
    if (!list.ok) return list;
    const hit = list.value.data.find(
      (inv) => inv.hosted_invoice_url && sameInvoiceUrl(inv.hosted_invoice_url, url),
    );
    if (hit) return { ok: true, value: hit };
  }
  return { ok: false, error: "No open or paid Stripe invoice matches this link." };
}

/** Voids an unpaid Setup Fee invoice. Best effort: paid invoices stay as they are. */
export async function voidInvoice(invoiceId: string): Promise<StripeResult<object>> {
  const current = await stripe<StripeInvoice>("GET", `/invoices/${invoiceId}`);
  if (!current.ok) return current;
  if (current.value.status !== "open") return { ok: true, value: {} };
  const voided = await stripe<StripeInvoice>("POST", `/invoices/${invoiceId}/void`);
  return voided.ok ? { ok: true, value: {} } : voided;
}

/** A price from the Stripe product catalog, for the admin's invoice picker. */
export type InvoicePrice = {
  priceId: string;
  product: string;
  amount: number;
  currency: string;
  /** "month", "year" … for recurring prices; null for one-time. */
  interval: string | null;
};

type StripePrice = {
  id: string;
  active: boolean;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string } | null;
  product: { id: string; name: string; active: boolean; deleted?: boolean } | string;
};

/** Active prices with a fixed amount, of active products, by product name. */
export async function listInvoicePrices(): Promise<StripeResult<InvoicePrice[]>> {
  const list = await stripe<{ data: StripePrice[] }>("GET", "/prices", {
    active: "true",
    limit: "100",
    "expand[]": "data.product",
  });
  if (!list.ok) return list;
  const prices = list.value.data
    .filter((p) => p.unit_amount != null && typeof p.product === "object" && p.product.active && !p.product.deleted)
    .map((p) => ({
      priceId: p.id,
      product: (p.product as { name: string }).name,
      amount: p.unit_amount as number,
      currency: p.currency,
      interval: p.recurring?.interval ?? null,
    }))
    .sort((a, b) => a.product.localeCompare(b.product) || a.amount - b.amount);
  return { ok: true, value: prices };
}

/**
 * Creates and finalizes a one-off invoice for the client with one line: the
 * chosen catalog price (its product name and amount; a recurring price is
 * billed once, as this month's fee). Stripe does not email it; the portal
 * shows the link. Returns the hosted link.
 */
export async function createPriceInvoice(input: {
  clientId: string;
  email: string;
  name: string;
  priceId: string;
  /** "setup_fee" or "monthly", kept on the invoice's metadata. */
  kind: string;
  /** One per click, so a retry of the same click never bills twice. */
  attempt: string;
}): Promise<StripeResult<{ id: string; url: string; amount: number; currency: string; product: string }>> {
  const price = await stripe<StripePrice>("GET", `/prices/${encodeURIComponent(input.priceId)}`, { "expand[]": "product" });
  if (!price.ok) return price;
  const product = typeof price.value.product === "object" ? price.value.product.name : "Hey Rupert";
  if (!price.value.active || price.value.unit_amount == null) return { ok: false, error: "That Stripe price is inactive or has no fixed amount." };

  const customer = await findOrCreateCustomer(input);
  if (!customer.ok) return customer;

  const key = `${input.kind}-${input.clientId}-${input.attempt}`;
  const invoice = await stripe<StripeInvoice>(
    "POST",
    "/invoices",
    {
      customer: customer.value,
      collection_method: "send_invoice",
      days_until_due: String(DAYS_UNTIL_DUE),
      auto_advance: "false",
      pending_invoice_items_behavior: "exclude",
      description: `Hey Rupert: ${product}`,
      "metadata[client_id]": input.clientId,
      "metadata[kind]": input.kind,
      "metadata[price_id]": input.priceId,
    },
    `${key}-invoice`,
  );
  if (!invoice.ok) return invoice;

  const item = await stripe<{ id: string }>(
    "POST",
    "/invoiceitems",
    {
      customer: customer.value,
      invoice: invoice.value.id,
      amount: String(price.value.unit_amount),
      currency: price.value.currency,
      description: product,
    },
    `${key}-item`,
  );
  if (!item.ok) return item;

  const finalized = await stripe<StripeInvoice>("POST", `/invoices/${invoice.value.id}/finalize`, {}, `${key}-finalize`);
  if (!finalized.ok) return finalized;
  if (!finalized.value.hosted_invoice_url) return { ok: false, error: "Stripe did not return a payment link for the invoice." };
  return {
    ok: true,
    value: { id: finalized.value.id, url: finalized.value.hosted_invoice_url, amount: price.value.unit_amount, currency: price.value.currency, product },
  };
}
