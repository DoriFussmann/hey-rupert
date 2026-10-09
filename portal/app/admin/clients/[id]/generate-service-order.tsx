"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  archiveServiceOrder,
  generateServiceOrder,
  sendServiceOrder,
} from "@/app/admin/actions";
import { MarkdownBody } from "@/components/markdown-body";
import { formatDate, formatDateAtTime } from "@/lib/format";
import {
  SETUP_FEE_LABEL,
  isStripePaymentLink,
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
}: {
  clientId: string;
  sends: ServiceOrderSend[];
  paymentReceivedAt: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [linkTouched, setLinkTouched] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");

  const activeSend = sends.find((send) => !send.archived_at) ?? null;
  const hasDraft = Boolean(draft.trim());
  const linkValid = isStripePaymentLink(paymentLink);
  const canSend = hasDraft && linkValid && !activeSend && pending === null;
  const archivedCount = sends.filter((send) => send.archived_at).length;

  const status = hasDraft
    ? linkValid
      ? "Ready to send"
      : "Add payment link"
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
      setSuccess(
        "Generated from the Service Order template. Add the Stripe payment link, then push.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate.");
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
      setSuccess("Service Order and Setup Fee invoice pushed to the client portal.");
      setDraft("");
      setPaymentLink("");
      setLinkTouched(false);
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
            Generate from the Forms template, add the Stripe payment link for
            the {SETUP_FEE_LABEL} Setup Fee, then push both to the client. One
            active Service Order at a time; archive it to issue a new one.
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

      {hasDraft ? (
        <div className="border-b border-border px-lg py-lg">
          <label className="block max-w-prose text-label uppercase tracking-label text-muted">
            Stripe payment link (Setup Fee invoice)
            <input
              type="url"
              inputMode="url"
              placeholder="https://invoice.stripe.com/i/…"
              value={paymentLink}
              onChange={(event) => {
                setPaymentLink(event.target.value);
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
                ? "Enter an https link on stripe.com (invoice or payment link)."
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
                  onClick={onSend}
                  disabled={!hasDraft || Boolean(activeSend) || pending !== null}
                  className={primaryButton}
                >
                  {pending === "send" ? "Pushing…" : "Push to Client Portal"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {activeSend ? (
        <dl className="grid gap-x-lg gap-y-sm border-t border-border px-lg py-md text-body-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Sent</dt>
          <dd className="text-heading">{formatDateAtTime(activeSend.sent_at)}</dd>
          <dt className="text-muted">Payment link</dt>
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
        <div className="border-t border-border px-lg py-lg">
          <p className="mb-md text-label uppercase tracking-label text-muted">
            Preview · client fields are filled in when they sign
          </p>
          <MarkdownBody
            content={mergeServiceOrder(draft, {})}
            emptyLabel="Nothing generated yet."
          />
        </div>
      ) : activeSend ? (
        <details className="border-t border-border px-lg py-lg">
          <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
            {activeSend.signature ? "Signed copy" : "Sent to client"}
          </summary>
          <div className="mt-md">
            <MarkdownBody
              content={
                activeSend.signed_content ??
                mergeServiceOrder(activeSend.content, {})
              }
              emptyLabel="Nothing sent yet."
            />
          </div>
        </details>
      ) : null}
    </section>
  );
}
