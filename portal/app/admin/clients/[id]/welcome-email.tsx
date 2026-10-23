"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadWelcomeEmail,
  renewWelcomeEmail,
  type WelcomeEmailResult,
} from "@/app/admin/actions";
import { SetupLinkResult } from "@/app/admin/setup-link-result";

const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

const LINK_MESSAGE = {
  set: "The client has already set their password with this link, so it no longer works. Create a new link only if they need to set a new password.",
  expired: "The set-password link has expired. Create a new one to send the welcome email again.",
  none: "This client has no set-password link. Create one to send the welcome email.",
} as const;

/**
 * Reopens the welcome email and set-password link from the client page, for
 * when the Add Client window was closed before they were copied.
 */
export function WelcomeEmailButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<"load" | "renew" | null>(null);
  const [result, setResult] = useState<WelcomeEmailResult | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [renewed, setRenewed] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  function show(next: WelcomeEmailResult) {
    setResult(next);
    setEmailDraft(next.ok && next.link === "pending" ? next.welcome.body : "");
  }

  async function run(kind: "load" | "renew") {
    setPending(kind);
    try {
      const next = await (kind === "load" ? loadWelcomeEmail(clientId) : renewWelcomeEmail(clientId));
      show(next);
      if (kind === "renew" && next.ok) setRenewed(true);
    } catch {
      setResult({ ok: false, error: "Unable to load the welcome email. Please try again." });
    } finally {
      setPending(null);
    }
  }

  function onOpen() {
    setOpen(true);
    setResult(null);
    setRenewed(false);
    void run("load");
  }

  function close() {
    if (pending) return;
    setOpen(false);
    if (renewed) router.refresh();
  }

  return (
    <>
      <button type="button" onClick={onOpen} className={secondaryButton}>
        Welcome Email
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md">
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
            className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-card border border-border bg-surface shadow-lg"
          >
            <div className="flex items-start justify-between gap-md border-b border-border px-lg py-lg">
              <h2 id={titleId} className="text-h3">
                Welcome Email
              </h2>
              <button
                type="button"
                onClick={close}
                className="text-body-sm text-muted transition-colors duration-hover hover:text-heading"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-lg py-lg">
              {!result ? (
                <p role="status" className="text-body-sm text-muted">
                  Loading…
                </p>
              ) : !result.ok ? (
                <p role="alert" className="text-body-sm text-error">
                  {result.error}
                </p>
              ) : result.link === "pending" ? (
                <>
                  {renewed ? (
                    <p role="status" className="mb-lg text-body-sm text-success">
                      New set-password link created. The previous link no longer works.
                    </p>
                  ) : null}
                  <SetupLinkResult
                    details={{
                      firstName: result.firstName,
                      email: result.email,
                      setupUrl: result.setupUrl,
                      expiresAt: result.expiresAt,
                    }}
                    subject={result.welcome.subject}
                    emailDraft={emailDraft}
                    setEmailDraft={setEmailDraft}
                  />
                </>
              ) : (
                <p className="text-body-sm text-muted">{LINK_MESSAGE[result.link]}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-sm border-t border-border px-lg py-lg">
              {result?.ok && result.link !== "pending" ? (
                <button
                  type="button"
                  onClick={() => void run("renew")}
                  disabled={pending !== null}
                  className={primaryButton}
                >
                  {pending === "renew" ? "Creating…" : "Create New Link"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={close}
                disabled={pending !== null}
                className={result?.ok && result.link === "pending" ? primaryButton : secondaryButton}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
