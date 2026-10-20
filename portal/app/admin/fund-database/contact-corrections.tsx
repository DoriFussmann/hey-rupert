"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearContactFlag,
  removeCorrection,
  updateCorrection,
  updateLeadStatus,
} from "@/app/admin/verify-actions";
import { formatDateAtTime } from "@/lib/format";
import type { CorrectionRow, LeadRow } from "@/lib/match/verify";
import { websiteHref } from "@/lib/setup";

const inputClass =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";
const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const primarySmall =
  "rounded-md bg-primary px-sm py-xs text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";

const PAGE = 25;

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

type Run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => Promise<boolean>;

function useAction(): { pending: boolean; error: string | null; run: Run } {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run: Run = async (action) => {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(errorText(err, "Something went wrong."));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, error, run };
}

function CorrectionItem({ row }: { row: CorrectionRow }) {
  const { pending, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    email: row.email ?? "",
    firstName: row.firstName ?? "",
    lastName: row.lastName ?? "",
    title: row.title ?? "",
    note: row.note ?? "",
  });
  const fixes = [
    row.email ? `Email → ${row.email}` : "",
    row.firstName || row.lastName ? `Name → ${[row.firstName, row.lastName].filter(Boolean).join(" ")}` : "",
    row.title ? `Title → ${row.title}` : "",
  ].filter(Boolean);
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <li className="border-t border-border px-lg py-md text-body-sm">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <p>
            <span className="text-heading">{row.personName || row.key}</span>
            <span className="text-muted"> · {row.firmName || row.firmId} · {row.key}</span>
          </p>
          {row.flag ? (
            <p className={row.flag === "left_firm" ? "text-error" : "text-warning"}>
              {row.flag === "left_firm" ? "Left this fund: hidden for every client" : "Removed for a client: asked about next time"}
              {row.flagReason ? ` · ${row.flagReason}` : ""}
            </p>
          ) : null}
          {fixes.length > 0 ? <p className="text-secondary">{fixes.join(" · ")}</p> : null}
          {row.note ? <p className="text-muted">Note: {row.note}</p> : null}
          {!row.inDatabase ? (
            <p className="text-warning">No longer in the database: the current workbook has no contact with this FirmID and email.</p>
          ) : null}
          <p className="text-muted">
            {formatDateAtTime(row.updatedAt)}
            {row.updatedBy ? ` · ${row.updatedBy}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-xs">
          <button type="button" className={smallButton} disabled={pending} onClick={() => setEditing((value) => !value)}>
            {editing ? "Cancel" : "Edit"}
          </button>
          {row.flag ? (
            <button
              type="button"
              className={smallButton}
              disabled={pending}
              onClick={() => void run(() => clearContactFlag(row.firmId, row.key))}
            >
              {row.flag === "left_firm" ? "Restore to fund" : "Clear flag"}
            </button>
          ) : null}
          <button
            type="button"
            className={smallButton}
            disabled={pending}
            onClick={() => void run(() => removeCorrection(row.firmId, row.key))}
          >
            Undo all
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="mt-sm grid gap-sm sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => updateCorrection(row.firmId, row.key, draft)).then((ok) => {
              if (ok) setEditing(false);
            });
          }}
        >
          <input type="email" aria-label="Email" placeholder="Email (empty = database value)" className={inputClass} value={draft.email} maxLength={254} onChange={(event) => set({ email: event.target.value })} />
          <input aria-label="First name" placeholder="First name" className={inputClass} value={draft.firstName} maxLength={100} onChange={(event) => set({ firstName: event.target.value })} />
          <input aria-label="Last name" placeholder="Last name" className={inputClass} value={draft.lastName} maxLength={100} onChange={(event) => set({ lastName: event.target.value })} />
          <input aria-label="Title" placeholder="Title" className={inputClass} value={draft.title} maxLength={200} onChange={(event) => set({ title: event.target.value })} />
          <input aria-label="Note" placeholder="Note" className={inputClass} value={draft.note} maxLength={1000} onChange={(event) => set({ note: event.target.value })} />
          <div className="sm:col-span-2 lg:col-span-5">
            <button type="submit" className={primarySmall} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-xs text-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}

const LEAD_STATUS: Record<LeadRow["status"], string> = {
  new: "New",
  added: "Added to the database",
  dismissed: "Dismissed",
};

function LeadItem({ lead }: { lead: LeadRow }) {
  const { pending, error, run } = useAction();
  const website = websiteHref(lead.newFirmWebsite);
  return (
    <li className={`border-t border-border px-lg py-md text-body-sm ${lead.status === "new" ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <p>
            <span className="text-heading">{lead.personName}</span>
            {lead.title ? <span className="text-secondary"> · {lead.title}</span> : null}
            <span className="text-secondary"> at </span>
            {website ? (
              <a href={website} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-hover">
                {lead.newFirm} ↗
              </a>
            ) : (
              <span className="text-heading">{lead.newFirm}</span>
            )}
          </p>
          <p className="text-muted">
            Was at {lead.fromFirmName} · {lead.oldEmail} · {formatDateAtTime(lead.createdAt)}
          </p>
          {lead.evidence.length > 0 ? (
            <p className="flex flex-wrap gap-x-sm">
              {lead.evidence.map((item, index) => (
                <a
                  key={`${item.url}-${index}`}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary-hover"
                  title={item.note || item.url}
                >
                  Source {index + 1} ↗
                </a>
              ))}
            </p>
          ) : null}
          <p className={lead.status === "new" ? "text-primary" : "text-muted"}>{LEAD_STATUS[lead.status]}</p>
        </div>
        <div className="flex flex-wrap gap-xs">
          {lead.status === "new" ? (
            <>
              <button type="button" className={smallButton} disabled={pending} onClick={() => void run(() => updateLeadStatus(lead.id, "added"))}>
                Mark added
              </button>
              <button type="button" className={smallButton} disabled={pending} onClick={() => void run(() => updateLeadStatus(lead.id, "dismissed"))}>
                Dismiss
              </button>
            </>
          ) : (
            <button type="button" className={smallButton} disabled={pending} onClick={() => void run(() => updateLeadStatus(lead.id, "new"))}>
              Reopen
            </button>
          )}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-xs text-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Fixes, flags and new leads from Email Verification, above the workbook tools. */
export function ContactCorrections({
  corrections,
  leads,
  error,
}: {
  corrections: CorrectionRow[];
  leads: LeadRow[];
  error: string | null;
}) {
  const [shownFixes, setShownFixes] = useState(PAGE);
  const [shownLeads, setShownLeads] = useState(PAGE);
  const openLeads = leads.filter((lead) => lead.status === "new").length;

  if (error) {
    return (
      <p role="alert" className="mb-lg rounded-card border border-error/40 bg-surface px-lg py-md text-body-sm text-error">
        {error}
      </p>
    );
  }

  return (
    <div className="mb-lg space-y-lg">
      <section className="rounded-card border border-border bg-surface">
        <div className="px-lg py-md">
          <h2 className="text-h4 text-heading">Contact corrections & flags · {corrections.length.toLocaleString("en-US")}</h2>
          <p className="text-body-sm text-muted">
            Fixes from Email Verification, applied on top of the workbook for every client (they survive new uploads).
            They take effect on each client&apos;s next match run.
          </p>
        </div>
        {corrections.length === 0 ? (
          <p className="border-t border-border px-lg py-md text-body-sm text-muted">
            None yet. Removing or fixing a contact in Verify emails adds it here.
          </p>
        ) : (
          <ul>
            {corrections.slice(0, shownFixes).map((row) => (
              <CorrectionItem key={`${row.firmId}|${row.key}`} row={row} />
            ))}
          </ul>
        )}
        {corrections.length > shownFixes ? (
          <div className="border-t border-border px-lg py-md">
            <button type="button" className={smallButton} onClick={() => setShownFixes((value) => value + PAGE)}>
              Show more ({(corrections.length - shownFixes).toLocaleString("en-US")} left)
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-card border border-border bg-surface">
        <div className="px-lg py-md">
          <h2 className="text-h4 text-heading">
            New leads · {openLeads.toLocaleString("en-US")} to add
          </h2>
          <p className="text-body-sm text-muted">
            People who moved to another firm. Add them to the next workbook, then mark them added.
          </p>
        </div>
        {leads.length === 0 ? (
          <p className="border-t border-border px-lg py-md text-body-sm text-muted">
            None yet. &ldquo;Update firm&rdquo; in Verify emails adds the person here.
          </p>
        ) : (
          <ul>
            {leads.slice(0, shownLeads).map((lead) => (
              <LeadItem key={lead.id} lead={lead} />
            ))}
          </ul>
        )}
        {leads.length > shownLeads ? (
          <div className="border-t border-border px-lg py-md">
            <button type="button" className={smallButton} onClick={() => setShownLeads((value) => value + PAGE)}>
              Show more ({(leads.length - shownLeads).toLocaleString("en-US")} left)
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
