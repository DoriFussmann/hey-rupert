"use client";

import { useState, useSyncExternalStore } from "react";
import { confirmStatementOfWork } from "@/app/portal/actions";
import { formatDate } from "@/lib/format";

const THANKS =
  "Thanks — we'll follow up shortly with the Service Order.";

type ThanksStore = {
  value: boolean;
  listeners: Set<() => void>;
};

function getThanksStore(): ThanksStore {
  const globalRef = globalThis as typeof globalThis & {
    __sowThanksStore?: ThanksStore;
  };
  if (!globalRef.__sowThanksStore) {
    globalRef.__sowThanksStore = { value: false, listeners: new Set() };
  }
  return globalRef.__sowThanksStore;
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

export function AcknowledgeButton({
  acknowledgedAt,
}: {
  acknowledgedAt: string | null;
}) {
  const thanks = useSyncExternalStore(
    subscribeThanks,
    () => getThanksStore().value,
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (thanks) {
    return <p className="text-body-sm text-muted">{THANKS}</p>;
  }

  if (acknowledgedAt) {
    return (
      <p className="text-body-sm text-muted">
        Confirmed on {formatDate(acknowledgedAt)}.
      </p>
    );
  }

  async function onClick() {
    setPending(true);
    setError(null);

    try {
      const result = await confirmStatementOfWork();
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
    <div>
      <p className="mb-sm text-body-sm text-error">
        Review of the Statement of Work is not a commitment.
      </p>
      <p className="mb-md text-body-sm text-body">
        Next Step: You will receive a Service Order to confirm.
      </p>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
      >
        {pending ? "Submitting…" : "I Confirm the Statement of Work"}
      </button>
      {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
    </div>
  );
}
