"use client";

import { useState } from "react";
import { createStripeInvoiceAction, listStripePricesAction } from "@/app/admin/actions";
import type { InvoicePrice } from "@/lib/stripe";

const linkButton = "text-body-sm normal-case tracking-normal text-primary hover:text-primary-hover disabled:opacity-40";
const smallButton =
  "rounded-md bg-primary px-sm py-xs text-body-sm normal-case tracking-normal text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";

function money(price: InvoicePrice) {
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency.toUpperCase() }).format(price.amount / 100);
  return price.interval ? `${amount} / ${price.interval}` : amount;
}

/** The price to suggest first: the product whose name fits the invoice. */
function suggested(prices: InvoicePrice[], kind: "setup_fee" | "monthly") {
  const fits = kind === "monthly" ? /month|retainer|management|subscription/i : /setup|onboard/i;
  return (prices.find((p) => fits.test(p.product)) ?? prices[0])?.priceId ?? "";
}

/**
 * Create a Stripe invoice for the client from a catalog product, without
 * leaving the portal. The new invoice's link is handed back to fill the
 * field next to it.
 */
export function StripeInvoicePicker({
  clientId,
  kind,
  disabled = false,
  onCreated,
}: {
  clientId: string;
  kind: "setup_fee" | "monthly";
  disabled?: boolean;
  onCreated: (url: string) => void;
}) {
  const [prices, setPrices] = useState<InvoicePrice[] | null>(null);
  const [priceId, setPriceId] = useState("");
  const [busy, setBusy] = useState<"load" | "create" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function open() {
    setBusy("load");
    setMessage(null);
    try {
      const result = await listStripePricesAction();
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setPrices(result.prices);
      setPriceId(suggested(result.prices, kind));
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Couldn't load the Stripe products." });
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const price = prices?.find((p) => p.priceId === priceId);
    if (!price) return;
    if (!window.confirm(`Create and finalize a Stripe invoice for ${price.product} (${money(price)})? The client pays it through the link.`)) return;
    setBusy("create");
    setMessage(null);
    try {
      const result = await createStripeInvoiceAction(clientId, priceId, kind, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      onCreated(result.url);
      setPrices(null);
      setMessage({ kind: "ok", text: `Invoice created: ${result.label}. The link is filled in.` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "The invoice wasn't created." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="mt-xs block normal-case tracking-normal">
      {prices ? (
        <span className="flex flex-wrap items-center gap-sm">
          <select
            aria-label="Stripe product"
            className="rounded-md border border-border bg-background px-sm py-xs text-body-sm text-body outline-none focus:border-primary"
            value={priceId}
            onChange={(e) => setPriceId(e.target.value)}
            disabled={busy !== null}
          >
            {prices.map((p) => (
              <option key={p.priceId} value={p.priceId}>
                {p.product} · {money(p)}
              </option>
            ))}
          </select>
          <button type="button" className={smallButton} disabled={busy !== null || !priceId} onClick={() => void create()}>
            {busy === "create" ? "Creating…" : "Create Invoice"}
          </button>
          <button type="button" className={linkButton} disabled={busy !== null} onClick={() => setPrices(null)}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" className={linkButton} disabled={disabled || busy !== null} onClick={() => void open()}>
          {busy === "load" ? "Loading Stripe Products…" : "Create the Invoice in Stripe from Here"}
        </button>
      )}
      {message ? (
        <span role={message.kind === "error" ? "alert" : "status"} className={`mt-xs block text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
