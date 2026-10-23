"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import { PORTAL_HOST } from "@/lib/portal-url";

export const EMAIL_SUBJECT = "Your Rupert Portal & Statement of Work";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";
const labelClass = "block text-label uppercase tracking-label text-muted";
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
// email body.
export function SetupLinkResult({
  details,
  subject = EMAIL_SUBJECT,
  emailDraft,
  setEmailDraft,
}: {
  details: SetupLinkDetails;
  subject?: string;
  emailDraft: string;
  setEmailDraft: (value: string) => void;
}) {
  const { copied, copy } = useCopy();

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
          <button
            type="button"
            className={copyButtonClass}
            onClick={() => copy(emailDraft, "body")}
          >
            {copied === "body" ? "Copied" : "Copy email"}
          </button>
        </div>
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
