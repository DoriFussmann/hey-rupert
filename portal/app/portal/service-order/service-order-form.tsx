"use client";

import { useState, useSyncExternalStore } from "react";
import { agreeToServiceOrder } from "@/app/portal/actions";
import { formatDate } from "@/lib/format";

const THANKS =
  "Agreed — Dori will be in touch within 1 business day to get started.";

const fieldClass =
  "mt-sm w-full rounded-[6px] border border-border bg-surface px-sm py-sm text-body-sm text-body outline-none read-only:bg-background";
const labelClass = "block text-label uppercase tracking-label text-muted";

type ThanksStore = {
  value: boolean;
  listeners: Set<() => void>;
};

function getThanksStore(): ThanksStore {
  const globalRef = globalThis as typeof globalThis & {
    __soThanksStore?: ThanksStore;
  };
  if (!globalRef.__soThanksStore) {
    globalRef.__soThanksStore = { value: false, listeners: new Set() };
  }
  return globalRef.__soThanksStore;
}

function markThanks() {
  const store = getThanksStore();
  store.value = true;
  store.listeners.forEach((listener) => listener());
}

function subscribeThanks(listener: () => void) {
  const { listeners } = getThanksStore();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type Fields = {
  linkedin_url: string;
  booking_link: string;
  company_website: string;
  company_description: string;
};

type FieldKey = keyof Fields;

const REQUIRED: { key: FieldKey; label: string }[] = [
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "booking_link", label: "Booking link" },
  { key: "company_website", label: "Company website" },
  { key: "company_description", label: "Company description" },
];

export function ServiceOrderForm({
  agreedAt,
  initial,
}: {
  agreedAt: string | null;
  initial: Fields;
}) {
  const thanks = useSyncExternalStore(
    subscribeThanks,
    () => getThanksStore().value,
    () => false,
  );
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>(
    {},
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = Boolean(agreedAt) || thanks;

  function update(key: FieldKey) {
    return (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      setValues((current) => ({ ...current, [key]: event.target.value }));
      setFieldErrors((current) => ({ ...current, [key]: undefined }));
    };
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || pending) return;

    const nextErrors: Partial<Record<FieldKey, string>> = {};
    for (const field of REQUIRED) {
      if (!values[field.key].trim()) {
        nextErrors[field.key] = `${field.label} is required.`;
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setPending(true);
    setError(null);

    try {
      const result = await agreeToServiceOrder(values);
      if (!result?.ok) {
        setError(result?.error ?? "Unable to submit.");
        return;
      }

      markThanks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-lg max-w-prose">
      <div className="grid gap-md">
        <label className={labelClass}>
          LinkedIn URL
          <input
            name="linkedin_url"
            type="text"
            autoComplete="url"
            value={values.linkedin_url}
            onChange={update("linkedin_url")}
            readOnly={locked}
            className={fieldClass}
          />
          {fieldErrors.linkedin_url ? (
            <p className="mt-xs text-body-sm text-error">
              {fieldErrors.linkedin_url}
            </p>
          ) : null}
        </label>
        <label className={labelClass}>
          Booking link
          <input
            name="booking_link"
            type="text"
            autoComplete="url"
            placeholder="Calendly or cal.com URL"
            value={values.booking_link}
            onChange={update("booking_link")}
            readOnly={locked}
            className={fieldClass}
          />
          {fieldErrors.booking_link ? (
            <p className="mt-xs text-body-sm text-error">
              {fieldErrors.booking_link}
            </p>
          ) : null}
        </label>
        <label className={labelClass}>
          Company website
          <input
            name="company_website"
            type="text"
            autoComplete="url"
            value={values.company_website}
            onChange={update("company_website")}
            readOnly={locked}
            className={fieldClass}
          />
          {fieldErrors.company_website ? (
            <p className="mt-xs text-body-sm text-error">
              {fieldErrors.company_website}
            </p>
          ) : null}
        </label>
        <label className={labelClass}>
          Company description
          <textarea
            name="company_description"
            rows={4}
            value={values.company_description}
            onChange={update("company_description")}
            readOnly={locked}
            className={fieldClass}
          />
          {fieldErrors.company_description ? (
            <p className="mt-xs text-body-sm text-error">
              {fieldErrors.company_description}
            </p>
          ) : null}
        </label>
      </div>

      <div className="mt-lg">
        {thanks ? (
          <p className="text-body-sm text-muted">{THANKS}</p>
        ) : agreedAt ? (
          <p className="text-body-sm text-muted">
            Agreed on {formatDate(agreedAt)}.
          </p>
        ) : (
          <>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
            >
              {pending ? "Submitting…" : "I Agree to the Service Order"}
            </button>
            {error ? (
              <p className="mt-sm text-body-sm text-error">{error}</p>
            ) : null}
          </>
        )}
      </div>
    </form>
  );
}
