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

/** Voids an unpaid Setup Fee invoice. Best effort: paid invoices stay as they are. */
export async function voidInvoice(invoiceId: string): Promise<StripeResult<object>> {
  const current = await stripe<StripeInvoice>("GET", `/invoices/${invoiceId}`);
  if (!current.ok) return current;
  if (current.value.status !== "open") return { ok: true, value: {} };
  const voided = await stripe<StripeInvoice>("POST", `/invoices/${invoiceId}/void`);
  return voided.ok ? { ok: true, value: {} } : voided;
}
