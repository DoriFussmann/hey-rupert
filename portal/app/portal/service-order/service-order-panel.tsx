"use client";

import { signServiceOrder } from "@/app/portal/actions";
import { SignableDocument } from "@/components/signable-document";
import { formatDate } from "@/lib/format";
import { SETUP_FEE_LABEL, type ServiceOrderFields } from "@/lib/service-order";
import type { ServiceOrderSignature } from "@/lib/types";

const primaryButton =
  "inline-flex items-center justify-center gap-sm rounded-md bg-primary px-md py-sm text-body-sm text-white no-underline transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";

function StepStatus({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-sm py-xs text-label uppercase tracking-label ${
        done
          ? "border-border text-success"
          : "border-primary/30 bg-primary-tint text-primary"
      }`}
    >
      {label}
    </span>
  );
}

function ExternalIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.5 3.75h4.75V8.5M16 4 9 11M14 11.5v3.75a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H8.5"
      />
    </svg>
  );
}

export function ServiceOrderPanel({
  content,
  signedContent,
  issuedAt,
  signedAt,
  signature,
  invoiceUrl,
  paidAt,
  defaults,
  readOnly,
}: {
  content: string;
  signedContent: string | null;
  issuedAt: string | null;
  signedAt: string | null;
  signature: ServiceOrderSignature | null;
  invoiceUrl: string | null;
  paidAt: string | null;
  defaults: ServiceOrderFields;
  readOnly: boolean;
}) {
  const signed = Boolean(signedAt);
  const paid = Boolean(paidAt);

  return (
    <>
      <div className="mb-lg grid gap-md md:grid-cols-2">
        <a
          href="#sign"
          className="flex flex-col gap-sm rounded-card border border-border bg-surface p-lg no-underline transition-colors duration-hover hover:bg-background"
        >
          <span className="flex items-start justify-between gap-md">
            <span>
              <span className="block text-label uppercase tracking-label text-muted">
                Step 1
              </span>
              <span className="mt-xs block text-h4 text-heading">
                Sign the Service Order
              </span>
            </span>
            <StepStatus
              done={signed}
              label={signed ? "Signed" : "Your turn"}
            />
          </span>
          <span className="text-body-sm text-muted">
            {signed && signedAt
              ? `Signed on ${formatDate(signedAt)}.`
              : "Review the terms below, add your details and sign."}
          </span>
        </a>

        <div
          id="setup-fee"
          className="flex scroll-mt-lg flex-col gap-sm rounded-card border border-border bg-surface p-lg"
        >
          <div className="flex items-start justify-between gap-md">
            <div>
              <p className="text-label uppercase tracking-label text-muted">
                Step 2
              </p>
              <p className="mt-xs text-h4 text-heading">
                Pay the Setup Fee{" "}
                <span className="font-mono text-mono text-secondary">
                  {SETUP_FEE_LABEL}
                </span>
              </p>
            </div>
            <StepStatus done={paid} label={paid ? "Paid" : "Your turn"} />
          </div>
          {paid && paidAt ? (
            <p className="text-body-sm text-muted">
              Payment received on {formatDate(paidAt)}.
            </p>
          ) : (
            <>
              <p className="text-body-sm text-muted">
                One-time, paid securely through Stripe. It shows as paid here
                automatically once your payment goes through.
              </p>
              {invoiceUrl && !readOnly ? (
                <a
                  href={invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${primaryButton} self-start`}
                >
                  Pay {SETUP_FEE_LABEL} with Stripe
                  <ExternalIcon />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className={`${primaryButton} self-start`}
                >
                  Pay {SETUP_FEE_LABEL} with Stripe
                  <ExternalIcon />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {signed && paid ? (
        <p className="mb-lg rounded-card border border-primary/30 bg-primary-tint px-lg py-md text-body-sm text-heading">
          You are all set. Rupert is preparing your NDA, which is the next
          step.
        </p>
      ) : null}

      <SignableDocument
        title="Service Order"
        content={content}
        signedContent={signedContent}
        issuedAt={issuedAt}
        signedAt={signedAt}
        signature={signature}
        defaults={defaults}
        readOnly={readOnly}
        sign={signServiceOrder}
      />
    </>
  );
}
