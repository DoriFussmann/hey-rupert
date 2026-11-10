"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addClientViewer,
  previewViewerWelcomeEmail,
  removeClientViewer,
  sendViewerWelcomeEmail,
  type ViewerWelcomePreview,
} from "@/app/admin/viewer-actions";
import { CopyButton } from "@/app/admin/setup-link-result";
import { formatDate } from "@/lib/format";
import type { ClientViewer } from "@/lib/viewers";

const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const fieldClass =
  "mt-xs w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";
const labelClass = "block text-label uppercase tracking-label text-muted";

function statusText(viewer: ClientViewer) {
  const { access, welcomeSentAt } = viewer;
  if (access.status === "set") return `Password set on ${formatDate(access.usedAt)}.`;
  const sent = welcomeSentAt
    ? `Welcome email sent on ${formatDate(welcomeSentAt)}.`
    : "Welcome email not sent yet.";
  if (access.status === "pending") {
    return `${sent} Set-password link valid until ${formatDate(access.expiresAt)}.`;
  }
  if (access.status === "expired") {
    return `${sent} Set-password link expired on ${formatDate(access.expiresAt)}; sending the email creates a new one.`;
  }
  return sent;
}

function sendLabel(viewer: ClientViewer) {
  if (viewer.access.status === "set") return "Send New Password Link";
  return viewer.welcomeSentAt ? "Resend Welcome Email" : "Send Welcome Email";
}

function ViewerRow({ viewer }: { viewer: ClientViewer }) {
  const router = useRouter();
  const titleId = useId();
  const [pending, setPending] = useState<"send" | "remove" | null>(null);
  // The welcome email, shown for a read-through before it is sent.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<ViewerWelcomePreview | null>(null);

  useEffect(() => {
    if (!previewOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && pending === null) setPreviewOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen, pending]);

  async function openPreview() {
    setPreviewOpen(true);
    setPreview(null);
    setMessage(null);
    try {
      setPreview(await previewViewerWelcomeEmail(viewer.id));
    } catch {
      setPreview({ ok: false, error: "Unable to load the email. Please try again." });
    }
  }

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(kind: "send" | "remove") {
    setPending(kind);
    setMessage(null);
    try {
      const result =
        kind === "send"
          ? await sendViewerWelcomeEmail(viewer.id)
          : await removeClientViewer(viewer.id);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
      } else if (kind === "send") {
        setMessage({ ok: true, text: `Email sent to ${viewer.email}.` });
      }
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setPending(null);
      setConfirmRemove(false);
      setPreviewOpen(false);
    }
  }

  return (
    <li className="border-t border-border py-md first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0 flex-1">
          <p className="text-body-sm text-heading">
            {viewer.firstName} {viewer.lastName}
            <span className="text-secondary"> · {viewer.email}</span>
          </p>
          <p className="mt-xs text-body-sm text-muted">{statusText(viewer)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          {confirmRemove ? (
            <>
              <span className="text-body-sm text-muted">Remove their access?</span>
              <button
                type="button"
                onClick={() => void run("remove")}
                disabled={pending !== null}
                className={primaryButton}
              >
                {pending === "remove" ? "Removing…" : "Yes, Remove"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                disabled={pending !== null}
                className={secondaryButton}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void openPreview()}
                disabled={pending !== null}
                className={viewer.welcomeSentAt ? secondaryButton : primaryButton}
              >
                {sendLabel(viewer)}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                disabled={pending !== null}
                className={secondaryButton}
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>
      {viewer.access.status === "pending" ? (
        <div className="mt-sm flex items-center justify-between gap-sm rounded-md border border-border bg-background px-sm py-sm">
          <span className="min-w-0 break-all text-body-sm text-body">
            {viewer.access.url}
          </span>
          <CopyButton value={viewer.access.url} label="Copy Link" />
        </div>
      ) : null}
      {previewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-heading/20"
            onClick={() => (pending === null ? setPreviewOpen(false) : undefined)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-card border border-border bg-surface shadow-lg"
          >
            <div className="border-b border-border px-lg py-lg">
              <h2 id={titleId} className="text-h3">
                {sendLabel(viewer)}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto px-lg py-lg">
              {!preview ? (
                <p role="status" className="text-body-sm text-muted">
                  Loading…
                </p>
              ) : !preview.ok ? (
                <p role="alert" className="text-body-sm text-error">
                  {preview.error}
                </p>
              ) : (
                <>
                  <p className={labelClass}>To</p>
                  <p className="mt-xs text-body-sm text-body">{preview.to}</p>
                  <p className={`mt-md ${labelClass}`}>Subject</p>
                  <p className="mt-xs text-body-sm text-body">{preview.subject}</p>
                  <p className={`mt-md ${labelClass}`}>Email</p>
                  <div className="mt-xs whitespace-pre-wrap break-words rounded-md border border-border bg-background px-md py-md text-body-sm text-body">
                    {preview.body}
                  </div>
                  <p className="mt-md text-body-sm text-muted">
                    {preview.newLink
                      ? "Sending creates a new set-password link and puts it in the email. "
                      : ""}
                    To change the wording, edit &quot;Welcome email (viewer)&quot; in Forms → Emails.
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-sm border-t border-border px-lg py-lg">
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                disabled={pending !== null}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void run("send")}
                disabled={pending !== null || !preview?.ok}
                className={primaryButton}
              >
                {pending === "send" ? "Sending…" : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`mt-sm text-body-sm ${message.ok ? "text-success" : "text-error"}`}
        >
          {message.text}
        </p>
      ) : null}
    </li>
  );
}

/**
 * View-only portal logins for people the client asked to be added. A viewer
 * sees the client's portal exactly as the client does and can't change
 * anything. Not a second client user: they never get emails or turns.
 */
export function ViewersSection({
  clientId,
  viewers,
  loadError,
}: {
  clientId: string;
  viewers: ClientViewer[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeForm() {
    setOpen(false);
    setFirstName("");
    setLastName("");
    setEmail("");
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await addClientViewer(clientId, {
        first_name: firstName,
        last_name: lastName,
        email,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      closeForm();
      router.refresh();
    } catch {
      setError("Unable to add the viewer. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-lg rounded-card border border-border bg-surface px-lg py-lg">
      <div className="flex flex-wrap items-end justify-between gap-md">
        <div className="min-w-0 flex-1">
          <h2 className="text-h4">Viewers</h2>
          <p className="mt-xs text-body-sm text-muted">
            View-only logins for people the client asked to add. A viewer sees
            exactly what the client sees, but can&apos;t edit, confirm or
            comment on anything.
          </p>
        </div>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
            Add Viewer
          </button>
        ) : null}
      </div>

      {loadError ? (
        <p role="alert" className="mt-md text-body-sm text-error">
          {loadError}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={onSubmit} className="mt-md border-t border-border pt-md">
          <div className="grid gap-md sm:grid-cols-3">
            <label className={labelClass}>
              First name
              <input
                className={fieldClass}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoFocus
                required
              />
            </label>
            <label className={labelClass}>
              Last name
              <input
                className={fieldClass}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                required
              />
            </label>
            <label className={labelClass}>
              Email
              <input
                className={fieldClass}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
          </div>
          <div className="mt-md flex flex-wrap items-center justify-end gap-sm">
            {error ? (
              <p role="alert" className="mr-auto text-body-sm text-error">
                {error}
              </p>
            ) : (
              <p className="mr-auto text-body-sm text-muted">
                Nothing is sent yet. After adding, click Send Welcome Email.
              </p>
            )}
            <button type="button" onClick={closeForm} disabled={pending} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Adding…" : "Add Viewer"}
            </button>
          </div>
        </form>
      ) : null}

      {viewers.length > 0 ? (
        <ul className="mt-md border-t border-border">
          {viewers.map((viewer) => (
            <ViewerRow key={viewer.id} viewer={viewer} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
