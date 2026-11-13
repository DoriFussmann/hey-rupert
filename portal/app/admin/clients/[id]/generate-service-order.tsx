"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  archiveServiceOrder,
  generateServiceOrder,
  previewServiceOrderSend,
  sendServiceOrder,
  type ServiceOrderPreview,
} from "@/app/admin/actions";
import { Disclosure } from "@/components/disclosure";
import { MarkdownBody } from "@/components/markdown-body";
import { formatDate, formatDateAtTime } from "@/lib/format";
import {
  STRIPE_INVOICE_LINK_ERROR,
  feeCents,
  setupFeeLabel,
  isStripeInvoiceLink,
  mergeServiceOrder,
} from "@/lib/service-order";
import type { ServiceOrderSend } from "@/lib/types";

const inputClass =
  "mt-sm w-full rounded-md border bg-background px-sm py-sm text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary";
const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

function sendStatus(send: ServiceOrderSend) {
  if (send.archived_at) return send.signature ? "Void (was signed)" : "Archived";
  if (send.signature) return `Signed ${formatDate(send.signature.signed_at)}`;
  return "Awaiting signature";
}

export function GenerateServiceOrder({
  clientId,
  sends,
  paymentReceivedAt,
  testPilot,
}: {
  clientId: string;
  sends: ServiceOrderSend[];
  paymentReceivedAt: string | null;
  /** Test pilot clients have no Setup Fee invoice. */
  testPilot: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [linkTouched, setLinkTouched] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");
  const [source, setSource] = useState<"client" | "template" | null>(null);
  const [preview, setPreview] = useState<ServiceOrderPreview | null>(null);
  const [overrideMismatch, setOverrideMismatch] = useState(false);

  const activeSend = sends.find((send) => !send.archived_at) ?? null;
  const hasDraft = Boolean(draft.trim());
  // Test pilots have no invoice. Everyone else needs a hosted invoice link.
  const linkValid = testPilot
    ? true
    : isStripeInvoiceLink(paymentLink);
  const canReview = hasDraft && linkValid && !activeSend && pending === null;
  const mismatches = preview ? previewMismatches(preview, testPilot) : [];
  const canSend =
    canReview && preview !== null && (mismatches.length === 0 || overrideMismatch);
  const archivedCount = sends.filter((send) => send.archived_at).length;

  const status = hasDraft
    ? linkValid
      ? "Ready to send"
      : "Add invoice link"
    : activeSend
      ? sendStatus(activeSend)
      : "Not generated";

  const visibleSends = useMemo(
    () =>
      sends.filter((send) =>
        view === "archived" ? Boolean(send.archived_at) : !send.archived_at,
      ),
    [sends, view],
  );

  const tabClass = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active
        ? "bg-primary text-white"
        : "border border-border bg-surface text-secondary hover:text-heading"
    }`;

  async function onGenerate() {
    setPending("generate");
    setError(null);
    setSuccess(null);

    try {
      const result = await generateServiceOrder(clientId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.content) {
        setError("Unable to generate.");
        return;
      }
      setDraft(result.content);
      setSource(result.source ?? "template");
      setPreview(null);
      const from =
        result.source === "client"
          ? "Loaded this client's own Service Order (custom terms)."
          : "Generated from the Forms Service Order template.";
      setSuccess(
        testPilot
          ? `${from} Test pilot: no invoice is needed. Review, then push.`
          : `${from} Add the Stripe invoice link, review, then push.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate.");
    } finally {
      setPending(null);
    }
  }

  async function onReview() {
    setLinkTouched(true);
    if (!canReview) return;
    setPending("review");
    setError(null);
    setSuccess(null);
    setOverrideMismatch(false);
    try {
      const result = await previewServiceOrderSend(clientId, draft, paymentLink);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.preview ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to build the preview.");
    } finally {
      setPending(null);
    }
  }

  async function onSend() {
    setLinkTouched(true);
    if (!canSend) return;
    setPending("send");
    setError(null);
    setSuccess(null);

    try {
      const result = await sendServiceOrder(clientId, draft, paymentLink);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const pushed = testPilot
        ? "Service Order pushed to the client portal."
        : "Service Order and Setup Fee invoice pushed to the client portal.";
      if (result.clientEmail.ok) {
        setSuccess(`${pushed.slice(0, -1)}, and the client was emailed.`);
      } else {
        setSuccess(pushed);
        if (!testPilot) setError(`The client was not emailed. ${result.clientEmail.reason}`);
      }
      setDraft("");
      setPaymentLink("");
      setLinkTouched(false);
      setPreview(null);
      setSource(null);
      setView("active");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send.");
    } finally {
      setPending(null);
    }
  }

  async function onArchive(send: ServiceOrderSend) {
    const message = send.signature
      ? "This Service Order is signed. Archiving voids it: the signature is removed from the client's portal and they will need to sign a new one. The stage and payment status are not changed. Continue?"
      : "Archive this Service Order? It will be removed from the client's portal so you can issue a new one.";
    if (!window.confirm(message)) return;

    setPending(send.id);
    setError(null);
    setSuccess(null);

    try {
      const result = await archiveServiceOrder(clientId, send.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(send.signature ? "Service Order voided." : "Archived.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update that record.",
      );
    } finally {
      setPending(null);
    }
  }

  const showLinkError = linkTouched && hasDraft && !linkValid;

  return (
    <section className="mt-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-md border-b border-border px-lg py-lg">
        <div>
          <h2 className="text-h4">Service Order &amp; Setup Fee</h2>
          <p className="mt-xs text-body-sm text-muted">
            {testPilot
              ? "Generate from the Forms template and push. A test pilot has no Setup Fee invoice."
              : `Generate (uses the client's own Service Order if it has one, else the Forms template), add the Stripe invoice link for the ${setupFeeLabel(draft)} Setup Fee, review, then push both to the client.`}{" "}
            One active Service Order at a time; archive it to issue a new one.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={pending !== null || Boolean(activeSend)}
          title={
            activeSend
              ? "Archive the current Service Order to generate a new one."
              : undefined
          }
          className={primaryButton}
        >
          {pending === "generate" ? "Generating…" : "Generate Service Order"}
        </button>
      </div>

      {!testPilot && !activeSend ? (
        <div className="border-b border-border px-lg py-lg">
          <label className="block max-w-prose text-label uppercase tracking-label text-muted">
            Stripe invoice link
            <input
              type="url"
              inputMode="url"
              placeholder="https://invoice.stripe.com/i/…"
              value={paymentLink}
              onChange={(event) => {
                setPaymentLink(event.target.value);
                setPreview(null);
                setError(null);
              }}
              onBlur={() => setLinkTouched(true)}
              aria-invalid={showLinkError}
              aria-describedby="payment-link-help"
              className={`${inputClass} ${
                showLinkError ? "border-error" : "border-border"
              }`}
            />
            <span
              id="payment-link-help"
              className={`mt-xs block text-body-sm normal-case tracking-normal ${
                showLinkError ? "text-error" : "text-muted"
              }`}
            >
              {showLinkError
                ? paymentLink.trim()
                  ? STRIPE_INVOICE_LINK_ERROR
                  : "Add the Stripe invoice link for the Setup Fee invoice."
                : "Required. The client sees a Pay button that opens this link."}
            </span>
          </label>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="px-lg py-sm font-medium">Document</th>
              <th className="px-lg py-sm font-medium">Status</th>
              <th className="px-lg py-sm font-medium">Setup Fee</th>
              <th className="px-lg py-sm font-medium">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-lg py-md text-heading">Service Order</td>
              <td className="px-lg py-md">{status}</td>
              <td className="px-lg py-md text-muted">
                {paymentReceivedAt
                  ? `Received ${formatDate(paymentReceivedAt)}`
                  : activeSend
                    ? "Awaiting payment"
                    : "—"}
              </td>
              <td className="px-lg py-md text-right">
                <button
                  type="button"
                  onClick={onReview}
                  disabled={!canReview}
                  className={preview ? secondaryButton : primaryButton}
                >
                  {pending === "review"
                    ? "Building preview…"
                    : preview
                      ? "Refresh preview"
                      : "Review what the client gets"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {preview && hasDraft && !activeSend ? (
        <ReviewPanel
          preview={preview}
          draft={draft}
          paymentLink={paymentLink}
          testPilot={testPilot}
          source={source}
          mismatches={mismatches}
          overrideMismatch={overrideMismatch}
          onOverride={setOverrideMismatch}
          canSend={canSend}
          pending={pending}
          onSend={onSend}
        />
      ) : null}

      {activeSend ? (
        <dl className="grid gap-x-lg gap-y-sm border-t border-border px-lg py-md text-body-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Sent</dt>
          <dd className="text-heading">{formatDateAtTime(activeSend.sent_at)}</dd>
          <dt className="text-muted">Invoice link</dt>
          <dd className="min-w-0 break-all">
            <a
              href={activeSend.payment_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary no-underline hover:text-primary-hover"
            >
              {activeSend.payment_link}
            </a>
          </dd>
          {activeSend.signature ? (
            <>
              <dt className="text-muted">Signed by</dt>
              <dd className="text-heading">
                {activeSend.signature.signer_name},{" "}
                {activeSend.signature.signer_title} ·{" "}
                {activeSend.signature.company_name}
              </dd>
              <dt className="text-muted">Signer email</dt>
              <dd className="text-heading">
                {activeSend.signature.signer_email}
              </dd>
              <dt className="text-muted">Signed at</dt>
              <dd className="text-heading">
                {formatDateAtTime(activeSend.signature.signed_at)}
                {activeSend.signed_ip ? (
                  <span className="text-muted"> · IP {activeSend.signed_ip}</span>
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-md border-t border-border px-lg py-md">
        <div>
          <h3 className="text-h4">Send log</h3>
          <p className="mt-xs text-body-sm text-muted">
            Archiving the active Service Order removes it from the portal.
          </p>
        </div>
        <div className="flex gap-sm">
          <button
            type="button"
            className={tabClass(view === "active")}
            onClick={() => setView("active")}
          >
            Active
          </button>
          <button
            type="button"
            className={tabClass(view === "archived")}
            onClick={() => setView("archived")}
          >
            Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
          </button>
        </div>
      </div>

      {visibleSends.length === 0 ? (
        <p className="px-lg py-lg text-body-sm text-muted">
          {view === "archived"
            ? "No archived Service Orders."
            : "No Service Order sent yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="border-t border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">Sent</th>
                <th className="px-lg py-sm font-medium">Status</th>
                <th className="px-lg py-sm font-medium">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleSends.map((send) => (
                <tr key={send.id} className="border-t border-border">
                  <td className="px-lg py-md text-muted">
                    {formatDateAtTime(send.sent_at)}
                  </td>
                  <td className="px-lg py-md">{sendStatus(send)}</td>
                  <td className="px-lg py-md text-right">
                    {send.archived_at ? null : (
                      <button
                        type="button"
                        onClick={() => onArchive(send)}
                        disabled={pending !== null}
                        className={secondaryButton}
                      >
                        {pending === send.id ? "Archiving…" : "Archive"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error ? (
        <p role="alert" className="border-t border-border px-lg py-md text-body-sm text-error">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="border-t border-border px-lg py-md text-body-sm text-success">
          {success}
        </p>
      ) : null}

      {hasDraft ? (
        <div className="border-t border-border px-lg">
          <Disclosure
            title={
              source === "client"
                ? "Service Order text — this client's custom version"
                : "Service Order text — template from Forms"
            }
          >
            <div className="py-md">
              <p className="mb-md text-body-sm text-muted">
                Client fields are filled in when they sign.
              </p>
              <MarkdownBody
                content={mergeServiceOrder(draft, {})}
                emptyLabel="Nothing generated yet."
              />
            </div>
          </Disclosure>
        </div>
      ) : activeSend ? (
        <div className="border-t border-border px-lg">
          <Disclosure
            title={
              activeSend.signature
                ? "Service Order text — signed copy"
                : "Service Order text — sent to client"
            }
          >
            <div className="py-md">
              <MarkdownBody
                content={
                  activeSend.signed_content ??
                  mergeServiceOrder(activeSend.content, {})
                }
                emptyLabel="Nothing sent yet."
              />
            </div>
          </Disclosure>
        </div>
      ) : null}
    </section>
  );
}

function previewMismatches(preview: ServiceOrderPreview, testPilot: boolean) {
  const out: string[] = [];
  if (!preview.setupFee) out.push("The Service Order doesn't state a Setup Fee.");
  if (!preview.monthlyFee) out.push("The Service Order doesn't state a Monthly Campaign Fee.");
  if (preview.sowSetupFee && preview.setupFee && preview.sowSetupFee !== preview.setupFee) {
    out.push(`Setup Fee is ${preview.setupFee} here but ${preview.sowSetupFee} in the Statement of Work.`);
  }
  if (preview.sowMonthlyFee && preview.monthlyFee && preview.sowMonthlyFee !== preview.monthlyFee) {
    out.push(`Monthly fee is ${preview.monthlyFee} here but ${preview.sowMonthlyFee} in the Statement of Work.`);
  }
  if (!testPilot && preview.invoice.ok) {
    if (feeCents(preview.invoice.amount) !== feeCents(preview.setupFee)) {
      out.push(`The Stripe invoice is for ${preview.invoice.amount}, not ${preview.setupFee ?? "the Setup Fee"}.`);
    }
    if (preview.invoice.status !== "open") {
      out.push(`The Stripe invoice status is "${preview.invoice.status}", not open.`);
    }
  }
  return out;
}

function ReviewPanel({
  preview,
  draft,
  paymentLink,
  testPilot,
  source,
  mismatches,
  overrideMismatch,
  onOverride,
  canSend,
  pending,
  onSend,
}: {
  preview: ServiceOrderPreview;
  draft: string;
  paymentLink: string;
  testPilot: boolean;
  source: "client" | "template" | null;
  mismatches: string[];
  overrideMismatch: boolean;
  onOverride: (value: boolean) => void;
  canSend: boolean;
  pending: string | null;
  onSend: () => void;
}) {
  const row = "grid gap-x-lg gap-y-xs sm:grid-cols-[12rem_1fr]";
  const ok = (good: boolean) => (good ? "text-success" : "text-error");
  const setupMatchesSow = !preview.sowSetupFee || preview.sowSetupFee === preview.setupFee;
  const monthlyMatchesSow = !preview.sowMonthlyFee || preview.sowMonthlyFee === preview.monthlyFee;

  return (
    <div className="border-t border-border bg-background px-lg py-lg">
      <h3 className="text-h4">Review before pushing</h3>
      <p className="mt-xs text-body-sm text-muted">
        This is exactly what goes to the client portal and inbox. Nothing has been sent yet.
        {source === "client" ? " Using this client's custom Service Order." : " Using the Forms template."}
      </p>

      <div className="mt-md space-y-sm text-body-sm">
        <div className={row}>
          <span className="text-muted">Setup Fee</span>
          <span className={ok(Boolean(preview.setupFee) && setupMatchesSow)}>
            {preview.setupFee ?? "not stated"}
            {preview.sowSetupFee ? ` · SOW: ${preview.sowSetupFee}` : ""}
          </span>
        </div>
        <div className={row}>
          <span className="text-muted">Monthly Campaign Fee</span>
          <span className={ok(Boolean(preview.monthlyFee) && monthlyMatchesSow)}>
            {preview.monthlyFee ?? "not stated"}
            {preview.sowMonthlyFee ? ` · SOW: ${preview.sowMonthlyFee}` : ""}
          </span>
        </div>
        {!testPilot ? (
          <div className={row}>
            <span className="text-muted">Stripe invoice</span>
            <span className="min-w-0 break-all">
              {preview.invoice.ok ? (
                <span
                  className={ok(
                    feeCents(preview.invoice.amount) === feeCents(preview.setupFee) &&
                      preview.invoice.status === "open",
                  )}
                >
                  {preview.invoice.amount} · {preview.invoice.status}
                  {preview.invoice.number ? ` · ${preview.invoice.number}` : ""}
                  {preview.invoice.customerEmail ? ` · ${preview.invoice.customerEmail}` : ""}
                </span>
              ) : (
                <span className="text-error">
                  Couldn&apos;t verify the amount: {preview.invoice.reason} Open the link to check it.
                </span>
              )}{" "}
              <a
                href={paymentLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary no-underline hover:text-primary-hover"
              >
                Open invoice ↗
              </a>
            </span>
          </div>
        ) : null}
        <div className={row}>
          <span className="text-muted">Client sees</span>
          <span>Pay {setupFeeLabel(draft)} with Stripe</span>
        </div>
      </div>

      <div className="mt-lg rounded-card border border-border bg-surface p-md">
        <p className="text-label uppercase tracking-label text-muted">Email</p>
        {preview.email.ok ? (
          <div className="mt-sm text-body-sm">
            <p>
              <span className="text-muted">To:</span> {preview.email.to}
            </p>
            <p>
              <span className="text-muted">Subject:</span> {preview.email.subject}
            </p>
            <pre className="mt-sm whitespace-pre-wrap font-sans text-body">{preview.email.body}</pre>
          </div>
        ) : (
          <p className="mt-sm text-body-sm text-error">
            No email will be sent: {preview.email.reason}
          </p>
        )}
      </div>

      <div className="mt-lg rounded-card border border-border bg-surface p-md">
        <p className="mb-sm text-label uppercase tracking-label text-muted">
          Service Order, as the client will see it
        </p>
        <MarkdownBody content={mergeServiceOrder(draft, {})} emptyLabel="Nothing generated yet." />
      </div>

      {mismatches.length > 0 ? (
        <div role="alert" className="mt-lg rounded-card border border-error/40 p-md text-body-sm text-error">
          <ul className="list-disc pl-lg">
            {mismatches.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <label className="mt-sm flex items-center gap-sm text-body">
            <input
              type="checkbox"
              checked={overrideMismatch}
              onChange={(e) => onOverride(e.target.checked)}
            />
            I&apos;ve checked this and want to push anyway
          </label>
        </div>
      ) : null}

      <div className="mt-lg flex justify-end">
        <button type="button" onClick={onSend} disabled={!canSend} className={primaryButton}>
          {pending === "send" ? "Pushing…" : "Push to Client Portal"}
        </button>
      </div>
    </div>
  );
}
