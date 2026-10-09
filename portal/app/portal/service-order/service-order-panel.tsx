"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signServiceOrder } from "@/app/portal/actions";
import { MarkdownBody } from "@/components/markdown-body";
import { SignatureBlock } from "@/app/portal/service-order/signature-block";
import { formatDate, formatDateAtTime } from "@/lib/format";
import {
  RUPERT_SIGNATORY,
  SERVICE_ORDER_FIELD_LABELS,
  SETUP_FEE_LABEL,
  mergeServiceOrder,
  type FieldErrors,
  type ServiceOrderFields,
} from "@/lib/service-order";
import type { ServiceOrderSignature } from "@/lib/types";

const fieldClass =
  "mt-sm w-full rounded-md border bg-surface px-sm py-sm text-body-sm normal-case tracking-normal text-body outline-none transition-colors duration-hover focus:border-primary disabled:bg-background";
const labelClass = "block text-label uppercase tracking-label text-muted";
const primaryButton =
  "inline-flex items-center justify-center gap-sm rounded-md bg-primary px-md py-sm text-body-sm text-white no-underline transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";

const FIELD_ORDER: {
  key: keyof ServiceOrderFields;
  type: string;
  autoComplete: string;
}[] = [
  { key: "company_name", type: "text", autoComplete: "organization" },
  { key: "signer_name", type: "text", autoComplete: "name" },
  { key: "signer_email", type: "email", autoComplete: "email" },
  { key: "signer_title", type: "text", autoComplete: "organization-title" },
];

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
  const router = useRouter();
  const [values, setValues] = useState<ServiceOrderFields>(defaults);
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const signed = Boolean(signedAt);
  const locked = signed || readOnly;
  const paid = Boolean(paidAt);

  const documentContent = signed
    ? (signedContent ?? mergeServiceOrder(content, signature ?? {}))
    : mergeServiceOrder(content, values);

  function update(key: keyof ServiceOrderFields) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setValues((current) => ({ ...current, [key]: event.target.value }));
      setFieldErrors((current) => ({ ...current, [key]: undefined }));
    };
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || pending) return;

    const nextErrors: FieldErrors = {};
    for (const { key } of FIELD_ORDER) {
      if (!values[key].trim()) {
        nextErrors[key] = `${SERVICE_ORDER_FIELD_LABELS[key]} is required.`;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setError("Please complete the highlighted fields.");
      return;
    }
    if (!consent) {
      setError("Please confirm you agree to sign electronically.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const result = await signServiceOrder({ ...values, consent });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setError(result.error);
        setPending(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign.");
      setPending(false);
    }
  }

  const clientSigner = signed
    ? {
        company: signature?.company_name ?? "",
        name: signature?.signer_name ?? "",
        title: signature?.signer_title ?? "",
      }
    : {
        company: values.company_name.trim(),
        name: values.signer_name.trim(),
        title: values.signer_title.trim(),
      };

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

      <section className="rounded-card border border-border bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-sm border-b border-border px-lg py-md">
          <h2 className="text-h4">Service Order</h2>
          {issuedAt ? (
            <p className="text-body-sm text-muted">
              Issued {formatDate(issuedAt)}
            </p>
          ) : null}
        </div>
        <div
          tabIndex={0}
          role="region"
          aria-label="Service Order terms"
          className="max-h-[60vh] overflow-y-auto overscroll-contain px-lg py-lg lg:px-xl"
        >
          <MarkdownBody
            content={documentContent}
            emptyLabel="No Service Order has been issued yet."
            className="sow-markdown max-w-none"
          />
        </div>
      </section>

      <section id="sign" className="mt-lg scroll-mt-lg">
        <h2 className="mb-md text-h4">Signatures</h2>
        <div className="grid gap-md md:grid-cols-2">
          <SignatureBlock
            party="Provider"
            company={RUPERT_SIGNATORY.company}
            signature={RUPERT_SIGNATORY.name}
            name={RUPERT_SIGNATORY.name}
            title={RUPERT_SIGNATORY.title}
            date={issuedAt}
          />
          <SignatureBlock
            party="Client"
            company={clientSigner.company}
            signature={clientSigner.name}
            name={clientSigner.name}
            title={clientSigner.title}
            date={signedAt}
            pending={!signed}
          />
        </div>

        {signed ? (
          <p className="mt-md text-body-sm text-muted">
            Signed electronically
            {signature?.signer_email ? ` by ${signature.signer_email}` : ""}
            {signedAt ? ` on ${formatDateAtTime(signedAt)}` : ""}.
          </p>
        ) : (
          <form
            onSubmit={onSubmit}
            noValidate
            className="mt-lg rounded-card border border-border bg-surface p-lg"
          >
            <h3 className="text-h4">Your details</h3>
            <p className="mt-xs text-body-sm text-muted">
              These appear in the Service Order and on your signature.
            </p>
            <div className="mt-lg grid gap-md md:grid-cols-2">
              {FIELD_ORDER.map(({ key, type, autoComplete }) => {
                const errorId = `${key}-error`;
                const fieldError = fieldErrors[key];
                return (
                  <label key={key} className={labelClass}>
                    {SERVICE_ORDER_FIELD_LABELS[key]}
                    <input
                      name={key}
                      type={type}
                      autoComplete={autoComplete}
                      value={values[key]}
                      onChange={update(key)}
                      disabled={locked || pending}
                      required
                      maxLength={200}
                      aria-invalid={Boolean(fieldError)}
                      aria-describedby={fieldError ? errorId : undefined}
                      className={`${fieldClass} ${
                        fieldError ? "border-error" : "border-border"
                      }`}
                    />
                    {fieldError ? (
                      <span
                        id={errorId}
                        className="mt-xs block text-body-sm normal-case tracking-normal text-error"
                      >
                        {fieldError}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>

            <label className="mt-lg flex items-start gap-sm text-body-sm text-body">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => {
                  setConsent(event.target.checked);
                  setError(null);
                }}
                disabled={locked || pending}
                className="mt-[3px] h-4 w-4 shrink-0 accent-primary"
              />
              <span>
                I have read the Service Order, I am authorized to sign it on
                behalf of {values.company_name.trim() || "the Client"}, and I
                agree that typing my name and clicking Sign is my electronic
                signature.
              </span>
            </label>

            <div className="mt-lg flex flex-wrap items-center gap-md">
              <button
                type="submit"
                disabled={locked || pending}
                className={primaryButton}
              >
                {pending ? "Signing…" : "Sign Service Order"}
              </button>
              {readOnly ? (
                <p className="text-body-sm text-muted">
                  Read-only preview. Signing is disabled.
                </p>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="mt-sm text-body-sm text-error">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </section>
    </>
  );
}
