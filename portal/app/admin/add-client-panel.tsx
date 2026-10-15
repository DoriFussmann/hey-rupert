"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createClientRecord,
  sendDefaultStatementOfWork,
} from "@/app/admin/actions";
import { Select } from "@/components/select";
import {
  SetupLinkResult,
  buildWelcomeEmail,
  type SetupLinkDetails,
} from "@/app/admin/setup-link-result";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";
const labelClass = "block text-label uppercase tracking-label text-muted";
const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

const emptyForm = {
  first_name: "",
  last_name: "",
  email: "",
  company_name: "",
  company_website: "",
  raise_amount: "",
  raise_stage: "",
  vertical: "",
  geography: "",
  fund_match_count: "",
  admin_notes: "",
};

type TextField = keyof typeof emptyForm;

type Created = {
  clientId: string;
  testPilot: boolean;
  linked: boolean;
  email: string;
  /** Set-password details; none for a test pilot client. */
  setup: SetupLinkDetails | null;
};

type SowState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "sent"; emailed: boolean }
  | { kind: "error"; text: string };

function RequiredMark() {
  return (
    <span className="text-error" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

/** Generate & send the Statement of Work right after the client is added. */
function SendSowStep({ clientId, testPilot }: { clientId: string; testPilot: boolean }) {
  const [state, setState] = useState<SowState>({ kind: "idle" });

  async function send() {
    setState({ kind: "pending" });
    try {
      const result = await sendDefaultStatementOfWork(clientId);
      setState(
        result.ok
          ? { kind: "sent", emailed: result.clientEmail.ok }
          : { kind: "error", text: result.error },
      );
    } catch (err) {
      setState({
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to send the Statement of Work.",
      });
    }
  }

  return (
    <section className="rounded-card border border-primary/30 bg-primary-tint px-md py-md">
      <p className="text-label uppercase tracking-label text-primary">Next step</p>
      <p className="mt-xs text-body-sm text-heading">
        Send the Statement of Work, generated from your Forms template.
      </p>
      <div className="mt-sm flex flex-wrap items-center gap-sm">
        <button
          type="button"
          className={primaryButton}
          disabled={state.kind === "pending" || state.kind === "sent"}
          onClick={() => void send()}
        >
          {state.kind === "pending"
            ? "Sending…"
            : state.kind === "sent"
              ? "Statement of Work sent"
              : "Generate & send SoW"}
        </button>
        <Link
          href={`/admin/clients/${clientId}`}
          className="text-body-sm text-primary no-underline hover:text-primary-hover"
        >
          Edit it first on the client page
        </Link>
      </div>
      {state.kind === "sent" ? (
        <p role="status" className="mt-sm text-body-sm text-success">
          {testPilot || !state.emailed
            ? "In the client's portal."
            : "In the client's portal, and the client was emailed."}
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p role="alert" className="mt-sm text-body-sm text-error">
          {state.text}
        </p>
      ) : null}
    </section>
  );
}

export function AddClientButton() {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [testPilot, setTestPilot] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [emailDraft, setEmailDraft] = useState("");

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

  function update(field: TextField) {
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
    setTestPilot(false);
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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const result = await createClientRecord({ ...form, is_test_pilot: testPilot });

      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }

      const setup =
        result.setupUrl && result.expiresAt
          ? {
              firstName: form.first_name.trim(),
              email: result.email,
              setupUrl: result.setupUrl,
              expiresAt: result.expiresAt,
            }
          : null;
      setCreated({
        clientId: result.clientId,
        testPilot: result.testPilot,
        linked: result.linked,
        email: result.email,
        setup,
      });
      setEmailDraft(setup ? buildWelcomeEmail(setup) : "");
      setPending(false);
    } catch {
      setError("Unable to add the client. Please try again.");
      setPending(false);
    }
  }

  const required = !testPilot;

  return (
    <>
      <div className="flex flex-col items-end gap-sm">
        <button
          type="button"
          onClick={() => {
            resetAll();
            setOpen(true);
          }}
          className={primaryButton}
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
                  {created
                    ? created.testPilot
                      ? "Test Pilot Client Created"
                      : "New Client & Portal Created"
                    : "Add client"}
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
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="grid flex-1 content-start gap-lg overflow-y-auto px-lg py-lg">
                  <p role="status" className="text-body-sm text-success">
                    {created.testPilot
                      ? "Test pilot client created. Client emails and reminders are off. Run the steps from the client page."
                      : `${
                          created.linked
                            ? "Linked to the login that already existed for this email."
                            : "Client and portal login created."
                        } Send them the link below to set their password.`}
                  </p>
                  <SendSowStep clientId={created.clientId} testPilot={created.testPilot} />
                  {created.setup ? (
                    <SetupLinkResult
                      details={created.setup}
                      emailDraft={emailDraft}
                      setEmailDraft={setEmailDraft}
                    />
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-sm border-t border-border px-lg py-lg">
                  <button
                    type="button"
                    onClick={() => {
                      router.refresh();
                      resetAll();
                    }}
                    className={`mr-auto ${secondaryButton}`}
                  >
                    Add another
                  </button>
                  <Link
                    href={`/admin/clients/${created.clientId}`}
                    className={`${secondaryButton} no-underline`}
                  >
                    Open client
                  </Link>
                  <button type="button" onClick={close} className={primaryButton}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={onSubmit}
                className="flex flex-1 flex-col overflow-hidden"
              >
                <div className="grid flex-1 content-start gap-lg overflow-y-auto px-lg py-lg">
                  <label className="flex items-start gap-sm rounded-card border border-border bg-background px-md py-md">
                    <input
                      type="checkbox"
                      className="mt-xs h-4 w-4 shrink-0 accent-primary"
                      checked={testPilot}
                      onChange={(event) => setTestPilot(event.target.checked)}
                    />
                    <span>
                      <span className="block text-body-sm text-heading">Test pilot</span>
                      <span className="mt-xs block text-body-sm text-muted">
                        An internal test client. You complete the client&apos;s steps from the
                        client page, with content filled in from the company website. No
                        emails, no reminders, no invoice.
                      </span>
                    </span>
                  </label>
                  <p className="text-body-sm text-muted">
                    <span className="text-error">*</span> Required.
                    {testPilot
                      ? " Name and email are optional for a test pilot."
                      : " A set-password link is created for the client."}
                  </p>
                  <label className={labelClass}>
                    First name
                    {required ? <RequiredMark /> : null}
                    <input
                      className={fieldClass}
                      name="first_name"
                      value={form.first_name}
                      onChange={update("first_name")}
                      required={required}
                      autoFocus
                    />
                  </label>
                  <label className={labelClass}>
                    Last name
                    {required ? <RequiredMark /> : null}
                    <input
                      className={fieldClass}
                      name="last_name"
                      value={form.last_name}
                      onChange={update("last_name")}
                      required={required}
                    />
                  </label>
                  <label className={labelClass}>
                    Email
                    {required ? <RequiredMark /> : null}
                    <input
                      className={fieldClass}
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={update("email")}
                      required={required}
                      placeholder={testPilot ? "Optional: a placeholder login is used" : undefined}
                    />
                  </label>

                  <label className={labelClass}>
                    Company name
                    <RequiredMark />
                    <input
                      className={fieldClass}
                      name="company_name"
                      value={form.company_name}
                      onChange={update("company_name")}
                      required
                    />
                  </label>
                  <label className={labelClass}>
                    Company website
                    <input
                      className={fieldClass}
                      name="company_website"
                      value={form.company_website}
                      onChange={update("company_website")}
                      placeholder="acme.com"
                      inputMode="url"
                    />
                    <span className="mt-xs block text-body-sm normal-case tracking-normal text-muted">
                      {testPilot
                        ? "Recommended: the test intake and materials are written from this site."
                        : "Used by the intake and matching."}
                    </span>
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
                    <p role="alert" className="mr-auto text-body-sm text-error">
                      {error}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={close}
                    disabled={pending}
                    className={secondaryButton}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={pending} className={primaryButton}>
                    {pending ? "Adding..." : testPilot ? "Add test pilot" : "Add client"}
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
