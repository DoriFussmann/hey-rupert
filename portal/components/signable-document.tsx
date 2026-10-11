"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MarkdownBody } from "@/components/markdown-body";
import { SignatureBlock } from "@/components/signature-block";
import { formatDate, formatDateAtTime } from "@/lib/format";
import {
  RUPERT_SIGNATORY,
  SERVICE_ORDER_FIELD_LABELS,
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

export type SignDocumentAction = (
  input: ServiceOrderFields & { consent: boolean },
) => Promise<
  { ok: true } | { ok: false; error: string; fieldErrors?: FieldErrors }
>;

/**
 * A document the client reviews and e-signs: the terms (with the client's
 * details filled in live), both signature blocks, and the signing form.
 * Used by the Service Order and the NDA.
 */
export function SignableDocument({
  title,
  content,
  signedContent,
  issuedAt,
  signedAt,
  signature,
  defaults,
  readOnly,
  sign,
}: {
  title: string;
  content: string;
  signedContent: string | null;
  issuedAt: string | null;
  signedAt: string | null;
  signature: ServiceOrderSignature | null;
  defaults: ServiceOrderFields;
  readOnly: boolean;
  sign: SignDocumentAction;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ServiceOrderFields>(defaults);
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const signed = Boolean(signedAt);
  const locked = signed || readOnly;

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
      const result = await sign({ ...values, consent });
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
      <section className="rounded-card border border-border bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-sm border-b border-border px-lg py-md">
          <h2 className="text-h4">{title}</h2>
          {issuedAt ? (
            <p className="text-body-sm text-muted">
              Issued {formatDate(issuedAt)}
            </p>
          ) : null}
        </div>
        <div
          tabIndex={0}
          role="region"
          aria-label={`${title} terms`}
          className="max-h-[60vh] overflow-y-auto overscroll-contain px-lg py-lg lg:px-xl"
        >
          <MarkdownBody
            content={documentContent}
            emptyLabel={`No ${title} has been issued yet.`}
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
              These appear in the {title} and on your signature.
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
                I have read the {title}, I am authorized to sign it on
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
                {pending ? "Signing…" : `Sign ${title}`}
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
