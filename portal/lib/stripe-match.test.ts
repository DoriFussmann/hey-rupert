import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCampaignInvoice, matchSetupFee, readPaidInvoice, type CampaignInvoiceRow, type SetupFeeRow } from "./stripe-match.ts";

const SAVED = "https://invoice.stripe.com/i/acct_1QaHrfDSvhWDJJPI/live_YWNjdF8xUWFIcmZEU3ZoV0RKSlBJLF9WZ1VIV3RlZnEzZHdPWVM5VFo3aGZHOEEwaUYxd001LDE4NjAyMDIzMw0200JfCrnwrF?s=db";
// The same invoice, as the invoice.paid event links it: a different token.
const IN_EVENT = "https://invoice.stripe.com/i/acct_1QaHrfDSvhWDJJPI/live_YWNjdF8xUWFIcmZEU3ZoV0RKSlBJLF9WZ1VIV3RlZnEzZHdPWVM5VFo3aGZHOEEwaUYxd001LDE4NjAyMTEyMg0200XyZ";

function event(object: Record<string, unknown>) {
  return { type: "invoice.paid", data: { object: { id: "in_1", amount_paid: 100, currency: "usd", ...object } } };
}

const campaigns: CampaignInvoiceRow[] = [
  { client_id: "brindlewood", email: "team@heyrupert.com", invoice_url: SAVED, invoice_paid_at: null },
  { client_id: "argentl", email: "nabil@argentl.com", invoice_url: null, invoice_paid_at: null },
];

test("reads the portal's metadata from invoice.paid", () => {
  const paid = readPaidInvoice(event({ hosted_invoice_url: IN_EVENT, customer_email: "team@heyrupert.com", metadata: { client_id: "brindlewood", kind: "monthly" } }));
  assert.equal(paid?.clientId, "brindlewood");
  assert.equal(paid?.kind, "monthly");
  assert.equal(readPaidInvoice(event({ metadata: { kind: "other" } }))?.kind, null);
  assert.equal(readPaidInvoice({ type: "invoice.created", data: { object: { id: "in_1" } } }), null);
});

test("the Brindlewood case: the event's link differs from the saved one, the metadata still matches it", () => {
  const paid = readPaidInvoice(event({ hosted_invoice_url: IN_EVENT, customer_email: "team@heyrupert.com", metadata: { client_id: "brindlewood", kind: "monthly" } }))!;
  assert.equal(matchCampaignInvoice(campaigns, paid)?.client_id, "brindlewood");
});

test("an invoice made by hand in Stripe (no metadata): matched by the payer's email when only one client waits", () => {
  const paid = readPaidInvoice(event({ hosted_invoice_url: IN_EVENT, customer_email: "Team@HeyRupert.com" }))!;
  assert.equal(matchCampaignInvoice(campaigns, paid)?.client_id, "brindlewood");
  const twoWaiting = [...campaigns, { client_id: "other", email: "team@heyrupert.com", invoice_url: SAVED, invoice_paid_at: null }];
  assert.equal(matchCampaignInvoice(twoWaiting, paid), null, "two clients with that email: no guess");
  const noneWaiting = [{ ...campaigns[0], invoice_paid_at: "2026-11-23T00:00:00Z" }];
  assert.equal(matchCampaignInvoice(noneWaiting, paid), null);
});

test("a matching link still matches", () => {
  const paid = readPaidInvoice(event({ hosted_invoice_url: SAVED.replace("?s=db", ""), customer_email: "someone@else.com" }))!;
  assert.equal(matchCampaignInvoice(campaigns, paid)?.client_id, "brindlewood");
});

const clients: SetupFeeRow[] = [
  { id: "brindlewood", email: "team@heyrupert.com", setup_invoice_url: "https://invoice.stripe.com/i/acct_x/live_old", payment_received_at: null },
];

test("a Setup Fee invoice never marks the Go Live invoice paid, and the reverse", () => {
  const setup = readPaidInvoice(event({ customer_email: "team@heyrupert.com", metadata: { client_id: "brindlewood", kind: "setup_fee" } }))!;
  assert.equal(matchCampaignInvoice(campaigns, setup), null);
  assert.equal(matchSetupFee(clients, setup)?.id, "brindlewood");
  const monthly = readPaidInvoice(event({ customer_email: "team@heyrupert.com", metadata: { client_id: "brindlewood", kind: "monthly" } }))!;
  assert.equal(matchSetupFee(clients, monthly), null);
});

test("Setup Fee without metadata: by link, else by the payer's email (unpaid only)", () => {
  const byEmail = readPaidInvoice(event({ customer_email: "team@heyrupert.com", hosted_invoice_url: "https://invoice.stripe.com/i/acct_x/live_new" }))!;
  assert.equal(matchSetupFee(clients, byEmail)?.id, "brindlewood");
  assert.equal(matchSetupFee([{ ...clients[0], payment_received_at: "x" }], byEmail), null);
});
