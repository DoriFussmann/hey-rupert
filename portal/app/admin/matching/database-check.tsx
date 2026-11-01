"use client";

import { useEffect, useState } from "react";
import { decideOnInvestor, runInvestorCheck } from "@/app/admin/landscape-actions";
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

const ORDER: Bucket[] = ["in_list", "not_in_list", "confirm", "missing_fund", "missing_angel"];
const TONE: Record<Bucket, string> = {
  confirm: "text-warning",
  in_list: "text-success",
  not_in_list: "text-heading",
  missing_fund: "text-heading",
  missing_angel: "text-heading",
};

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

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
  const action = row.decision?.action;
  const noteChanged = note !== (row.decision?.note ?? "") || lesson !== (row.decision?.lesson ?? false);
  return (
    <tr className="border-t border-border align-top">
      <td className="py-sm pr-md">
        <p className="text-heading">{row.investor.name}</p>
        <p className="text-muted">Backed {backedText(row)}</p>
        <p className="text-muted">
          Database: {row.firmName}
          {row.match.how === "website" ? " (same website)" : row.match.how === "name" ? " (same name)" : " (chosen by you)"}
        </p>
      </td>
      <td className="py-sm pr-md">
        {row.failure ? (
          <>
            <p className="text-heading">Removed at {row.failure.label}</p>
            <p className="text-secondary">Fund lists: {row.failure.fundValues}</p>
          </>
        ) : (
          <p className="text-warning">Passes Step 1 today: the database changed after Step 1 was confirmed.</p>
        )}
      </td>
      <td className="py-sm">
        <div className="flex flex-wrap gap-xs">
          <button
            type="button"
            disabled={busy}
            className={action === "bring_back" ? primaryButton : secondaryButton}
            onClick={() => onDecide({ action: action === "bring_back" ? null : "bring_back" })}
          >
            Bring back
          </button>
          <button
            type="button"
            disabled={busy}
            className={action === "leave_out" ? primaryButton : secondaryButton}
            onClick={() => onDecide({ action: action === "leave_out" ? null : "leave_out" })}
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
          {row.investor.website ? ` · ${host(row.investor.website)}` : ""}
        </p>
        <p className="text-muted">{row.match.how === "ambiguous" ? "More than one database record has this name or website." : "Similar names in the database."}</p>
      </td>
      <td className="py-sm" colSpan={2}>
        <div className="flex flex-wrap gap-xs">
          {row.candidates.map((c) => (
            <button key={c.id} type="button" disabled={busy} className={secondaryButton} onClick={() => onDecide({ firmId: c.id })}>
              It&apos;s {c.name}
              {c.web ? <span className="text-muted"> · {host(c.web)}</span> : null}
            </button>
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
      <td className="py-xs pr-md text-heading">{row.investor.name}</td>
      <td className="py-xs pr-md text-secondary">{KIND_LABEL[row.investor.kind]}</td>
      <td className="py-xs pr-md text-secondary">{backedText(row)}</td>
      <td className="py-xs text-secondary">
        {!missing ? (
          row.firmName
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
            {row.investor.website ? host(row.investor.website) : <span className="text-muted">No website</span>}{" "}
            <button type="button" className="underline" onClick={() => setEditing(true)}>
              {row.investor.website ? "Edit" : "Add"}
            </button>
          </span>
        )}
      </td>
    </tr>
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
  const decided = notInList.filter((r) => r.decision?.action).length;
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
      {notInList.length ? (
        <p className="mt-sm text-body-sm text-secondary">
          Decided {n(decided)} of {n(notInList.length)} in the database but not in the shortlist.
        </p>
      ) : null}

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
