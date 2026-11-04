"use client";

import { useEffect, useState } from "react";
import { addInvestorToDb, applyDefaultsToAll, confirmAddedStep, confirmInvestorCheck, loadLookAlikes, decideForGroup, decideOnInvestor, findWebsitesFor, recordInvestmentsInDb, runInvestorCheck } from "@/app/admin/landscape-actions";
import { BUCKET_LABEL, type Bucket, type CheckRow } from "@/lib/match/landscape/check";
import { KIND_LABEL } from "@/lib/match/landscape/investors";
import type { CheckResult, LookAlikePreview } from "@/lib/match/landscape/server";
import { inputClass, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { BigNumber, Card } from "@/app/admin/matching/dry-match";
import { useStepSignal } from "@/app/admin/matching/step-signal";

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

const ORDER: Bucket[] = ["in_list", "not_in_list", "confirm", "missing_fund", "missing_angel", "added"];
const TONE: Record<Bucket, string> = {
  confirm: "text-warning",
  in_list: "text-success",
  not_in_list: "text-heading",
  missing_fund: "text-heading",
  missing_angel: "text-heading",
  added: "text-success",
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

const CONFIDENCE_TONE = { high: "text-success", medium: "text-warning", low: "text-error" } as const;

/** Find websites' answer, first: the website, how sure, where it was found, the portfolio page, and one click to accept. */
function SuggestionBlock({ row, busy, onDecide }: { row: CheckRow; busy: boolean; onDecide: (patch: Parameters<typeof decideOnInvestor>[2]) => void }) {
  const s = row.suggestion;
  if (!s) return null;
  if (!s.website) return <p className="mb-sm text-body-sm text-muted">Find websites: no website found{s.note && s.note !== "Not found." ? ` (${s.note})` : ""}.</p>;
  return (
    <div className="mb-sm rounded-md border border-primary/30 bg-primary-tint/40 px-md py-sm">
      <p className="flex flex-wrap items-center gap-x-md gap-y-xs text-body-sm">
        <span className="text-muted">Suggested website</span>
        <Site url={s.website} />
        <span className={CONFIDENCE_TONE[s.confidence]}>{s.confidence} confidence</span>
        {s.link === "broken" ? <span className="text-error">site didn&apos;t open</span> : null}
        {s.portfolioUrl ? <Site url={s.portfolioUrl} label="Portfolio" /> : <span className="text-muted">portfolio not found</span>}
        {s.foundIn ? <Site url={s.foundIn} label="Found in" /> : null}
      </p>
      {s.note ? <p className="mt-xs text-body-sm text-secondary">{s.note}</p> : null}
      <div className="mt-sm flex flex-wrap gap-xs">
        {s.firm ? (
          <button type="button" disabled={busy} className={primaryButton} onClick={() => onDecide({ firmId: s.firm!.id })}>
            Yes, it&apos;s {s.firm.name} (in the database)
          </button>
        ) : (
          <button type="button" disabled={busy} className={primaryButton} onClick={() => onDecide({ website: s.website, resetMatch: true })}>
            {s.firmCount > 1 ? `Use this website (${s.firmCount} database records have it: you'll pick one)` : "Use this website (not in the database)"}
          </button>
        )}
      </div>
    </div>
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
              <p className="text-success">Lists {row.overlap.client.join(", ")}: the client&apos;s sub-sectors.</p>
            ) : row.failure.step === "sector" ? (
              <p className="text-warning">Backed a competitor, but lists none of the client&apos;s sub-sectors.</p>
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
          <button
            type="button"
            disabled={busy}
            className={row.unsure ? `${smallButton} !border-warning text-warning` : smallButton}
            onClick={() => onDecide({ unsure: !row.unsure })}
          >
            {row.unsure ? "Not sure ✓" : "Not sure"}
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
        <SuggestionBlock row={row} busy={busy} onDecide={onDecide} />
        {row.suggestion?.website ? <p className="mb-xs text-body-sm text-muted">Other options</p> : null}
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
          <button
            type="button"
            disabled={busy}
            className={row.unsure ? `${secondaryButton} !border-warning text-warning` : secondaryButton}
            onClick={() => onDecide({ unsure: !row.unsure })}
          >
            {row.unsure ? "Not sure ✓ (later)" : "Not sure"}
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

function SimpleRow({
  row,
  busy,
  onDecide,
  onAdd,
  adding,
  addDisabled,
}: {
  row: CheckRow;
  busy: boolean;
  onDecide: (patch: Parameters<typeof decideOnInvestor>[2]) => void;
  onAdd?: () => void;
  adding?: boolean;
  /** Adding stays available after the check is confirmed (it's the next step). */
  addDisabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const missing = row.bucket === "missing_fund" || row.bucket === "missing_angel";
  if (row.bucket === "added" && row.added) {
    return (
      <tr className="border-t border-border align-top">
        <td className="py-xs pr-md text-heading">{row.investor.name}</td>
        <td className="py-xs pr-md text-secondary">{KIND_LABEL[row.investor.kind]}</td>
        <td className="py-xs pr-md text-secondary">{backedText(row)}</td>
        <td className="py-xs text-secondary">
          <span className={row.added.status === "approved" ? "text-success" : "text-warning"}>
            {row.added.status === "approved" ? "Approved: in the shared database" : "Pending review"}
          </span>
          {" · "}
          {n(row.added.contacts)} {row.added.contacts === 1 ? "contact" : "contacts"} · <Site url={row.added.website} />{" "}
          <a href="/admin/fund-database#added-by-rupert" className="underline">
            Review
          </a>
        </td>
      </tr>
    );
  }
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
        ) : row.suggestion?.website && row.suggestion.website !== row.investor.website ? (
          <SuggestionBlock row={row} busy={busy} onDecide={onDecide} />
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
      {missing && onAdd ? (
        <td className="py-xs pl-md text-right">
          <button type="button" disabled={addDisabled || adding} className={smallButton} onClick={onAdd}>
            {adding ? "Adding…" : "Try and Add to DB"}
          </button>
        </td>
      ) : null}
    </tr>
  );
}

/**
 * Funds in the database but not in the shortlist, as a queue: those still to
 * decide on top; a fund leaves the queue the moment it is decided and goes
 * to "Decided" below, folded away.
 */
function DecisionQueue({
  rows,
  busy,
  onDecide,
}: {
  rows: CheckRow[];
  busy: boolean;
  onDecide: (row: CheckRow, patch: Parameters<typeof decideOnInvestor>[2]) => void;
}) {
  const [showDecided, setShowDecided] = useState(false);
  const todo = rows.filter((r) => r.defaulted && !r.unsure);
  const later = rows.filter((r) => r.unsure);
  const done = rows.filter((r) => !r.defaulted);
  const head = (
    <thead className="text-label uppercase tracking-label text-muted">
      <tr>
        <th className="py-xs pr-md font-medium">Investor</th>
        <th className="py-xs pr-md font-medium">Why it isn&apos;t in the shortlist</th>
        <th className="py-xs font-medium">Decision</th>
      </tr>
    </thead>
  );
  return (
    <>
      {todo.length ? (
        <>
          <p className="mt-md text-body-sm text-warning">{n(todo.length)} to decide</p>
          <table className="mt-xs w-full text-left text-body-sm">
            {head}
            <tbody>
              {todo.map((row) => (
                <NotInListRow key={row.investor.id} row={row} busy={busy} onDecide={(p) => onDecide(row, p)} />
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="mt-md text-body-sm text-success">✓ Nothing left to decide here.</p>
      )}
      {later.length ? (
        <div className="mt-md border-t border-border pt-sm">
          <p className="text-body-sm text-warning">Not sure · {n(later.length)} (decide later)</p>
          <table className="mt-xs w-full text-left text-body-sm">
            {head}
            <tbody>
              {later.map((row) => (
                <NotInListRow key={row.investor.id} row={row} busy={busy} onDecide={(p) => onDecide(row, p)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {done.length ? (
        <div className="mt-md border-t border-border pt-sm">
          <button type="button" className="text-body-sm text-secondary underline hover:text-heading" onClick={() => setShowDecided(!showDecided)}>
            {showDecided ? "Hide" : "Show"} decided ({n(done.length)}: {n(done.filter((r) => r.action === "bring_back").length)} brought back,{" "}
            {n(done.filter((r) => r.action === "leave_out").length)} left out)
          </button>
          {showDecided ? (
            <table className="mt-xs w-full text-left text-body-sm opacity-80">
              {head}
              <tbody>
                {done.map((row) => (
                  <NotInListRow key={row.investor.id} row={row} busy={busy} onDecide={(p) => onDecide(row, p)} />
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** A short confirmation in the corner after every saved decision. */
function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="status" aria-live="polite" className="animate-slide-in fixed bottom-lg right-lg z-[60] rounded-md border border-success/40 bg-surface px-md py-sm text-body-sm text-success shadow-lg">
      ✓ {text}
    </div>
  );
}

type Reason = { key: string; label: string; rows: CheckRow[]; note: string };

const REASONS: Omit<Reason, "rows">[] = [
  { key: "sector_shared", label: "Sector only, lists the client's sub-sector", note: "Backed a direct competitor and lists Secondary 1 or 2: brought back by default." },
  { key: "sector_none", label: "Sector only, no shared sub-sector", note: "Backed a direct competitor, but lists none of the client's sub-sectors: left out by default." },
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
          <DecisionQueue rows={rows} busy={busy} onDecide={(row, p) => onDecide(row.investor.id, p)} />
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
  onApplyDefaults,
}: {
  rows: CheckRow[];
  busy: boolean;
  onGroup: (ids: string[], action: "bring_back" | "leave_out" | null) => void;
  onOpen: (key: string) => void;
  onApplyDefaults: () => void;
}) {
  const reasons: Reason[] = REASONS.map((r) => ({ ...r, rows: rows.filter((x) => reasonOf(x) === r.key) }))
    .filter((r) => r.rows.length);
  if (!reasons.length) return null;
  const count = (list: CheckRow[], a: "bring_back" | "leave_out") => list.filter((x) => x.action === a).length;
  const mine = (list: CheckRow[]) => list.filter((x) => !x.defaulted).length;
  return (
    <div className="mt-lg">
      <h4 className="text-label uppercase tracking-label text-muted">In the database, not in the shortlist: decisions</h4>
      <p className="text-body-sm">
        <span className={rows.length - mine(rows) ? "text-warning" : "text-success"}>
          {rows.length - mine(rows) ? `${n(rows.length - mine(rows))} of ${n(rows.length)} still to decide` : `All ${n(rows.length)} decided`}
        </span>
        <span className="text-muted">
          {" "}
          · Click a row to see its funds.
        </span>
      </p>
      {rows.length - mine(rows) ? (
        <div className="mt-xs flex flex-wrap items-center gap-sm">
          <button type="button" className={primaryButton} disabled={busy} onClick={onApplyDefaults}>
            Apply Default to All
          </button>
          <span className="text-body-sm text-muted">
            The {n(rows.length - mine(rows))} still to decide (Not sure included) take their default: {n(rows.filter((x) => x.defaulted && x.action === "bring_back").length)} brought back,{" "}
            {n(rows.filter((x) => x.defaulted && x.action === "leave_out").length)} left out. Decisions already made stay.
          </span>
        </div>
      ) : null}
      <table className="mt-xs w-full text-left text-body-sm">
        <thead className="text-label uppercase tracking-label text-muted">
          <tr>
            <th className="py-xs pr-md font-medium">Removed at</th>
            <th className="py-xs pr-md text-right font-medium">Funds</th>
            <th className="py-xs pr-md text-right font-medium">Bring back</th>
            <th className="py-xs pr-md text-right font-medium">Leave out</th>
            <th className="py-xs pr-md text-right font-medium">Decided</th>
            <th className="py-xs pr-md text-right font-medium">To decide</th>
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
                className={`cursor-pointer border-t border-border align-top hover:bg-background focus:bg-background focus:outline-none ${mine(r.rows) === r.rows.length ? "bg-success/5" : ""}`}
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
                <td className={`py-xs pr-md text-right ${r.rows.length - mine(r.rows) ? "text-warning" : "text-success"}`}>
                  {r.rows.length - mine(r.rows) ? n(r.rows.length - mine(r.rows)) : "✓"}
                </td>
                <td className="py-xs text-right" onClick={(event) => event.stopPropagation()}>
                  {(() => {
                    const decidedAll = mine(r.rows) === r.rows.length;
                    const allBack = decidedAll && count(r.rows, "bring_back") === r.rows.length;
                    const allOut = decidedAll && count(r.rows, "leave_out") === r.rows.length;
                    const seg = "px-sm py-[3px] text-body-sm transition-colors duration-hover disabled:cursor-default";
                    return (
                      <div className="inline-flex flex-col items-end gap-xs">
                        <div className="inline-flex overflow-hidden rounded-md border border-border">
                          <button
                            type="button"
                            disabled={busy || allBack}
                            aria-pressed={allBack}
                            className={`${seg} ${allBack ? "bg-primary text-white" : "bg-surface text-secondary hover:text-heading"}`}
                            onClick={() => onGroup(ids, "bring_back")}
                          >
                            {allBack ? "✓ All brought back" : "Bring back all"}
                          </button>
                          <button
                            type="button"
                            disabled={busy || allOut}
                            aria-pressed={allOut}
                            className={`${seg} border-l border-border ${allOut ? "bg-primary text-white" : "bg-surface text-secondary hover:text-heading"}`}
                            onClick={() => onGroup(ids, "leave_out")}
                          >
                            {allOut ? "✓ All left out" : "Leave out all"}
                          </button>
                        </div>
                        {mine(r.rows) ? (
                          <button type="button" disabled={busy} className="text-body-sm text-muted underline hover:text-heading" onClick={() => onGroup(ids, null)}>
                            Back to default
                          </button>
                        ) : null}
                      </div>
                    );
                  })()}
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
            <td className={`py-xs pr-md text-right ${rows.length - mine(rows) ? "text-warning" : "text-success"}`}>
              {rows.length - mine(rows) ? n(rows.length - mine(rows)) : "✓"}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** What the admin decided on one investor, in words. */
function describeDecision(row: CheckRow) {
  const d = row.decision;
  if (!d) return "";
  const parts: string[] = [];
  if (d.unsure) parts.push("Not sure (later)");
  if (typeof d.firmId === "string") parts.push(`Matched to ${row.firmName ?? d.firmId}`);
  if (d.firmId === null) parts.push("Not in the database");
  if (d.website) parts.push(`Website ${host(d.website)}`);
  if (d.action === "bring_back") parts.push("Brought back");
  if (d.action === "leave_out") parts.push("Left out");
  if (d.note) parts.push("Note");
  if (d.lesson) parts.push("Lesson for Rupert");
  return parts.join(" · ") || "Saved";
}

/**
 * The end of the check: every decision, newest first, with Undo, and the
 * final confirmation. Confirming locks the decisions; Reopen unlocks them.
 */
function ReviewAndConfirm({
  check,
  busy,
  onDecide,
  onConfirm,
}: {
  check: CheckResult;
  busy: boolean;
  onDecide: (investorId: string, patch: Parameters<typeof decideOnInvestor>[2]) => void;
  onConfirm: (confirm: boolean) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const decided = check.rows.filter((r) => r.decision).sort((a, b) => (b.decision!.at || "").localeCompare(a.decision!.at || ""));
  const shown = showAll ? decided : decided.slice(0, 10);
  const unsure = check.rows.filter((r) => r.unsure).length;
  const open = check.rows.filter((r) => r.bucket === "confirm" && !r.unsure).length;
  const todo = check.rows.filter((r) => r.bucket === "not_in_list" && r.defaulted && !r.unsure).length;
  const ready = !open && !todo && !unsure;
  const locked = !!check.confirmedAt;
  return (
    <section className="mt-xl border-t border-border pt-md">
      <div className="flex items-start justify-between gap-md">
        <div className="min-w-0 flex-1">
          <h4 className="text-h4 text-heading">Your decisions</h4>
          <p className="text-body-sm text-muted">Newest first. Undo puts an investor back to its automatic match.</p>
        </div>
        {locked ? (
          <button type="button" className={`${secondaryButton} shrink-0`} disabled={busy} onClick={() => onConfirm(false)}>
            Reopen
          </button>
        ) : (
          <button type="button" className={`${primaryButton} shrink-0`} disabled={busy || !ready} onClick={() => onConfirm(true)}>
            Confirm the check
          </button>
        )}
      </div>
      {locked ? (
        <p className="mt-sm text-body-sm text-success">
          ✓ Confirmed {new Date(check.confirmedAt!).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          {check.confirmedBy ? ` by ${check.confirmedBy}` : ""}. Decisions are locked; Reopen to change one.
        </p>
      ) : (
        <p className={`mt-sm text-body-sm ${ready ? "text-success" : "text-warning"}`}>
          {ready ? "✓ Everything is settled. Confirm when you're happy with the list below." : `Before confirming: ${n(open)} to confirm, ${n(todo)} to decide, ${n(unsure)} marked Not sure.`}
        </p>
      )}
      {decided.length ? (
        <table className="mt-sm w-full text-left text-body-sm">
          <thead className="text-label uppercase tracking-label text-muted">
            <tr>
              <th className="py-xs pr-md font-medium">When</th>
              <th className="py-xs pr-md font-medium">Investor</th>
              <th className="py-xs pr-md font-medium">Decision</th>
              <th className="py-xs pr-md font-medium">Now in</th>
              <th className="py-xs font-medium" />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.investor.id} className={`border-t border-border align-top ${row.unsure ? "bg-warning/5" : ""}`}>
                <td className="py-xs pr-md whitespace-nowrap text-muted">
                  {row.decision!.at ? new Date(row.decision!.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                </td>
                <td className="py-xs pr-md text-heading">{row.investor.name}</td>
                <td className={`py-xs pr-md ${row.unsure ? "text-warning" : "text-secondary"}`}>{describeDecision(row)}</td>
                <td className="py-xs pr-md text-secondary">{BUCKET_LABEL[row.bucket]}</td>
                <td className="py-xs text-right">
                  <button type="button" disabled={busy || locked} className={smallButton} onClick={() => onDecide(row.investor.id, { clear: true })}>
                    Undo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-sm text-body-sm text-muted">No decisions yet.</p>
      )}
      {decided.length > 10 ? (
        <button type="button" className="mt-xs text-body-sm text-secondary underline hover:text-heading" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show the latest 10" : `Show all ${n(decided.length)}`}
        </button>
      ) : null}
    </section>
  );
}

/**
 * The outcome, once nothing is left open: like Step 1, a summary card on
 * top with Confirm in the corner. The details stay below, folded away.
 */
function OutcomeCard({
  check,
  busy,
  onConfirm,
}: {
  check: CheckResult;
  busy: boolean;
  onConfirm: (confirm: boolean) => void;
}) {
  const by = (b: Bucket) => check.rows.filter((r) => r.bucket === b);
  const inList = by("in_list").length;
  const back = by("not_in_list").filter((r) => r.action === "bring_back").length;
  const out = by("not_in_list").filter((r) => r.action === "leave_out").length;
  const funds = by("missing_fund").length;
  const angels = by("missing_angel").length;
  const added = by("added").length;
  const total = check.rows.length;
  const locked = !!check.confirmedAt;
  const rows: { label: string; value: number; note: string; tone?: string }[] = [
    { label: "Already in the shortlist", value: inList, note: "In the database and in Step 1's list.", tone: "text-success" },
    { label: "Brought back", value: back, note: "In the database; added to this client's list.", tone: "text-success" },
    { label: "Left out", value: out, note: "In the database; a real misfit (stage, geography…)." },
    { label: "Added to the database", value: added, note: "Try and Add to DB: for this client now; for everyone once you approve.", tone: "text-success" },
    { label: "Not in the database: funds", value: funds, note: "Not added yet: Try and Add to DB in the details." },
    { label: "Not in the database: angels", value: angels, note: "Not added yet: Try and Add to DB in the details." },
  ].filter((r) => r.label !== "Added to the database" || r.value > 0);
  return (
    <Card tone="final">
      <div className="flex items-start justify-between gap-md">
        <div className="min-w-0 flex-1">
          <BigNumber value={inList + back + added} label={locked ? "Step 2C · Check against the database: confirmed" : "Step 2C · Check against the database: ready to confirm"} />
          <p className="text-body-sm text-secondary">
            {n(inList + back + added)} of {n(total)} go forward with this client ({n(inList)} already in the shortlist, {n(back)} brought back
            {added ? `, ${n(added)} added` : ""}).
            {locked
              ? ` Confirmed ${new Date(check.confirmedAt!).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}${check.confirmedBy ? ` by ${check.confirmedBy}` : ""}.`
              : ""}
          </p>
        </div>
        {locked ? (
          <button type="button" className={`${secondaryButton} shrink-0`} disabled={busy} onClick={() => onConfirm(false)}>
            Reopen
          </button>
        ) : (
          <button type="button" className={`${primaryButton} shrink-0`} disabled={busy} onClick={() => onConfirm(true)}>
            Confirm the check
          </button>
        )}
      </div>
      <table className="mt-md w-full text-left text-body-sm">
        <thead className="text-label uppercase tracking-label text-muted">
          <tr>
            <th className="py-xs pr-md font-medium">Outcome</th>
            <th className="py-xs pr-md text-right font-medium">Investors</th>
            <th className="py-xs pr-md text-right font-medium">Share</th>
            <th className="py-xs font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border">
              <td className={`py-xs pr-md ${r.tone ?? "text-heading"}`}>{r.label}</td>
              <td className="py-xs pr-md text-right text-heading">{n(r.value)}</td>
              <td className="py-xs pr-md text-right text-secondary">{pct(r.value, total)}</td>
              <td className="py-xs text-muted">{r.note}</td>
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
    </Card>
  );
}

/**
 * Look-alike funds (preview): the Step 1 shortlist ranked by how much each
 * fund resembles the competitors' investors found in the database (by their
 * stated sectors). Reads only; loads when opened.
 */
// Not on the page yet: it returns with the ranking step (Step 4).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LookAlikePanel({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<LookAlikePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || preview) return;
    void loadLookAlikes(clientId).then((result) => (result.ok ? setPreview(result.preview) : setError(result.error)));
  }, [open, preview, clientId]);
  return (
    <Card>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-md text-left">
        <span>
          <span className="text-h4 text-heading">Look-alike funds</span>
          <span className="ml-sm text-label uppercase tracking-label text-muted">Preview</span>
          <span className="block text-body-sm text-muted">
            Shortlist funds that look like the funds that backed the competitors (by stated sectors). For ranking later; changes nothing.
          </span>
        </span>
        <span className={`text-muted transition-transform duration-hover ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open ? (
        error ? (
          <p className="mt-sm text-body-sm text-error">{error}</p>
        ) : !preview ? (
          <p className="mt-sm text-body-sm text-muted">Scoring the shortlist…</p>
        ) : (
          <div className="mt-md space-y-md">
            <p className="text-body-sm text-secondary">
              Profile from {n(preview.seeds)} competitor investors in the database:{" "}
              {preview.profile.map((p) => `${p.sector} ${Math.round(p.share * 100)}%`).join(" · ")}
            </p>
            <table className="w-full text-left text-body-sm">
              <thead className="text-label uppercase tracking-label text-muted">
                <tr>
                  <th className="py-xs pr-md font-medium">#</th>
                  <th className="py-xs pr-md font-medium">Fund</th>
                  <th className="py-xs pr-md text-right font-medium">Look-alike</th>
                  <th className="py-xs pr-md font-medium">Shares with the profile</th>
                  <th className="py-xs text-right font-medium">Sub-sectors listed</th>
                </tr>
              </thead>
              <tbody>
                {preview.funds.map((f, i) => (
                  <tr key={f.id} className="border-t border-border">
                    <td className="py-xs pr-md text-muted">{i + 1}</td>
                    <td className="py-xs pr-md text-heading">{f.name}</td>
                    <td className="py-xs pr-md text-right text-heading">{Math.round(f.score * 100)}%</td>
                    <td className="py-xs pr-md text-secondary">{f.shares.join(", ")}</td>
                    <td className="py-xs text-right text-muted">{n(f.sectorCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-body-sm text-muted">
              Top 25 of {n(preview.shortlist)} shortlist funds. A fund listing many sectors scores lower than one focused on the same ones.
            </p>
          </div>
        )
      ) : null}
    </Card>
  );
}

/** What comes after Step 2: the next step of the flow, once it exists. */
export function NextStepCard({ note }: { note?: string }) {
  // Step 2 is done (or skipped) while this shows: Step 3 loads again, and again when it goes away (reopened).
  const signal = useStepSignal();
  useEffect(() => {
    signal();
    return signal;
  }, [signal]);
  return (
    <section className="rounded-card border border-dashed border-border bg-surface px-lg py-md">
      <h3 className="text-h4 text-heading">Next: Step 3, The Final Roster</h3>
      <p className="text-body-sm text-muted">{note ? `${note} ` : ""}Step 3 opens below.</p>
    </section>
  );
}

/**
 * Step 2D: Try and Add to DB, as its own card once the check is confirmed:
 * the investors not in the database, funds and angels, with "Add all" per
 * kind, the list per kind, and what's been added so far.
 */
function AddMissingCard({
  check,
  busy,
  adding,
  onAdd,
  onConfirm,
  renderRow,
}: {
  check: CheckResult;
  busy: boolean;
  adding: { current: string; done: number; total: number } | null;
  onAdd: (ids: string[]) => void;
  onConfirm: (confirm: boolean) => void;
  renderRow: (row: CheckRow) => React.ReactNode;
}) {
  const [open, setOpen] = useState<"missing_fund" | "missing_angel" | "added" | null>(null);
  const rows = (b: Bucket) => check.rows.filter((r) => r.bucket === b);
  const funds = rows("missing_fund");
  const angels = rows("missing_angel");
  const added = rows("added");
  const pending = added.filter((r) => r.added?.status === "pending").length;
  const approved = added.filter((r) => r.added?.status === "approved").length;
  const kinds = [
    { key: "missing_fund" as const, label: "Funds not in the database", list: funds, what: "research, then up to 5 investing contacts from Hunter (about 1 credit each)" },
    { key: "missing_angel" as const, label: "Angels not in the database", list: angels, what: "research, then the angel's email from Hunter (1 credit if found)" },
  ];
  const confirmed = !!check.addedConfirmedAt;
  const contacts = added.reduce((sum, r) => sum + (r.added?.contacts ?? 0), 0);
  if (confirmed) {
    return (
      <Card tone="final">
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0 flex-1">
            <BigNumber value={added.length} label="Step 2D · Try and Add to DB: confirmed" />
            <p className="text-body-sm text-secondary">
              {n(added.length)} added ({n(pending)} pending review, {n(approved)} approved), with {n(contacts)} contacts. Skipped: {n(funds.length)} funds and{" "}
              {n(angels.length)} angels. Confirmed {new Date(check.addedConfirmedAt!).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              {check.addedConfirmedBy ? ` by ${check.addedConfirmedBy}` : ""}.
            </p>
          </div>
          <button type="button" className={`${secondaryButton} shrink-0`} disabled={busy} onClick={() => onConfirm(false)}>
            Reopen
          </button>
        </div>
        <table className="mt-md w-full text-left text-body-sm">
          <thead className="text-label uppercase tracking-label text-muted">
            <tr>
              <th className="py-xs pr-md font-medium">Outcome</th>
              <th className="py-xs pr-md text-right font-medium">Investors</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="py-xs pr-md text-success">Added, pending your review</td>
              <td className="py-xs pr-md text-right text-heading">{n(pending)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-xs pr-md text-success">Added and approved (every client)</td>
              <td className="py-xs pr-md text-right text-heading">{n(approved)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-xs pr-md text-heading">Skipped: funds</td>
              <td className="py-xs pr-md text-right text-heading">{n(funds.length)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-xs pr-md text-heading">Skipped: angels</td>
              <td className="py-xs pr-md text-right text-heading">{n(angels.length)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-md text-body-sm text-muted">
          Pending funds count for this client now.{" "}
          <a href="/admin/fund-database#added-by-rupert" className="underline">
            Review them on the Fund Database page
          </a>{" "}
          to add them for every client.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex items-start justify-between gap-md">
        <div className="min-w-0 flex-1">
          <h3 className="text-h4 text-heading">Step 2D: Try and Add to DB</h3>
          <p className="text-body-sm text-muted">
            The competitors&apos; investors your database doesn&apos;t have. Each one added is researched, gets its contacts from Hunter, and waits for
            your review on the Fund Database page (Added by Rupert). It counts for this client right away, and for every client once you approve it.
            When you&apos;re done adding, &ldquo;Done adding&rdquo; closes this step: whatever isn&apos;t added counts as skipped (Reopen to add more).
          </p>
        </div>
        <button
          type="button"
          className={`${primaryButton} shrink-0`}
          disabled={busy || !!adding}
          onClick={() => {
            const left = funds.length + angels.length;
            if (!left || window.confirm(`Confirm Step 2D? ${left} not added will be skipped (you can Reopen to add more).`)) onConfirm(true);
          }}
        >
          Done adding: confirm 2D
        </button>
      </div>
      {adding ? (
        <p className="mt-sm text-body-sm text-primary">
          Adding {n(adding.done + 1)} of {n(adding.total)}: researching, then finding contacts with Hunter… (about a minute each; keep this page open)
        </p>
      ) : null}
      <table className="mt-md w-full text-left text-body-sm">
        <thead className="text-label uppercase tracking-label text-muted">
          <tr>
            <th className="py-xs pr-md font-medium">Group</th>
            <th className="py-xs pr-md text-right font-medium">Investors</th>
            <th className="py-xs font-medium" />
          </tr>
        </thead>
        <tbody>
          {kinds.map((k) => (
            <tr key={k.key} className="border-t border-border align-top">
              <td className="py-xs pr-md">
                <p className="text-heading">{k.label}</p>
                <p className="text-muted">Each: {k.what}.</p>
              </td>
              <td className="py-xs pr-md text-right text-heading">{n(k.list.length)}</td>
              <td className="py-xs text-right">
                <div className="inline-flex flex-wrap justify-end gap-xs">
                  <button type="button" className={smallButton} disabled={!k.list.length} onClick={() => setOpen(open === k.key ? null : k.key)}>
                    {open === k.key ? "Hide list" : "Show list"}
                  </button>
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={busy || !!adding || !k.list.length}
                    onClick={() => {
                      if (window.confirm(`Try and Add to DB for all ${k.list.length}? About a minute each. Each waits for your review before other clients see it.`)) {
                        onAdd(k.list.map((r) => r.investor.id));
                      }
                    }}
                  >
                    Add all {n(k.list.length)}
                  </button>
                </div>
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-primary align-top">
            <td className="py-xs pr-md">
              <p className="text-success">Added so far</p>
              <p className="text-muted">
                {n(pending)} pending review · {n(approved)} approved.{" "}
                <a href="/admin/fund-database#added-by-rupert" className="underline">
                  Review on the Fund Database page
                </a>
              </p>
            </td>
            <td className="py-xs pr-md text-right text-heading">{n(added.length)}</td>
            <td className="py-xs text-right">
              <button type="button" className={smallButton} disabled={!added.length} onClick={() => setOpen(open === "added" ? null : "added")}>
                {open === "added" ? "Hide list" : "Show list"}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      {open ? (
        <div className="mt-md">
          <p className="text-label uppercase tracking-label text-muted">
            {open === "added" ? "Added so far" : kinds.find((k) => k.key === open)?.label} · {n(rows(open).length)}
          </p>
          {open !== "added" ? (
            <p className="text-body-sm text-muted">The research finds each website itself. To give one yourself first, Reopen the check and set it in the details.</p>
          ) : null}
          <table className="mt-xs w-full text-left text-body-sm">
            <tbody>{rows(open).map((row) => renderRow(row))}</tbody>
          </table>
        </div>
      ) : null}
    </Card>
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
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void runInvestorCheck(clientId).then((result) => {
      if (!live) return;
      if (!result.ok) return setError(result.error);
      setCheck(result.check);
      // The matched investors' investments are saved to the funds' records, quietly (no decision in it).
      void recordInvestmentsInDb(clientId).then((saved) => {
        if (live && saved.ok) setRecorded(saved.recorded);
      });
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  const [toast, setToast] = useState<string | null>(null);
  const [finding, setFinding] = useState<{ done: number; total: number } | null>(null);
  const [recorded, setRecorded] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  /** Try and Add to DB in progress: the investor being added now, and the queue. */
  const [adding, setAdding] = useState<{ current: string; done: number; total: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const decide = async (investorId: string, patch: Parameters<typeof decideOnInvestor>[2]) => {
    setBusy(true);
    setError(null);
    const name = check?.rows.find((r) => r.investor.id === investorId)?.investor.name ?? "Investor";
    const result = await decideOnInvestor(clientId, investorId, patch);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCheck(result.check);
    const what = patch.clear
      ? "decision undone"
      : patch.unsure === true
        ? "marked Not sure (later)"
        : patch.unsure === false
          ? "back in the queue"
      : patch.action === "bring_back"
        ? "brought back"
        : patch.action === "leave_out"
          ? "left out"
          : patch.firmId === null
            ? "marked not in the database"
            : typeof patch.firmId === "string"
              ? "matched"
              : patch.website !== undefined
                ? "website saved, matched again"
                : patch.note !== undefined || patch.lesson !== undefined
                  ? "note saved"
                  : "saved";
    setToast(`${name}: ${what}. Saved.`);
  };

  const group = async (ids: string[], action: "bring_back" | "leave_out" | null) => {
    const targets = (check?.rows ?? []).filter((r) => ids.includes(r.investor.id));
    const already = targets.filter((r) => (action ? !r.defaulted && r.action === action : r.defaulted)).length;
    if (targets.length && already === targets.length) {
      const text = `Already ${action === "bring_back" ? "brought back" : action === "leave_out" ? "left out" : "on the default"}: ${n(targets.length)} ${targets.length === 1 ? "fund" : "funds"}. Nothing to change.`;
      setNotice(text);
      setToast(text);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await decideForGroup(clientId, ids, action);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCheck(result.check);
    const changedNow = targets.length - already;
    const text = `${n(changedNow)} ${changedNow === 1 ? "fund" : "funds"} ${
      action === "bring_back" ? "brought back" : action === "leave_out" ? "left out" : "back to the default (to decide)"
    }. Saved.`;
    setNotice(text);
    setToast(text);
  };

  const applyAll = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await applyDefaultsToAll(clientId);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCheck(result.check);
    const text = `Defaults applied: ${n(result.broughtBack)} brought back, ${n(result.leftOut)} left out. Saved.`;
    setNotice(text);
    setToast(text);
  };

  const confirmCheck = async (confirm: boolean) => {
    if (confirm && !window.confirm("Confirm the check? Decisions are locked until you reopen it.")) return;
    setBusy(true);
    setError(null);
    const result = await confirmInvestorCheck(clientId, confirm);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCheck(result.check);
    setToast(confirm ? "Check confirmed. Saved." : "Check reopened.");
  };

  const confirmAdded = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    const result = await confirmAddedStep(clientId, confirm);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCheck(result.check);
    setToast(confirm ? "Step 2D confirmed. Saved." : "Step 2D reopened.");
  };

  /** Try and Add to DB, one investor at a time (about a minute each: research, then Hunter). A problem with one never stops the rest. */
  const addToDb = async (ids: string[]) => {
    setError(null);
    let done = 0;
    let created = 0;
    let matched = 0;
    let last = "";
    const problems: string[] = [];
    try {
      for (const id of ids) {
        setAdding({ current: id, done, total: ids.length });
        const name = check?.rows.find((r) => r.investor.id === id)?.investor.name ?? "An investor";
        try {
          const result = await addInvestorToDb(clientId, id);
          if (!result.ok) problems.push(`${name}: ${result.error}`);
          else {
            if (result.created) created += 1;
            else if (/already in the database/.test(result.message)) matched += 1;
            last = result.message;
            setCheck(result.check);
          }
        } catch (err) {
          problems.push(`${name}: ${err instanceof Error ? err.message : "failed"}`);
        }
        done += 1;
      }
    } finally {
      setAdding(null);
    }
    if (problems.length) setError(`Not added (${problems.length}):\n${problems.join("\n")}`);
    if (ids.length === 1 && last && !problems.length) setToast(last);
    else
      setToast(
        `Try and Add to DB: ${n(created)} added${matched ? `, ${n(matched)} already in the database (matched)` : ""}${problems.length ? `, ${n(problems.length)} not added (see the list)` : ""}.`,
      );
  };

  /** Find websites for the unclear and missing investors that have no suggestion yet, a few at a time. */
  const findWebsites = async (ids: string[]) => {
    setError(null);
    let done = 0;
    let found = 0;
    setFinding({ done, total: ids.length });
    for (let i = 0; i < ids.length; i += 4) {
      const batch = ids.slice(i, i + 4);
      const result = await findWebsitesFor(clientId, batch);
      done += batch.length;
      setFinding({ done, total: ids.length });
      if (!result.ok) {
        setError(result.error);
        break;
      }
      found += result.found;
      setCheck(result.check);
    }
    setFinding(null);
    setToast(`Find websites: ${n(found)} found for ${n(done)} investors. Saved.`);
  };

  if (!check) {
    return (
      <Card>
        <h3 className="text-h4 text-heading">Step 2C: Check against the fund database</h3>
        {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : <p className="mt-sm text-body-sm text-muted">Checking every investor…</p>}
      </Card>
    );
  }

  const byBucket = (b: Bucket) => check.rows.filter((r) => r.bucket === b);
  const total = check.rows.length;
  const notInList = byBucket("not_in_list");
  const openNow =
    check.rows.filter((r) => r.unsure).length +
    check.rows.filter((r) => r.bucket === "confirm").length +
    check.rows.filter((r) => r.bucket === "not_in_list" && r.defaulted && !r.unsure).length;
  // Confirmed stays confirmed on the page: later changes (e.g. funds added in 2D) show as a note, never hide 2D.
  const settled = !!check.confirmedAt || openNow === 0;
  /** Confirmed: every decision button is off until Reopen. */
  const frozen = busy || !!check.confirmedAt;
  const current: Bucket | null = show === "none" ? null : show ?? (check.counts.confirm ? "confirm" : check.counts.not_in_list ? "not_in_list" : null);

  const details = (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h3 className="text-h4 text-heading">Step 2C: Check against the fund database</h3>
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
          {ORDER.filter((b) => b !== "added" || check.counts.added > 0).map((b) => (
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
      <DecisionSummary rows={notInList} busy={frozen} onGroup={(ids, action) => void group(ids, action)} onOpen={setOpenReason} onApplyDefaults={() => void applyAll()} />
      {busy ? <p className="mt-xs text-body-sm text-primary">Saving…</p> : notice ? <p className="mt-xs text-body-sm text-success">{notice}</p> : null}
      {openReason ? (
        <ReasonModal
          reason={REASONS.find((r) => r.key === openReason) ?? REASONS[0]}
          rows={notInList.filter((r) => reasonOf(r) === openReason)}
          busy={frozen}
          onDecide={(id, patch) => void decide(id, patch)}
          onClose={() => setOpenReason(null)}
        />
      ) : null}

      {recorded ? (
        <p className="mt-md text-body-sm text-muted">
          {n(recorded)} investments (which fund backed which competitor) saved to the funds&apos; records for future clients.
        </p>
      ) : null}

      {current && byBucket(current).length ? (
        <section className="mt-lg">
          <h4 className="text-label uppercase tracking-label text-muted">
            {BUCKET_LABEL[current]} · {n(byBucket(current).length)}
          </h4>
          {current === "missing_fund" || current === "missing_angel" ? (
            <div className="mt-xs flex flex-wrap items-center gap-sm">
              {adding ? (
                <p className="text-body-sm text-primary">
                  Adding {n(adding.done + 1)} of {n(adding.total)}: researching the fund, then finding its investing team with Hunter…
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={busy || !!finding || !byBucket(current).length}
                    onClick={() => {
                      const ids = byBucket(current).map((r) => r.investor.id);
                      if (window.confirm(`Try and Add to DB for all ${ids.length}? About a minute each, and about 1 Hunter credit per fund with a website. Each waits for your review before other clients see it.`)) void addToDb(ids);
                    }}
                  >
                    Try and Add to DB: all {n(byBucket(current).length)}
                  </button>
                  <p className="text-body-sm text-muted">
                    Research (website, what it invests in, team), then up to {current === "missing_angel" ? "1 email (the angel)" : "5 investing contacts"} from Hunter. Added as pending: for this client now, for everyone after you approve it.
                  </p>
                </>
              )}
            </div>
          ) : null}
          {current === "confirm" || current === "missing_fund" || current === "missing_angel"
            ? (() => {
                const pending = byBucket(current).filter((r) => !r.suggestion).map((r) => r.investor.id);
                return (
                  <div className="mt-sm flex flex-wrap items-center gap-sm">
                    {finding ? (
                      <p className="text-body-sm text-primary">
                        Finding websites… {n(finding.done)} of {n(finding.total)}
                      </p>
                    ) : pending.length ? (
                      <>
                        <button type="button" className={primaryButton} disabled={busy || !check.websitesReady} onClick={() => void findWebsites(pending)}>
                          Find websites ({n(pending.length)})
                        </button>
                        <p className="text-body-sm text-muted">
                          {check.websitesReady
                            ? "Reads each investor's funding article, finds its website and portfolio page. About 30 seconds per 4 investors."
                            : "Run supabase/investor_websites.sql first."}
                        </p>
                      </>
                    ) : (
                      <p className="text-body-sm text-success">✓ Websites looked up for all in this group.</p>
                    )}
                  </div>
                );
              })()
            : null}
          {current === "not_in_list" ? (
            <DecisionQueue rows={byBucket(current)} busy={frozen} onDecide={(row, p) => void decide(row.investor.id, p)} />
          ) : (
          <table className="mt-xs w-full text-left text-body-sm">
            <tbody>
              {[...byBucket(current)].sort((a, b) => Number(a.unsure) - Number(b.unsure)).map((row) =>
                current === "confirm" ? (
                  <ConfirmRow key={row.investor.id} row={row} busy={frozen} onDecide={(p) => void decide(row.investor.id, p)} />
                ) : (
                  <SimpleRow
                    key={row.investor.id}
                    row={row}
                    busy={frozen || !!adding}
                    onDecide={(p) => void decide(row.investor.id, p)}
                    onAdd={() => void addToDb([row.investor.id])}
                    adding={adding?.current === row.investor.id}
                    addDisabled={busy || !!adding}
                  />
                ),
              )}
            </tbody>
          </table>
          )}
        </section>
      ) : null}
      <ReviewAndConfirm check={check} busy={busy} onDecide={(id, p) => void decide(id, p)} onConfirm={(c) => void confirmCheck(c)} />
    </Card>
  );

  if (!settled) {
    return (
      <>
        {details}
        {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
        <Toast text={toast} />
      </>
    );
  }
  return (
    <div className="space-y-md">
      <OutcomeCard check={check} busy={busy} onConfirm={(c) => void confirmCheck(c)} />
      {adding ? (
        <p className="rounded-md border border-primary/40 bg-surface px-md py-sm text-body-sm text-primary">
          Try and Add to DB: adding {n(adding.done + 1)} of {n(adding.total)}… keep this page open (closing it stops after the current one).
        </p>
      ) : null}
      {check.confirmedAt && openNow ? (
        <p className="rounded-md border border-warning/40 bg-surface px-md py-sm text-body-sm text-warning">
          {n(openNow)} {openNow === 1 ? "investor needs" : "investors need"} a decision since the check was confirmed (the database changed, e.g. funds added in
          2D). Open the details to see {openNow === 1 ? "it" : "them"}; Reopen to decide.
        </p>
      ) : null}
      {error ? <p className="whitespace-pre-line rounded-md border border-error/40 bg-surface px-md py-sm text-body-sm text-error">{error}</p> : null}
      <button
        type="button"
        aria-expanded={showDetails}
        onClick={() => setShowDetails(!showDetails)}
        className="flex w-full items-center justify-center gap-sm rounded-md border border-border bg-surface px-md py-[6px] text-body-sm text-secondary hover:text-heading"
      >
        {showDetails ? "Hide the details" : "Show the details: groups, decisions and websites"}
        <span className={`transition-transform duration-hover ${showDetails ? "rotate-180" : ""}`}>▾</span>
      </button>
      {showDetails ? details : null}
      {check.confirmedAt ? (
        <AddMissingCard
          check={check}
          busy={busy || !!finding}
          adding={adding}
          onAdd={(ids) => void addToDb(ids)}
          onConfirm={(c) => void confirmAdded(c)}
          renderRow={(row) => (
            <SimpleRow
              key={row.investor.id}
              row={row}
              busy={frozen || !!adding}
              onDecide={(p) => void decide(row.investor.id, p)}
              onAdd={() => void addToDb([row.investor.id])}
              adding={adding?.current === row.investor.id}
              addDisabled={busy || !!adding}
            />
          )}
        />
      ) : null}
      {error && check.confirmedAt ? (
        <p className="whitespace-pre-line rounded-md border border-error/40 bg-surface px-md py-sm text-body-sm text-error">{error}</p>
      ) : null}
      {check.addedConfirmedAt ? <NextStepCard /> : null}
      <Toast text={toast} />
    </div>
  );
}
