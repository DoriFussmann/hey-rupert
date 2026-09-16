"use client";

import { useEffect, useState } from "react";

// Site clients are told to visit to log in. Set NEXT_PUBLIC_PORTAL_URL in the
// environment; falls back to the marketing site where the Login button lives.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_PORTAL_URL || "https://heyrupert.com"
).replace(/\/+$/, "");
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");

export const EMAIL_SUBJECT = "Your Rupert Portal & Statement of Work";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";
const labelClass = "block text-label uppercase tracking-label text-muted";

// Readable, strong temporary password. Mirrors the server generator: no
// ambiguous characters, grouped for easy copy/paste and typing.
export function generatePassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const values = new Uint32Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < values.length; i += 1) {
      values[i] = Math.floor(Math.random() * 0xffffffff);
    }
  }
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    out += alphabet[values[i] % alphabet.length];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

export type Credentials = {
  firstName: string;
  email: string;
  password: string;
};

export function buildEmail(c: Credentials) {
  const greetingName = c.firstName || "there";
  return `Hi ${greetingName},

Thank you for the call today. I enjoyed the conversation and appreciate you taking the time.

A small heads-up that this email is slightly longer than usual, but I wanted to put everything you need in one place.

Statement of Work

I've created your Rupert Client Portal, where you'll find the Statement of Work we discussed today.

Please take a look when you have a chance. If everything looks good, click to confirm. If you have any questions or would like to discuss anything in the SOW, just let me know.

Once you confirm, I'll issue the Service Order and send you the next step.

You can also see the overall onboarding process in the portal, so you'll have visibility into what comes next. The other sections of the portal will become active as we move through setup and launch the campaign.

Login details are below.

Curious about how you got to me - pls let me know!

///
Your Rupert Portal

Go to ${SITE_HOST} and click Login in the top-right corner.

Email: ${c.email}
Password: ${c.password}

Once logged in, you'll see your Statement of Work and onboarding steps.
///

Thanks again, ${greetingName}.

I'm looking forward to hopefully working together, and please reach out with any questions as you review everything.

Dori`;
}

// A shorter body for an existing client whose password was reset - no "created
// your portal" framing, just the new login. Used by the reset flow.
export function buildResetEmail(c: Credentials) {
  const greetingName = c.firstName || "there";
  return `Hi ${greetingName},

Here are fresh login details for your Rupert Client Portal.

///
Your Rupert Portal

Go to ${SITE_HOST} and click Login in the top-right corner.

Email: ${c.email}
Password: ${c.password}
///

This new password replaces any previous one. If anything doesn't work, just reply to this email and I'll sort it out.

Thanks,
Dori`;
}

// Shared result block: Email / Password / Site / Subject copy chips plus the
// editable email body. Manages its own copy-feedback state.
export function CredentialsResult({
  credentials,
  subject = EMAIL_SUBJECT,
  emailDraft,
  setEmailDraft,
}: {
  credentials: Credentials;
  subject?: string;
  emailDraft: string;
  setEmailDraft: (value: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  }

  const rowClass =
    "flex items-center justify-between gap-sm rounded-md border border-border bg-background px-sm py-sm";
  const copyBtn =
    "shrink-0 rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading";

  return (
    <div className="grid gap-lg">
      <div className="grid gap-sm">
        <div className={rowClass}>
          <span className="min-w-0 break-all text-body-sm text-body">
            <span className="text-muted">Email: </span>
            {credentials.email}
          </span>
          <button
            type="button"
            className={copyBtn}
            onClick={() => copy(credentials.email, "email-addr")}
          >
            {copied === "email-addr" ? "Copied" : "Copy"}
          </button>
        </div>
        <div className={rowClass}>
          <span className="min-w-0 break-all font-mono text-body-sm text-body">
            <span className="font-sans text-muted">Password: </span>
            {credentials.password}
          </span>
          <button
            type="button"
            className={copyBtn}
            onClick={() => copy(credentials.password, "pw")}
          >
            {copied === "pw" ? "Copied" : "Copy"}
          </button>
        </div>
        <div className={rowClass}>
          <span className="min-w-0 break-all text-body-sm text-body">
            <span className="text-muted">Site: </span>
            {SITE_URL}
          </span>
          <button
            type="button"
            className={copyBtn}
            onClick={() => copy(SITE_URL, "url")}
          >
            {copied === "url" ? "Copied" : "Copy"}
          </button>
        </div>
        <div className={rowClass}>
          <span className="min-w-0 break-all text-body-sm text-body">
            <span className="text-muted">Subject: </span>
            {subject}
          </span>
          <button
            type="button"
            className={copyBtn}
            onClick={() => copy(subject, "subject")}
          >
            {copied === "subject" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className={labelClass}>Email (editable)</span>
          <button
            type="button"
            className={copyBtn}
            onClick={() => copy(emailDraft, "email-body")}
          >
            {copied === "email-body" ? "Copied" : "Copy email"}
          </button>
        </div>
        <textarea
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
