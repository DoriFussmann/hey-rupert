"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { issueClientSetupLink } from "@/app/admin/actions";
import {
  CopyButton,
  SetupLinkResult,
  buildResetEmail,
  type SetupLinkDetails,
} from "@/app/admin/setup-link-result";
import { formatDate } from "@/lib/format";
import type { ClientAccess } from "@/lib/types";

function AccessStatus({ access }: { access: ClientAccess }) {
  switch (access.status) {
    case "pending":
      return (
        <>
          <p className="mt-xs text-body-sm text-muted">
            Set-password link pending. Valid until{" "}
            {formatDate(access.expiresAt)}.
          </p>
          <div className="mt-sm flex items-center justify-between gap-sm rounded-md border border-border bg-background px-sm py-sm">
            <span className="min-w-0 break-all text-body-sm text-body">
              {access.url}
            </span>
            <CopyButton value={access.url} />
          </div>
        </>
      );
    case "expired":
      return (
        <p className="mt-xs text-body-sm text-muted">
          Set-password link expired on {formatDate(access.expiresAt)}. Reset
          to create a new one.
        </p>
      );
    case "set":
      return (
        <p className="mt-xs text-body-sm text-muted">
          Password set on {formatDate(access.usedAt)}.
        </p>
      );
    case "legacy":
      return (
        <p className="mt-xs text-body-sm text-muted">
          Password set (legacy). Reset to create a set-password link.
        </p>
      );
    case "unavailable":
      return <p className="mt-xs text-body-sm text-error">{access.error}</p>;
  }
}

export function ResetPasswordSection({
  clientId,
  companyName,
  firstName,
  email,
  access,
}: {
  clientId: string;
  companyName: string;
  firstName: string;
  email: string;
  access: ClientAccess;
}) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SetupLinkDetails | null>(null);
  const [emailDraft, setEmailDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  function reset() {
    setResult(null);
    setEmailDraft("");
    setError(null);
    setPending(false);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    if (result) router.refresh();
    reset();
  }

  async function onConfirm() {
    setPending(true);
    setError(null);
    try {
      const res = await issueClientSetupLink(clientId);
      if (!res.ok) {
        setError(res.error);
        setPending(false);
        return;
      }
      const details: SetupLinkDetails = {
        firstName,
        email: res.email,
        setupUrl: res.setupUrl,
        expiresAt: res.expiresAt,
      };
      setResult(details);
      setEmailDraft(buildResetEmail(details));
      setPending(false);
    } catch {
      setError("Unable to create a new link. Please try again.");
      setPending(false);
    }
  }

  const name = companyName.trim() || "this client";

  return (
    <>
      <section className="mt-lg flex flex-wrap items-end justify-between gap-md rounded-card border border-border bg-surface px-lg py-lg">
        <div className="min-w-0 flex-1">
          <h2 className="text-h4">Login &amp; access</h2>
          <AccessStatus access={access} />
        </div>
        <div className="flex flex-wrap gap-sm">
          <button
            type="button"
            onClick={() => {
              reset();
              setOpen(true);
            }}
            className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
          >
            Reset password
          </button>
        </div>
      </section>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-heading/20"
            onClick={close}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-surface"
          >
            <div className="flex items-start justify-between gap-md border-b border-border px-lg py-lg">
              <div>
                <p className="text-label uppercase tracking-label text-muted">
                  {name}
                </p>
                <h2 id={titleId} className="mt-sm text-h3">
                  {result ? "New link ready" : "Reset password"}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                className="text-body-sm text-muted transition-colors duration-hover hover:text-heading"
              >
                Close
              </button>
            </div>

            {result ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto px-lg py-lg">
                  <p role="status" className="mb-lg text-body-sm text-success">
                    New set-password link created. Send it to the client.
                  </p>
                  <SetupLinkResult
                    details={result}
                    emailDraft={emailDraft}
                    setEmailDraft={setEmailDraft}
                  />
                </div>
                <div className="flex justify-end gap-sm border-t border-border px-lg py-lg">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto px-lg py-lg">
                  <p className="text-body-sm text-muted">
                    This creates a new set-password link for{" "}
                    <span className="text-body">{email}</span>. Any previous
                    link stops working. Their current password keeps working
                    until they set a new one.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-sm border-t border-border px-lg py-lg">
                  {error ? (
                    <p className="mr-auto text-body-sm text-error">{error}</p>
                  ) : null}
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
                    {pending ? "Creating..." : "Create new link"}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
