"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  archiveClient,
  deleteClient,
  unarchiveClient,
} from "@/app/admin/actions";

type ConfirmKind = "archive" | "unarchive" | "delete";

const copy: Record<
  ConfirmKind,
  { title: string; body: string; confirm: string; pending: string }
> = {
  archive: {
    title: "Archive this client?",
    body: "They will be hidden from the main client list. You can unarchive them later.",
    confirm: "Archive client",
    pending: "Archiving…",
  },
  unarchive: {
    title: "Unarchive this client?",
    body: "They will appear in the main client list again.",
    confirm: "Unarchive client",
    pending: "Unarchiving…",
  },
  delete: {
    title: "Delete this client?",
    body: "This permanently removes the client record and their login. This cannot be undone.",
    confirm: "Delete client",
    pending: "Deleting…",
  },
};

export function ClientActions({
  clientId,
  companyName,
  archived,
}: {
  clientId: string;
  companyName: string;
  archived: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirm) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        setConfirm(null);
        setError(null);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, pending]);

  function close() {
    if (pending) return;
    setConfirm(null);
    setError(null);
  }

  async function onConfirm() {
    if (!confirm) return;
    setPending(true);
    setError(null);

    try {
      const result =
        confirm === "delete"
          ? await deleteClient(clientId)
          : confirm === "archive"
            ? await archiveClient(clientId)
            : await unarchiveClient(clientId);

      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }

      if (confirm === "delete") {
        router.push("/admin");
        router.refresh();
        return;
      }

      setConfirm(null);
      setPending(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to complete that action.",
      );
      setPending(false);
    }
  }

  const dialog = confirm ? copy[confirm] : null;
  const name = companyName.trim() || "this client";

  return (
    <>
      <section className="mt-lg flex flex-wrap items-end justify-between gap-md rounded-card border border-border bg-surface px-lg py-lg">
        <div>
          <h2 className="text-h4">Client record</h2>
          <p className="mt-xs max-w-prose text-body-sm text-muted">
            Archive hides this client from the main list. Delete removes them
            permanently.
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
          {archived ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirm("unarchive");
              }}
              className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
            >
              Unarchive
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirm("archive");
              }}
              className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
            >
              Archive
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirm("delete");
            }}
            className="rounded-md border border-error px-md py-sm text-body-sm text-error transition-colors duration-hover hover:bg-error hover:text-white"
          >
            Delete
          </button>
        </div>
      </section>

      {dialog ? (
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
            aria-labelledby={titleId}
            className="relative w-full max-w-md rounded-card border border-border bg-surface p-lg"
          >
            <p className="text-label uppercase tracking-label text-muted">
              {name}
            </p>
            <h2 id={titleId} className="mt-sm text-h3">
              {dialog.title}
            </h2>
            <p className="mt-sm text-body-sm text-muted">{dialog.body}</p>
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
                className={
                  confirm === "delete"
                    ? "rounded-md bg-error px-md py-sm text-body-sm text-white transition-colors duration-hover hover:opacity-90 disabled:opacity-40"
                    : "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
                }
              >
                {pending ? dialog.pending : dialog.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
