"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import { PORTAL_HOST } from "@/lib/portal-url";
import { sendSetupEmail, type SetupEmailKind } from "@/app/admin/actions";

export const EMAIL_SUBJECT = "Your Rupert Portal & Statement of Work";
export const RESET_EMAIL_SUBJECT = "Set a new password for your Rupert Portal";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";
const labelClass = "block text-label uppercase tracking-label text-muted";
const sendButtonClass =
  "shrink-0 rounded-md bg-primary px-sm py-xs text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const copyButtonClass =
  "shrink-0 rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading";

export type SetupLinkDetails = {
  firstName: string;
  email: string;
  setupUrl: string;
  expiresAt: string;
};

// Shorter body for an existing client who needs to set a new password.
export function buildResetEmail(details: SetupLinkDetails) {
  const greetingName = details.firstName || "there";
  return `Hi ${greetingName},

Here's a link to set a new password for your Rupert Client Portal.

///
Set your new password here (link valid until ${formatDate(details.expiresAt)}):
${details.setupUrl}

You'll be taken straight into your portal. After that, log in any time at ${PORTAL_HOST} (Login, top-right corner) with ${details.email} and your new password.
///

If anything doesn't work, just reply to this email and I'll sort it out.

Thanks,
Dori`;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  }

  return { copied, copy };
}

export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const { copied, copy } = useCopy();

  return (
    <button
      type="button"
      className={copyButtonClass}
      onClick={() => copy(value, "value")}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

// Email / link / expiry / subject rows with copy buttons, plus the editable
// email body. With `send`, a Send to client button sends it from the portal.
export function SetupLinkResult({
  details,
  subject = EMAIL_SUBJECT,
  emailDraft,
  setEmailDraft,
  send,
}: {
  details: SetupLinkDetails;
  subject?: string;
  emailDraft: string;
  setEmailDraft: (value: string) => void;
  /** The client and which email this is, to send it from the portal. */
  send?: { clientId: string; kind: SetupEmailKind };
}) {
  const { copied, copy } = useCopy();
  const [sending, setSending] = useState(false);
  const [sentDraft, setSentDraft] = useState<string | null>(null);
  const [sendMessage, setSendMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const alreadySent = sentDraft !== null && sentDraft === emailDraft;

  async function sendToClient() {
    if (!send) return;
    const again = sentDraft !== null ? " again" : "";
    if (!window.confirm(`Send this email${again} to ${details.email} now, from the portal's address?`)) return;
    setSending(true);
    setSendMessage(null);
    try {
      const result = await sendSetupEmail(send.clientId, send.kind, subject, emailDraft);
      if (result.ok) {
        setSentDraft(emailDraft);
        setSendMessage({ kind: "ok", text: `Sent to ${result.to}. It's in the client's email history.` });
      } else {
        setSendMessage({ kind: "error", text: result.error });
      }
    } catch (err) {
      setSendMessage({ kind: "error", text: err instanceof Error ? err.message : "The email wasn't sent." });
    } finally {
      setSending(false);
    }
  }

  const rows = [
    { key: "email", label: "Email", value: details.email },
    { key: "link", label: "Set-password link", value: details.setupUrl },
    { key: "subject", label: "Subject", value: subject },
  ];

  return (
    <div className="grid gap-lg">
      <div className="grid gap-sm">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between gap-sm rounded-md border border-border bg-background px-sm py-sm"
          >
            <span className="min-w-0 break-all text-body-sm text-body">
              <span className="text-muted">{row.label}: </span>
              {row.value}
            </span>
            <button
              type="button"
              className={copyButtonClass}
              onClick={() => copy(row.value, row.key)}
            >
              {copied === row.key ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
        <p className="text-body-sm text-muted">
          Link valid until {formatDate(details.expiresAt)}. It works once.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className={labelClass}>Email (editable)</span>
          <span className="flex items-center gap-sm">
            <button
              type="button"
              className={copyButtonClass}
              onClick={() => copy(emailDraft, "body")}
            >
              {copied === "body" ? "Copied" : "Copy Email"}
            </button>
            {send ? (
              <button
                type="button"
                className={sendButtonClass}
                disabled={sending || alreadySent}
                onClick={() => void sendToClient()}
              >
                {sending ? "Sending…" : alreadySent ? "Sent" : "Send to Client"}
              </button>
            ) : null}
          </span>
        </div>
        {sendMessage ? (
          <p
            role={sendMessage.kind === "error" ? "alert" : "status"}
            className={`mt-sm text-body-sm ${sendMessage.kind === "error" ? "text-error" : "text-success"}`}
          >
            {sendMessage.text}
          </p>
        ) : null}
        <textarea
          aria-label="Email body"
          className={fieldClass + " font-mono"}
          rows={18}
          value={emailDraft}
          onChange={(event) => setEmailDraft(event.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
