"use client";

import { useState, useSyncExternalStore } from "react";
import { acknowledgeScopeOfWork } from "@/app/portal/actions";
import { formatDate } from "@/lib/format";

const THANKS =
  "Thanks — we'll be in touch shortly with next steps.";

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
        Reviewed on {formatDate(acknowledgedAt)}.
      </p>
    );
  }

  async function onClick() {
    setPending(true);
    setError(null);

    try {
      const result = await acknowledgeScopeOfWork();
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
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
      >
        {pending ? "Submitting…" : "I've Reviewed the Scope of Work"}
      </button>
      {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
    </div>
  );
}
