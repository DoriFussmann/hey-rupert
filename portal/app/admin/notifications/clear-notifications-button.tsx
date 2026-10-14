"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearAllNotifications } from "@/app/admin/actions";

export function ClearNotificationsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  async function onConfirm() {
    setPending(true);
    setError(null);
    try {
      const result = await clearAllNotifications();
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      setOpen(false);
      setPending(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to clear notifications.");
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
      >
        Clear all
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-lg">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-heading/20"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-notifications-title"
            className="relative w-full max-w-md rounded-card border border-border bg-surface p-lg"
          >
            <h2 id="clear-notifications-title" className="text-h3">
              Clear all notifications?
            </h2>
            <p className="mt-sm text-body-sm text-muted">
              This removes every notification from this list. Emails already
              sent are not affected.
            </p>
            {error ? (
              <p className="mt-md text-body-sm text-error">{error}</p>
            ) : null}
            <div className="mt-lg flex flex-wrap justify-end gap-sm">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={pending}
                className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
              >
                {pending ? "Clearing…" : "Clear all"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
