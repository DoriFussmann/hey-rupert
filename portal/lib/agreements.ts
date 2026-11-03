/**
 * "Your Agreements" on What Rupert Knows: the founder's record of what they
 * confirmed, signed and paid. Pure, so it can be tested without Supabase.
 *
 * Levels: the Statement of Work is confirmed, the Service Order is signed,
 * an invoice is paid. Rows only appear once Rupert has issued the document.
 */

export type AgreementStatus = "done" | "pending";

export type AgreementRow = {
  id: "sow" | "service_order" | "setup_invoice" | "monthly_invoice";
  title: string;
  /** What the level is: Confirmation, Signature or Payment. */
  level: string;
  status: AgreementStatus;
  /** Short status label, e.g. "Confirmed" or "Awaiting your signature". */
  label: string;
  /** ISO time the level was reached, when done. */
  at: string | null;
  /** Who signed, for the Service Order. */
  by: string | null;
  href: string | null;
  external: boolean;
};

export type AgreementInput = {
  sowIssued: boolean;
  sowConfirmedAt: string | null;
  serviceOrderIssued: boolean;
  serviceOrderSignedAt: string | null;
  signerName: string | null;
  setupInvoiceUrl: string | null;
  setupPaidAt: string | null;
  monthlyInvoiceUrl: string | null;
  monthlyPaidAt: string | null;
};

const clean = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

export function agreementRows(input: AgreementInput): AgreementRow[] {
  const rows: AgreementRow[] = [];
  const sowAt = clean(input.sowConfirmedAt);
  if (input.sowIssued || sowAt) {
    rows.push({
      id: "sow",
      title: "Statement of Work",
      level: "Confirmation",
      status: sowAt ? "done" : "pending",
      label: sowAt ? "Confirmed" : "Awaiting your confirmation",
      at: sowAt,
      by: null,
      href: "/portal/statement-of-work",
      external: false,
    });
  }

  const signedAt = clean(input.serviceOrderSignedAt);
  if (input.serviceOrderIssued || signedAt) {
    rows.push({
      id: "service_order",
      title: "Service Order",
      level: "Signature",
      status: signedAt ? "done" : "pending",
      label: signedAt ? "Signed" : "Awaiting your signature",
      at: signedAt,
      by: signedAt ? clean(input.signerName) : null,
      href: "/portal/service-order",
      external: false,
    });
  }

  const invoices: Array<[AgreementRow["id"], string, string | null, string | null]> = [
    ["setup_invoice", "Setup Fee Invoice", clean(input.setupInvoiceUrl), clean(input.setupPaidAt)],
    ["monthly_invoice", "First Monthly Invoice", clean(input.monthlyInvoiceUrl), clean(input.monthlyPaidAt)],
  ];
  for (const [id, title, url, paidAt] of invoices) {
    if (!url && !paidAt) continue;
    rows.push({
      id,
      title,
      level: "Payment",
      status: paidAt ? "done" : "pending",
      label: paidAt ? "Paid" : "Awaiting payment",
      at: paidAt,
      by: null,
      href: url,
      external: Boolean(url),
    });
  }

  return rows;
}

/** One line under the panel title, e.g. "2 of 3 complete". */
export function agreementsMeta(rows: AgreementRow[]) {
  if (rows.length === 0) return "Appears once Rupert issues your Statement of Work.";
  const done = rows.filter((row) => row.status === "done").length;
  return done === rows.length ? "All confirmed, signed and paid." : `${done} of ${rows.length} complete`;
}
