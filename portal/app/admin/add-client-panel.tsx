"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientRecord } from "@/app/admin/actions";
import { Select } from "@/components/select";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";
const labelClass = "block text-label uppercase tracking-label text-muted";

// Base URL clients are told to visit. Set NEXT_PUBLIC_PORTAL_URL in the
// environment; falls back to the marketing site where the Login button lives.
const SITE_URL = (
  process.env.NEXT_PUBLIC_PORTAL_URL || "https://heyrupert.com"
).replace(/\/+$/, "");
const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");

const EMAIL_SUBJECT = "Your Rupert Portal & Statement of Work";

const emptyForm = {
  first_name: "",
  last_name: "",
  email: "",
  company_name: "",
  raise_amount: "",
  raise_stage: "",
  vertical: "",
  geography: "",
  fund_match_count: "",
  admin_notes: "",
  password: "",
};

// Readable, strong temporary password. Mirrors the server generator: no
// ambiguous characters, grouped for easy copy/paste and typing.
function generatePassword() {
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

type Created = {
  firstName: string;
  email: string;
  password: string;
  linked: boolean;
};

function buildEmail(created: Created) {
  const greetingName = created.firstName || "there";
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

Email: ${created.email}
Password: ${created.password}

Once logged in, you'll see your Statement of Work and onboarding steps.
///

Thanks again, ${greetingName}.

I'm looking forward to hopefully working together, and please reach out with any questions as you review everything.

Dori`;
}

export function AddClientButton() {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(true);
  const [created, setCreated] = useState<Created | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // Auto-generate a password whenever the panel is opened fresh.
  useEffect(() => {
    if (open && !created && !form.password) {
      setForm((current) => ({ ...current, password: generatePassword() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        close();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function update(field: keyof typeof emptyForm) {
    return (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    };
  }

  function resetAll() {
    setForm(emptyForm);
    setCreated(null);
    setEmailDraft("");
    setError(null);
    setPending(false);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    // Refresh the client list if we actually created someone this session.
    if (created) router.refresh();
    resetAll();
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const result = await createClientRecord(form);

      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }

      const createdInfo: Created = {
        firstName: form.first_name.trim(),
        email: result.email,
        password: result.password,
        linked: result.linked,
      };
      setCreated(createdInfo);
      setEmailDraft(buildEmail(createdInfo));
      setPending(false);
    } catch {
      setError("Unable to add the client. Please try again.");
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-sm">
        <button
          type="button"
          onClick={() => {
            resetAll();
            setOpen(true);
          }}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover"
        >
          Add client
        </button>
      </div>

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
                  Admin
                </p>
                <h2 id={titleId} className="mt-sm text-h3">
                  {created ? "Client ready - send the login" : "Add client"}
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

            {created ? (
              <SuccessView
                created={created}
                emailDraft={emailDraft}
                setEmailDraft={setEmailDraft}
                copied={copied}
                copy={copy}
                onAddAnother={() => {
                  resetAll();
                  setForm({ ...emptyForm, password: generatePassword() });
                }}
                onDone={close}
              />
            ) : (
              <form
                onSubmit={onSubmit}
                className="flex flex-1 flex-col overflow-hidden"
              >
                <div className="grid flex-1 gap-lg overflow-y-auto px-lg py-lg">
                  <label className={labelClass}>
                    First name
                    <input
                      className={fieldClass}
                      name="first_name"
                      value={form.first_name}
                      onChange={update("first_name")}
                      required
                      autoFocus
                    />
                  </label>
                  <label className={labelClass}>
                    Last name
                    <input
                      className={fieldClass}
                      name="last_name"
                      value={form.last_name}
                      onChange={update("last_name")}
                      required
                    />
                  </label>
                  <label className={labelClass}>
                    Email
                    <input
                      className={fieldClass}
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={update("email")}
                      required
                    />
                  </label>

                  <label className={labelClass}>
                    Password
                    <span className="mt-sm flex gap-sm">
                      <input
                        className={fieldClass + " mt-0 flex-1"}
                        name="password"
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={update("password")}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Auto-generated"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="rounded-md border border-border bg-surface px-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
                        aria-pressed={showPassword}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((c) => ({ ...c, password: generatePassword() }))
                        }
                        className="rounded-md border border-border bg-surface px-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
                      >
                        New
                      </button>
                    </span>
                    <span className="mt-sm block text-body-sm normal-case tracking-normal text-muted">
                      Set as their login password and included in the email. If
                      the email already has an account, this resets it.
                    </span>
                  </label>

                  <label className={labelClass}>
                    Company name
                    <input
                      className={fieldClass}
                      name="company_name"
                      value={form.company_name}
                      onChange={update("company_name")}
                      required
                    />
                  </label>
                  <label className={labelClass}>
                    Raise amount
                    <input
                      className={fieldClass}
                      name="raise_amount"
                      value={form.raise_amount}
                      onChange={update("raise_amount")}
                      placeholder="$500K-$1M"
                    />
                  </label>
                  <label className={labelClass}>
                    Raise stage
                    <Select
                      name="raise_stage"
                      value={form.raise_stage}
                      onChange={update("raise_stage")}
                    >
                      <option value="">Select</option>
                      <option value="Pre-seed">Pre-seed</option>
                      <option value="Seed">Seed</option>
                      <option value="Series A">Series A</option>
                    </Select>
                  </label>
                  <label className={labelClass}>
                    Vertical
                    <input
                      className={fieldClass}
                      name="vertical"
                      value={form.vertical}
                      onChange={update("vertical")}
                      placeholder="HealthTech"
                    />
                  </label>
                  <label className={labelClass}>
                    Geography
                    <input
                      className={fieldClass}
                      name="geography"
                      value={form.geography}
                      onChange={update("geography")}
                      placeholder="US + Europe"
                    />
                  </label>
                  <label className={labelClass}>
                    Fund match count
                    <input
                      className={fieldClass}
                      name="fund_match_count"
                      type="number"
                      min={0}
                      value={form.fund_match_count}
                      onChange={update("fund_match_count")}
                    />
                  </label>
                  <label className={labelClass}>
                    Admin notes
                    <textarea
                      className={fieldClass}
                      name="admin_notes"
                      rows={4}
                      value={form.admin_notes}
                      onChange={update("admin_notes")}
                    />
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
                    type="submit"
                    disabled={pending}
                    className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
                  >
                    {pending ? "Adding..." : "Add client"}
                  </button>
                </div>
              </form>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}

function SuccessView({
  created,
  emailDraft,
  setEmailDraft,
  copied,
  copy,
  onAddAnother,
  onDone,
}: {
  created: Created;
  emailDraft: string;
  setEmailDraft: (value: string) => void;
  copied: string | null;
  copy: (text: string, label: string) => void;
  onAddAnother: () => void;
  onDone: () => void;
}) {
  const rowClass =
    "flex items-center justify-between gap-sm rounded-md border border-border bg-background px-sm py-sm";
  const copyBtn =
    "shrink-0 rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="grid flex-1 gap-lg overflow-y-auto px-lg py-lg">
        <p className="text-body-sm text-success">
          {created.linked
            ? "Linked to the existing login and set a new password."
            : "Client created."}{" "}
          Send them these details to log in.
        </p>

        <div className="grid gap-sm">
          <div className={rowClass}>
            <span className="min-w-0 break-all text-body-sm text-body">
              <span className="text-muted">Email: </span>
              {created.email}
            </span>
            <button
              type="button"
              className={copyBtn}
              onClick={() => copy(created.email, "email-addr")}
            >
              {copied === "email-addr" ? "Copied" : "Copy"}
            </button>
          </div>
          <div className={rowClass}>
            <span className="min-w-0 break-all font-mono text-body-sm text-body">
              <span className="font-sans text-muted">Password: </span>
              {created.password}
            </span>
            <button
              type="button"
              className={copyBtn}
              onClick={() => copy(created.password, "pw")}
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
              {EMAIL_SUBJECT}
            </span>
            <button
              type="button"
              className={copyBtn}
              onClick={() => copy(EMAIL_SUBJECT, "subject")}
            >
              {copied === "subject" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className={labelClass}>Onboarding email (editable)</span>
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
            rows={20}
            value={emailDraft}
            onChange={(event) => setEmailDraft(event.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-sm border-t border-border px-lg py-lg">
        <button
          type="button"
          onClick={onAddAnother}
          className="mr-auto rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
        >
          Add another
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover"
        >
          Done
        </button>
      </div>
    </div>
  );
}
