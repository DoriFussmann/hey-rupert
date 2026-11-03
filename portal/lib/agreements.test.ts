import assert from "node:assert/strict";
import { test } from "node:test";
import { agreementRows, agreementsMeta, type AgreementInput } from "./agreements.ts";

const none: AgreementInput = {
  sowIssued: false,
  sowConfirmedAt: null,
  serviceOrderIssued: false,
  serviceOrderSignedAt: null,
  signerName: null,
  setupInvoiceUrl: null,
  setupPaidAt: null,
  monthlyInvoiceUrl: null,
  monthlyPaidAt: null,
};

test("nothing issued: no rows, a waiting line", () => {
  const rows = agreementRows(none);
  assert.equal(rows.length, 0);
  assert.match(agreementsMeta(rows), /Appears once/);
});

test("issued but not acted on: pending rows at each level", () => {
  const rows = agreementRows({ ...none, sowIssued: true, serviceOrderIssued: true, setupInvoiceUrl: "https://invoice.stripe.com/i/x" });
  assert.deepEqual(rows.map((row) => [row.id, row.level, row.status, row.label]), [
    ["sow", "Confirmation", "pending", "Awaiting your confirmation"],
    ["service_order", "Signature", "pending", "Awaiting your signature"],
    ["setup_invoice", "Payment", "pending", "Awaiting payment"],
  ]);
  assert.equal(rows[2].external, true);
  assert.equal(agreementsMeta(rows), "0 of 3 complete");
});

test("everything done, including the first monthly invoice", () => {
  const rows = agreementRows({
    sowIssued: true,
    sowConfirmedAt: "2026-10-01T10:00:00Z",
    serviceOrderIssued: true,
    serviceOrderSignedAt: "2026-10-02T10:00:00Z",
    signerName: " Dana Founder ",
    setupInvoiceUrl: "https://invoice.stripe.com/i/a",
    setupPaidAt: "2026-10-03T10:00:00Z",
    monthlyInvoiceUrl: "https://invoice.stripe.com/i/b",
    monthlyPaidAt: "2026-10-20T10:00:00Z",
  });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.status === "done"));
  assert.equal(rows[1].by, "Dana Founder");
  assert.equal(agreementsMeta(rows), "All confirmed, signed and paid.");
});

test("a paid invoice without a link still shows, with no link", () => {
  const rows = agreementRows({ ...none, setupPaidAt: "2026-10-03T10:00:00Z" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].href, null);
  assert.equal(rows[0].external, false);
});
