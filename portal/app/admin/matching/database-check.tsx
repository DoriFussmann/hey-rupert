"use client";

import { useEffect, useState } from "react";
import { decideForGroup, decideOnInvestor, recordInvestmentsInDb, runInvestorCheck } from "@/app/admin/landscape-actions";
import { BUCKET_LABEL, type Bucket, type CheckRow } from "@/lib/match/landscape/check";
import { KIND_LABEL } from "@/lib/match/landscape/investors";
import type { CheckResult } from "@/lib/match/landscape/server";
import { inputClass, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { Card } from "@/app/admin/matching/dry-match";

const n = (value: number) => value.toLocaleString("en-US");
const backedText = (row: CheckRow) => Array.from(new Set(row.investor.backed.map((b) => b.competitor))).join(", ");

function host(url: string) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A website, opened in a new tab. */
function Site({ url, label }: { url: string | null | undefined; label?: string }) {
  if (!url) return null;
  const href = url.startsWith("http") ? url : `https://${url}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => event.stopPropagation()}
      className="text-primary underline decoration-primary/40 underline-offset-2 hover:text-primary-hover"
    >
      {label ? `${label}: ` : ""}
      {host(url)} ↗
    </a>
  );
}

const ORDER: Bucket[] = ["in_list", "not_in_list", "confirm", "missing_fund", "missing_angel"];
const TONE: Record<Bucket, string> = {
  confirm: "text-warning",
  in_list: "text-success",
  not_in_list: "text-heading",
  missing_fund: "text-heading",
  missing_angel: "text-heading",
};

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

/** Undo the admin's decision on this investor: back to its automatic match. */
function UndoLink({ row, busy, onDecide }: { row: CheckRow; busy: boolean; onDecide: (patch: Parameters<typeof decideOnInvestor>[2]) => void }) {
  if (!row.decision) return null;
  const at = row.decision.at ? new Date(row.decision.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
  return (
    <p className="mt-xs text-body-sm text-muted">
      Your decision{at ? ` (${at})` : ""}.{" "}
      <button type="button" disabled={busy} className="underline hover:text-heading" onClick={() => onDecide({ clear: true })}>
        Undo
      </button>
    </p>
  );
}

/** Inline website entry: the admin's own research. */
function WebsiteInput({ initial, busy, label, onSave }: { initial: string; busy: boolean; label: string; onSave: (url: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex flex-wrap items-center gap-xs"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSave(value.trim());
      }}
    >
      <input className={`${inputClass} max-w-xs`} placeholder="e.g. fundname.com" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="submit" disabled={busy || !value.trim() || value.trim() === initial} className={smallButton}>
        {label}
      </button>
    </form>
  );
}

/** A fund in the database but not in the shortlist: why, and the decision. */
function NotInListRow({ row, busy, onDecide }: { row: CheckRow; busy: boolean; onDecide: (patch: Parameters<typeof decideOnInvestor>[2]) => void }) {
  const [note, setNote] = useState(row.decision?.note ?? "");
  const [lesson, setLesson] = useState(row.decision?.lesson ?? false);
  const action = row.action;
  const noteChanged = note !== (row.decision?.note ?? "") || lesson !== (row.decision?.lesson ?? false);
  return (
    <tr className="border-t border-border align-top">
      <td className="py-sm pr-md">
        <p className="text-heading">{row.investor.name}</p>
        <p className="text-muted">Backed {backedText(row)}</p>
        <p className="text-muted">
          Database: {row.firmName}
          {row.decision?.firmId ? " (chosen by you)" : row.match.how === "website" ? " (same website)" : " (same name)"}
        </p>
        <p className="flex flex-wrap gap-x-md">
          <Site url={row.firmWeb} label="Database" />
          {row.investor.website && host(row.investor.website) !== host(row.firmWeb ?? "") ? <Site url={row.investor.website} label="Research" /> : null}
        </p>
        <UndoLink row={row} busy={busy} onDecide={onDecide} />
      </td>
      <td className="py-sm pr-md">
        {row.failure ? (
          <>
            <p className="text-heading">Removed at {row.failure.label}</p>
            <p className="text-secondary">Fund lists: {row.failure.fundValues}</p>
            {row.overlap.client.length ? (
              <p className="text-success">Lists {row.overlap.client.join(", ")}: the client&apos;s sector.</p>
            ) : row.failure.step === "sector" ? (
              <p className="text-warning">Backed a competitor, but lists none of the client&apos;s sectors.</p>
            ) : null}
            {row.overlap.competitor.length ? (
              <p className="text-secondary">Shares {row.overlap.competitor.join(", ")} with the competitor it backed.</p>
            ) : null}
          </>
        ) : (
          <p className="text-warning">Passes Step 1 today: the database changed after Step 1 was confirmed.</p>
        )}
      </td>
      <td className="py-sm">
        <p className="mb-xs text-body-sm text-muted">{row.defaulted ? "Default (not decided by you yet)" : "Your decision"}</p>
        <div className="flex flex-wrap gap-xs">
          <button
            type="button"
            disabled={busy}
            className={action === "bring_back" ? primaryButton : secondaryButton}
            onClick={() => onDecide({ action: "bring_back" })}
          >
            Bring back
          </button>
          <button
            type="button"
            disabled={busy}
            className={action === "leave_out" ? primaryButton : secondaryButton}
            onClick={() => onDecide({ action: "leave_out" })}
          >
            Leave out
          </button>
          <button type="button" disabled={busy} className={smallButton} onClick={() => onDecide({ firmId: null })} title="This database record is a different firm">
            Wrong match
          </button>
        </div>
        <textarea
          className={`${inputClass} mt-xs`}
          rows={2}
          placeholder="Why (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="mt-xs flex flex-wrap items-center justify-between gap-sm">
          <label className="flex items-center gap-xs text-body-sm text-secondary">
            <input type="checkbox" className="accent-primary" checked={lesson} onChange={(e) => setLesson(e.target.checked)} />
            Lesson for Rupert: the database or taxonomy needs fixing
          </label>
          {noteChanged ? (
            <button type="button" disabled={busy} className={smallButton} onClick={() => onDecide({ note, lesson })}>
              Save note
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/** An unclear match: pick the record, or say it isn't in the database. */
function ConfirmRow({ row, busy, onDecide }: { row: CheckRow; busy: boolean; onDecide: (patch: Parameters<typeof decideOnInvestor>[2]) => void }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="py-sm pr-md">
        <p className="text-heading">{row.investor.name}</p>
        <p className="text-muted">
          {KIND_LABEL[row.investor.kind]} · backed {backedText(row)}
        </p>
        <Site url={row.investor.website} label="Research" />
        <p className="text-muted">{row.match.how === "ambiguous" ? "More than one database record has this name or website." : "Similar names in the database."}</p>
      </td>
      <td className="py-sm" colSpan={2}>
        <div className="flex flex-wrap gap-xs">
          {row.candidates.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-xs rounded-md border border-border bg-surface pl-xs">
              <Site url={c.web} />
              <button type="button" disabled={busy} className={secondaryButton} onClick={() => onDecide({ firmId: c.id })}>
                It&apos;s {c.name}
              </button>
            </span>
          ))}
          <button type="button" disabled={busy} className={secondaryButton} onClick={() => onDecide({ firmId: null })}>
            Not in the database
          </button>
        </div>
        <div className="mt-sm">
          <p className="mb-xs text-body-sm text-muted">Neither? Give the correct website: it is matched again, and kept for adding it to the database.</p>
          <WebsiteInput initial="" busy={busy} label="Use this website" onSave={(url) => onDecide({ website: url, resetMatch: true })} />
        </div>
      </td>
    </tr>
  );
}

function SimpleRow({ row, busy, onDecide }: { row: CheckRow; busy: boolean; onDecide: (patch: Parameters<typeof decideOnInvestor>[2]) => void }) {
  const [editing, setEditing] = useState(false);
  const missing = row.bucket === "missing_fund" || row.bucket === "missing_angel";
  return (
    <tr className="border-t border-border align-top">
      <td className="py-xs pr-md text-heading">
        {row.investor.name}
        <UndoLink row={row} busy={busy} onDecide={onDecide} />
      </td>
      <td className="py-xs pr-md text-secondary">{KIND_LABEL[row.investor.kind]}</td>
      <td className="py-xs pr-md text-secondary">{backedText(row)}</td>
      <td className="py-xs text-secondary">
        {!missing ? (
          <span className="flex flex-col">
            <span>{row.firmName}</span>
            <Site url={row.firmWeb ?? row.investor.website} />
          </span>
        ) : editing ? (
          <WebsiteInput
            initial={row.investor.website ? host(row.investor.website) : ""}
            busy={busy}
            label="Save"
            onSave={(url) => {
              setEditing(false);
              onDecide({ website: url, resetMatch: true });
            }}
          />
        ) : (
          <span>
            {row.investor.website ? <Site url={row.investor.website} /> : <span className="text-muted">No website</span>}{" "}
            <button type="button" className="underline" onClick={() => setEditing(true)}>
              {row.investor.website ? "Edit" : "Add"}
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

type Reason = { key: string; label: string; rows: CheckRow[]; note: string };

const REASONS: Omit<Reason, "rows">[] = [
  { key: "sector_shared", label: "Sector only, lists the client's sector", note: "Backed a direct competitor and lists Secondary 1 or 2: brought back by default." },
  { key: "sector_none", label: "Sector only, no shared sector", note: "Backed a direct competitor, but lists none of the client's sectors: left out by default." },
  { key: "stage", label: "Stage", note: "A different stage: left out by default." },
  { key: "geography", label: "Geography", note: "Another geography: left out by default." },
  { key: "financing", label: "Financing", note: "Another financing type: left out by default." },
  { key: "none", label: "Passes Step 1 today", note: "The database changed after Step 1: left out by default." },
];

/** Which reason group a fund in the database but not in the shortlist falls in. */
function reasonOf(row: CheckRow) {
  const step = row.failure?.step ?? "none";
  return step === "sector" ? (row.overlap.client.length ? "sector_shared" : "sector_none") : step;
}

/** The funds of one reason group, in a modal, each with its details and decision. */
function ReasonModal({
  reason,
  rows,
  busy,
  onDecide,
  onClose,
}: {
  reason: Omit<Reason, "rows">;
  rows: CheckRow[];
  busy: boolean;
  onDecide: (investorId: string, patch: Parameters<typeof decideOnInvestor>[2]) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-heading/40 p-md" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={reason.label}
        className="animate-slide-in max-h-[88vh] w-full max-w-5xl overflow-auto rounded-card border border-border bg-surface px-lg py-md shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-md">
          <div>
            <h3 className="text-h3 text-heading">
              {reason.label} · {n(rows.length)}
            </h3>
            <p className="text-body-sm text-muted">{reason.note}</p>
          </div>
          <button type="button" className={smallButton} onClick={onClose}>
            Close
          </button>
        </div>
        {rows.length ? (
          <table className="mt-md w-full text-left text-body-sm">
            <thead className="text-label uppercase tracking-label text-muted">
              <tr>
                <th className="py-xs pr-md font-medium">Investor</th>
                <th className="py-xs pr-md font-medium">Why it isn&apos;t in the shortlist</th>
                <th className="py-xs font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <NotInListRow key={row.investor.id} row={row} busy={busy} onDecide={(p) => onDecide(row.investor.id, p)} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-md text-body-sm text-muted">No funds left in this group.</p>
        )}
      </div>
    </div>
  );
}

/** Funds in the database but not in the shortlist, by the Step 1 filter that removed them: the defaults, and "apply to all". */
function DecisionSummary({
  rows,
  busy,
  onGroup,
  onOpen,
}: {
  rows: CheckRow[];
  busy: boolean;
  onGroup: (ids: string[], action: "bring_back" | "leave_out" | null) => void;
  onOpen: (key: string) => void;
}) {
  const reasons: Reason[] = REASONS.map((r) => ({ ...r, rows: rows.filter((x) => reasonOf(x) === r.key) }))
    .filter((r) => r.rows.length);
  if (!reasons.length) return null;
  const count = (list: CheckRow[], a: "bring_back" | "leave_out") => list.filter((x) => x.action === a).length;
  const mine = (list: CheckRow[]) => list.filter((x) => !x.defaulted).length;
  return (
    <div className="mt-lg">
      <h4 className="text-label uppercase tracking-label text-muted">In the database, not in the shortlist: decisions</h4>
      <p className="text-body-sm text-muted">Click a row to see its funds and decide one by one.</p>
      <table className="mt-xs w-full text-left text-body-sm">
        <thead className="text-label uppercase tracking-label text-muted">
          <tr>
            <th className="py-xs pr-md font-medium">Removed at</th>
            <th className="py-xs pr-md text-right font-medium">Funds</th>
            <th className="py-xs pr-md text-right font-medium">Bring back</th>
            <th className="py-xs pr-md text-right font-medium">Leave out</th>
            <th className="py-xs pr-md text-right font-medium">Decided by you</th>
            <th className="py-xs font-medium" />
          </tr>
        </thead>
        <tbody>
          {reasons.map((r) => {
            const ids = r.rows.map((x) => x.investor.id);

            return (
              <tr
                key={r.key}
                tabIndex={0}
                className="cursor-pointer border-t border-border align-top hover:bg-background focus:bg-background focus:outline-none"
                onClick={() => onOpen(r.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(r.key);
                }}
              >
                <td className="py-xs pr-md">
                  <p className="text-heading underline decoration-border underline-offset-4">{r.label}</p>
                  <p className="text-muted">{r.note}</p>
                </td>
                <td className="py-xs pr-md text-right text-heading">{n(r.rows.length)}</td>
                <td className="py-xs pr-md text-right">{n(count(r.rows, "bring_back"))}</td>
                <td className="py-xs pr-md text-right">{n(count(r.rows, "leave_out"))}</td>
                <td className="py-xs pr-md text-right text-secondary">{n(mine(r.rows))}</td>
                <td className="py-xs text-right" onClick={(event) => event.stopPropagation()}>
                  <div className="flex flex-wrap justify-end gap-xs">
                    <button type="button" disabled={busy} className={smallButton} onClick={() => onGroup(ids, "bring_back")}>
                      Bring back all
                    </button>
                    <button type="button" disabled={busy} className={smallButton} onClick={() => onGroup(ids, "leave_out")}>
                      Leave out all
                    </button>
                    {mine(r.rows) ? (
                      <button type="button" disabled={busy} className={smallButton} onClick={() => onGroup(ids, null)}>
                        Back to default
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-primary">
            <td className="py-xs pr-md text-heading">All</td>
            <td className="py-xs pr-md text-right text-heading">{n(rows.length)}</td>
            <td className="py-xs pr-md text-right text-heading">{n(count(rows, "bring_back"))}</td>
            <td className="py-xs pr-md text-right text-heading">{n(count(rows, "leave_out"))}</td>
            <td className="py-xs pr-md text-right text-secondary">{n(mine(rows))}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Step 2C: each confirmed investor against the Fund Database and the Step 1
 * shortlist. Unclear matches are confirmed by the admin; funds in the
 * database but not in the shortlist show the Step 1 filter that removed them,
 * for a decision (and a lesson for Rupert when the data is wrong).
 */
export function DatabaseCheck({ clientId }: { clientId: string }) {
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The group open below the table: null = the default (what needs action), "none" = all closed. */
  const [show, setShow] = useState<Bucket | "none" | null>(null);
  const [openReason, setOpenReason] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void runInvestorCheck(clientId).then((result) => {
      if (!live) return;
      if (!result.ok) return setError(result.error);
      setCheck(result.check);
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  const decide = async (investorId: string, patch: Parameters<typeof decideOnInvestor>[2]) => {
    setBusy(true);
    setError(null);
    const result = await decideOnInvestor(clientId, investorId, patch);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCheck(result.check);
  };

  const group = async (ids: string[], action: "bring_back" | "leave_out" | null) => {
    setBusy(true);
    setError(null);
    const result = await decideForGroup(clientId, ids, action);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCheck(result.check);
  };

  const record = async () => {
    setBusy(true);
    setError(null);
    const result = await recordInvestmentsInDb(clientId);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCheck(result.check);
  };

  if (!check) {
    return (
      <Card>
        <h3 className="text-h4 text-heading">Check against the fund database</h3>
        {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : <p className="mt-sm text-body-sm text-muted">Checking every investor…</p>}
      </Card>
    );
  }

  const byBucket = (b: Bucket) => check.rows.filter((r) => r.bucket === b);
  const total = check.rows.length;
  const notInList = byBucket("not_in_list");
  const matchedInvestors = check.rows.filter((r) => r.firmId && (r.bucket === "in_list" || r.bucket === "not_in_list")).length;
  const current: Bucket | null = show === "none" ? null : show ?? (check.counts.confirm ? "confirm" : check.counts.not_in_list ? "not_in_list" : null);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h3 className="text-h4 text-heading">Check against the fund database</h3>
        <p className="text-body-sm text-muted">
          {n(check.rows.length)} investors · Step 1 list confirmed {new Date(check.dryConfirmedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
        </p>
      </div>
      <table className="mt-md w-full text-left text-body-sm">
        <thead className="text-label uppercase tracking-label text-muted">
          <tr>
            <th className="py-xs pr-md font-medium">Group</th>
            <th className="py-xs pr-md text-right font-medium">Investors</th>
            <th className="py-xs pr-md text-right font-medium">Share</th>
            <th className="py-xs font-medium" />
          </tr>
        </thead>
        <tbody>
          {ORDER.map((b) => (
            <tr
              key={b}
              tabIndex={0}
              aria-expanded={current === b}
              className={`cursor-pointer border-t border-border hover:bg-background ${current === b ? "bg-primary-tint/50" : ""}`}
              onClick={() => setShow(current === b ? "none" : b)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setShow(current === b ? "none" : b);
              }}
            >
              <td className={`py-xs pr-md ${TONE[b]}`}>{BUCKET_LABEL[b]}</td>
              <td className="py-xs pr-md text-right text-heading">{n(check.counts[b])}</td>
              <td className="py-xs pr-md text-right text-secondary">{pct(check.counts[b], total)}</td>
              <td className="py-xs text-right text-muted">{check.counts[b] ? (current === b ? "Hide ▴" : "Show ▾") : ""}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-primary">
            <td className="py-xs pr-md text-heading">All investors</td>
            <td className="py-xs pr-md text-right text-heading">{n(total)}</td>
            <td className="py-xs pr-md text-right text-secondary">100%</td>
            <td />
          </tr>
        </tbody>
      </table>
      <DecisionSummary rows={notInList} busy={busy} onGroup={(ids, action) => void group(ids, action)} onOpen={setOpenReason} />
      {openReason ? (
        <ReasonModal
          reason={REASONS.find((r) => r.key === openReason) ?? REASONS[0]}
          rows={notInList.filter((r) => reasonOf(r) === openReason)}
          busy={busy}
          onDecide={(id, patch) => void decide(id, patch)}
          onClose={() => setOpenReason(null)}
        />
      ) : null}

      <div className="mt-lg flex flex-wrap items-center justify-between gap-sm rounded-md border border-border bg-background px-md py-sm text-body-sm">
        <p className="text-secondary">
          <span className="text-heading">Investments, company-wide:</span> {n(matchedInvestors)} investors here are in the database. Recording saves
          which competitor each backed (round, lead, source) to the fund, as a portfolio fact. The fund&apos;s sectors don&apos;t change.
          {check.recorded === null ? " (Run supabase/fund_investments.sql first.)" : check.recorded ? ` ${n(check.recorded)} recorded so far.` : ""}
        </p>
        <button type="button" className={smallButton} disabled={busy || !matchedInvestors} onClick={() => void record()}>
          {check.recorded ? "Record again" : "Record in the database"}
        </button>
      </div>

      {current && byBucket(current).length ? (
        <section className="mt-lg">
          <h4 className="text-label uppercase tracking-label text-muted">
            {BUCKET_LABEL[current]} · {n(byBucket(current).length)}
          </h4>
          {current === "missing_fund" || current === "missing_angel" ? (
            <p className="mt-xs text-body-sm text-muted">Add the website where you have it. Try and Add to DB comes next: web search and Hunter.io, up to 5 contacts each.</p>
          ) : null}
          <table className="mt-xs w-full text-left text-body-sm">
            <tbody>
              {byBucket(current).map((row) =>
                current === "not_in_list" ? (
                  <NotInListRow key={row.investor.id} row={row} busy={busy} onDecide={(p) => void decide(row.investor.id, p)} />
                ) : current === "confirm" ? (
                  <ConfirmRow key={row.investor.id} row={row} busy={busy} onDecide={(p) => void decide(row.investor.id, p)} />
                ) : (
                  <SimpleRow key={row.investor.id} row={row} busy={busy} onDecide={(p) => void decide(row.investor.id, p)} />
                ),
              )}
            </tbody>
          </table>
        </section>
      ) : null}
      {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
    </Card>
  );
}
