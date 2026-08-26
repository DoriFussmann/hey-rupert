"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientRecord } from "@/app/admin/actions";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";
const labelClass = "block text-label uppercase tracking-label text-muted";

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
};

export function AddClientButton() {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function update(field: keyof typeof emptyForm) {
    return (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    };
  }

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
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

      setForm(emptyForm);
      setOpen(false);
      setPending(false);
      setSuccess("Client added.");
      router.refresh();
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
            setError(null);
            setOpen(true);
          }}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover"
        >
          Add client
        </button>
        {success ? (
          <p className="text-body-sm text-success">{success}</p>
        ) : null}
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
                  Add client
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
                    placeholder="$500K–$1M"
                  />
                </label>
                <label className={labelClass}>
                  Raise stage
                  <select
                    className={fieldClass}
                    name="raise_stage"
                    value={form.raise_stage}
                    onChange={update("raise_stage")}
                  >
                    <option value="">Select</option>
                    <option value="Pre-seed">Pre-seed</option>
                    <option value="Seed">Seed</option>
                    <option value="Series A">Series A</option>
                  </select>
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
                  {pending ? "Adding…" : "Add client"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </>
  );
}
