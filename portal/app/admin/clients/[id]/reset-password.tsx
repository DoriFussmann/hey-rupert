"use client";

import { useEffect, useId, useState } from "react";
import { resetClientPassword } from "@/app/admin/actions";
import {
  CredentialsResult,
  buildResetEmail,
  generatePassword,
  type Credentials,
} from "@/app/admin/credentials-result";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";
const labelClass = "block text-label uppercase tracking-label text-muted";

export function ResetPasswordSection({
  clientId,
  companyName,
  firstName,
  email,
}: {
  clientId: string;
  companyName: string;
  firstName: string;
  email: string;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const [result, setResult] = useState<Credentials | null>(null);
  const [emailDraft, setEmailDraft] = useState("");

  useEffect(() => {
    if (open && !result && !password) {
      setPassword(generatePassword());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    setPassword("");
    setResult(null);
    setEmailDraft("");
    setError(null);
    setPending(false);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  async function onConfirm() {
    setPending(true);
    setError(null);
    try {
      const res = await resetClientPassword(clientId, password);
      if (!res.ok) {
        setError(res.error);
        setPending(false);
        return;
      }
      const creds: Credentials = {
        firstName,
        email: res.email || email,
        password: res.password,
      };
      setResult(creds);
      setEmailDraft(buildResetEmail(creds));
      setPending(false);
    } catch {
      setError("Unable to reset the password. Please try again.");
      setPending(false);
    }
  }

  const name = companyName.trim() || "this client";

  return (
    <>
      <section className="mt-lg flex flex-wrap items-end justify-between gap-md rounded-card border border-border bg-surface px-lg py-lg">
        <div>
          <h2 className="text-h4">Login &amp; access</h2>
          <p className="mt-xs max-w-prose text-body-sm text-muted">
            Generate a new password for this client and get the login email
            ready to send. Their old password stops working immediately.
          </p>
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
                  {result ? "New password ready" : "Reset password"}
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
                  <p className="mb-lg text-body-sm text-success">
                    Password updated. Send them the new login details.
                  </p>
                  <CredentialsResult
                    credentials={result}
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
                    Resetting the password for{" "}
                    <span className="text-body">{email}</span>.
                  </p>
                  <label className={labelClass + " mt-lg"}>
                    New password
                    <span className="mt-sm flex gap-sm">
                      <input
                        className={fieldClass + " mt-0 flex-1"}
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Auto-generated"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="rounded-md border border-border bg-surface px-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPassword(generatePassword())}
                        className="rounded-md border border-border bg-surface px-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
                      >
                        New
                      </button>
                    </span>
                  </label>
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
                    {pending ? "Resetting..." : "Reset password"}
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
