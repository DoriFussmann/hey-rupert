"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteProspect, updateProspect } from "@/app/admin/prospect-actions";
import { PROSPECT_STATUSES, STATUS_LABEL, type ProspectStatus } from "@/lib/prospects/core";

export type RowProspect = {
  id: string;
  name: string | null;
  email: string;
  companyName: string | null;
  website: string | null;
  status: ProspectStatus;
  callId: string | null;
  callStart: string | null;
};

const primary = "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondary = "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const danger = "rounded-md bg-error px-md py-sm text-body-sm text-white transition-opacity duration-hover hover:opacity-90 disabled:opacity-40";
const label = "text-label uppercase tracking-label text-muted";
const field = "mt-xs w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";

// <input type="datetime-local"> works in the browser's own time zone.
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EDITABLE_STATUSES = PROSPECT_STATUSES.filter((s) => s !== "converted");

/** A row of the Calls booked table. Clicking it opens a modal to edit or delete the booked call. */
export function ProspectRow({ prospect, children }: { prospect: RowProspect; children: React.ReactNode }) {
  const router = useRouter();
  const titleId = useId();
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => initial(prospect));

  function initial(p: RowProspect) {
    return {
      name: p.name ?? "",
      email: p.email,
      companyName: p.companyName ?? "",
      website: p.website ?? "",
      status: p.status,
      callStart: toLocalInput(p.callStart),
    };
  }

  function open(next: "edit" | "delete") {
    if (mode) return;
    setError(null);
    setForm(initial(prospect));
    setMode(next);
  }

  function close() {
    if (pending) return;
    setMode(null);
    setError(null);
  }

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function save() {
    setError(null);
    const moved = prospect.callId && form.callStart && form.callStart !== toLocalInput(prospect.callStart);
    start(async () => {
      const r = await updateProspect(prospect.id, {
        name: form.name,
        email: form.email,
        companyName: form.companyName,
        website: form.website,
        status: form.status,
        callId: moved ? prospect.callId : null,
        callStart: moved ? new Date(form.callStart).toISOString() : null,
      });
      if (!r.ok) return setError(r.error);
      setMode(null);
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const r = await deleteProspect(prospect.id);
      if (!r.ok) return setError(r.error);
      setMode(null);
      router.refresh();
    });
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const who = prospect.name || prospect.email;

  return (
    <>
      <tr
        className="cursor-pointer border-b border-border last:border-b-0 transition-colors duration-hover hover:bg-background"
        // Events from the modal bubble here through the portal; only the row's own count.
        onClick={(e) => {
          if (e.currentTarget.contains(e.target as Node)) open("edit");
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            open("edit");
          }
        }}
        tabIndex={0}
        aria-label={`Edit ${prospect.name || prospect.email}`}
      >
        {children}
      </tr>

      {mode && typeof document !== "undefined"
        ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-heading/40 p-md" onClick={close} role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="animate-slide-in max-h-[85vh] w-full max-w-lg overflow-auto rounded-card border border-border bg-surface px-lg py-md text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {mode === "edit" ? (
              <>
                <h3 id={titleId} className="text-h4 text-heading">
                  Edit booked call
                </h3>
                <div className="mt-md grid gap-md sm:grid-cols-2">
                  <label className="block">
                    <span className={label}>Name</span>
                    <input className={field} value={form.name} onChange={set("name")} />
                  </label>
                  <label className="block">
                    <span className={label}>Email</span>
                    <input className={field} type="email" value={form.email} onChange={set("email")} />
                  </label>
                  <label className="block">
                    <span className={label}>Company</span>
                    <input className={field} value={form.companyName} onChange={set("companyName")} />
                  </label>
                  <label className="block">
                    <span className={label}>Website</span>
                    <input className={field} value={form.website} onChange={set("website")} />
                  </label>
                  <label className="block">
                    <span className={label}>Status</span>
                    <select className={field} value={form.status} onChange={set("status")}>
                      {EDITABLE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {prospect.callId ? (
                    <label className="block">
                      <span className={label}>Call time</span>
                      <input className={field} type="datetime-local" value={form.callStart} onChange={set("callStart")} />
                    </label>
                  ) : null}
                </div>
                {prospect.callId ? (
                  <p className="mt-sm text-body-sm text-muted">
                    Changing the time updates it here and reschedules the prep and check-in emails. It doesn&apos;t move the booking on Cal.com.
                  </p>
                ) : null}
                {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
                <div className="mt-md flex flex-wrap items-center justify-between gap-sm">
                  <div className="flex items-center gap-md">
                    <button
                      type="button"
                      className="rounded-md border border-error px-md py-sm text-body-sm text-error transition-colors duration-hover hover:bg-error hover:text-white disabled:opacity-40"
                      onClick={() => {
                        setError(null);
                        setMode("delete");
                      }}
                      disabled={pending}
                    >
                      Delete
                    </button>
                    <Link href={`/admin/prospects/${prospect.id}`} className="text-body-sm text-primary no-underline hover:text-primary-hover">
                      Brief &amp; follow-up →
                    </Link>
                  </div>
                  <div className="flex gap-sm">
                  <button type="button" className={secondary} onClick={close} disabled={pending}>
                    Cancel
                  </button>
                  <button type="button" className={primary} onClick={save} disabled={pending || !form.email.trim()}>
                    {pending ? "Saving…" : "Save"}
                  </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 id={titleId} className="text-h4 text-heading">
                  Delete {who}?
                </h3>
                <p className="mt-sm text-body-sm text-secondary">
                  This removes the prospect, their calls, brief and notes, and cancels any prep or check-in email still waiting to go out. It
                  doesn&apos;t cancel the booking on Cal.com. This cannot be undone.
                </p>
                {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
                <div className="mt-md flex justify-end gap-sm">
                  <button type="button" className={secondary} onClick={() => setMode("edit")} disabled={pending}>
                    Back
                  </button>
                  <button type="button" className={danger} onClick={remove} disabled={pending}>
                    {pending ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
