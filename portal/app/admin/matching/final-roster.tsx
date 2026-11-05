"use client";

import { useCallback, useEffect, useState } from "react";
import { confirmFinalRoster, dismissRosterSuggestion, skipRosterFields, fillRosterFields, loadFinalRoster, reopenFinalRoster, suggestRosterFields } from "@/app/admin/roster-actions";
import { MissingFields } from "@/app/admin/matching/missing-fields";
import { primaryButton, secondaryButton } from "@/app/admin/clients/[id]/match/ui";
import { BigNumber, Card } from "@/app/admin/matching/dry-match";
import { SOURCE_LABEL, type AddedCheck, type ExclusionCheck, type RosterCounts, type RosterEntry } from "@/lib/match/roster/core";
import type { RosterState } from "@/lib/match/roster/server";

const n = (value: number) => value.toLocaleString("en-US");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function download(entries: RosterEntry[], clientName: string) {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    ["#", "Investor", "Fund Database ID", "Website", "Source", "Backed a competitor", "Added: status"].join(","),
    ...entries.map((e, i) =>
      [String(i + 1), e.name, e.firmId, e.website, SOURCE_LABEL[e.source], e.backed.join("; "), e.addedStatus ?? ""].map(cell).join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${clientName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-final-roster.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** The bottom line: sources, exclusions and the total. */
function SummaryTable({ counts }: { counts: RosterCounts }) {
  const row = (label: string, value: string, tone = "text-heading", strong = false) => (
    <tr className={strong ? "border-t-2 border-primary" : "border-t border-border"}>
      <td className={`py-xs pr-md ${strong ? "text-heading" : "text-secondary"}`}>{label}</td>
      <td className={`py-xs text-right ${tone}`}>{value}</td>
    </tr>
  );
  return (
    <table className="mt-md w-full max-w-xl text-left text-body-sm">
      <thead className="text-label uppercase tracking-label text-muted">
        <tr>
          <th className="py-xs pr-md font-medium">Source</th>
          <th className="py-xs text-right font-medium">Investors</th>
        </tr>
      </thead>
      <tbody>
        {row("Dry Match (Step 1)", n(counts.dry))}
        {row("Brought back (2C, 3C)", `+${n(counts.broughtBack)}`)}
        {row("Added (2D, 3D), passing the filters", `+${n(counts.added)}`)}
        {counts.addedMissing ? row("Added (2D, 3D), waiting for missing fields: not counted", n(counts.addedMissing), "text-warning") : null}
        {row("Combined", n(counts.combined))}
        {row("Excluded by the client", `(${n(counts.excluded)})`, "text-error")}
        {row("The Final Roster", n(counts.total), "text-heading", true)}
        {row("Of which backed a competitor", n(counts.backed), "text-success")}
      </tbody>
    </table>
  );
}

const RESULT_TEXT: Record<AddedCheck["result"], { label: string; tone: string }> = {
  pass: { label: "In: passes the filters", tone: "text-success" },
  secondary: { label: "In: by the client's secondary sub-sector", tone: "text-success" },
  fail: { label: "Out", tone: "text-error" },
  missing: { label: "Waiting: missing fields", tone: "text-warning" },
  not_found: { label: "Out: not in the database", tone: "text-error" },
};

function AddedTable({ added }: { added: AddedCheck[] }) {
  if (!added.length) return <p className="text-body-sm text-muted">No investors were added in 2D or 3D.</p>;
  return (
    <table className="mt-sm w-full text-left text-body-sm">
      <thead className="text-label uppercase tracking-label text-muted">
        <tr>
          <th className="py-xs pr-md font-medium">Investor</th>
          <th className="py-xs pr-md font-medium">Result</th>
          <th className="py-xs font-medium">Why</th>
        </tr>
      </thead>
      <tbody>
        {added.map((a) => (
          <tr key={a.addedId} className="border-t border-border align-top">
            <td className="py-xs pr-md text-heading">
              {a.name} <span className="text-muted">({a.kind === "angel" ? "angel" : "fund"}, {a.status})</span>
            </td>
            <td className={`py-xs pr-md ${RESULT_TEXT[a.result].tone}`}>{RESULT_TEXT[a.result].label}</td>
            <td className="py-xs text-secondary">{a.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const EXCLUSION_TEXT: Record<ExclusionCheck["result"], { label: string; tone: string }> = {
  excluded: { label: "Excluded", tone: "text-error" },
  not_on_roster: { label: "Not on the Roster anyway", tone: "text-secondary" },
  not_matched: { label: "Not matched: ignored", tone: "text-muted" },
};

function ExclusionTable({ exclusions }: { exclusions: ExclusionCheck[] }) {
  if (!exclusions.length) return <p className="text-body-sm text-muted">The client named no exclusions.</p>;
  return (
    <table className="mt-sm w-full text-left text-body-sm">
      <thead className="text-label uppercase tracking-label text-muted">
        <tr>
          <th className="py-xs pr-md font-medium">The client wrote</th>
          <th className="py-xs pr-md font-medium">Result</th>
          <th className="py-xs font-medium">Fund Database record</th>
        </tr>
      </thead>
      <tbody>
        {exclusions.map((e) => (
          <tr key={e.line} className="border-t border-border align-top">
            <td className="py-xs pr-md text-heading">{e.line}</td>
            <td className={`py-xs pr-md ${EXCLUSION_TEXT[e.result].tone}`}>{EXCLUSION_TEXT[e.result].label}</td>
            <td className="py-xs text-secondary">{e.firmName ? `${e.firmName} (${e.firmId})` : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Step 4: The Final Roster. */
export function FinalRoster({ clientId, clientName, refreshKey, onChanged }: { clientId: string; clientName: string; refreshKey: number; onChanged?: () => void }) {
  const [state, setState] = useState<RosterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<"added" | "exclusions" | "list" | null>(null);

  const load = useCallback(async () => {
    const result = await loadFinalRoster(clientId);
    if (!result.ok) return setError(result.error);
    setError(null);
    setState(result.state);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function run(label: string, action: () => Promise<{ ok: true; state: RosterState } | { ok: false; error: string }>) {
    setBusy(label);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setState(result.state);
    onChanged?.();
  }

  const errorLine = error ? <p className="mt-sm whitespace-pre-line text-body-sm text-error">{error}</p> : null;
  if (!state) return error ? errorLine : <p className="text-body-sm text-muted">Loading…</p>;
  if (state.status === "blocked") {
    return <p className="rounded-card border border-border bg-surface px-lg py-md text-body-sm text-muted">{state.reason}</p>;
  }

  const toggle = (key: "added" | "exclusions" | "list") => setOpen(open === key ? null : key);
  const panel = (key: "added" | "exclusions" | "list", label: string, body: React.ReactNode) => (
    <div className="mt-sm">
      <button type="button" className="text-body-sm text-primary underline" aria-expanded={open === key} onClick={() => toggle(key)}>
        {open === key ? `Hide ${label}` : `Show ${label}`}
      </button>
      {open === key ? <div className="mt-xs">{body}</div> : null}
    </div>
  );
  const listTable = (entries: RosterEntry[]) => (
    <div className="max-h-[480px] overflow-auto">
      <table className="w-full text-left text-body-sm">
        <thead className="sticky top-0 bg-surface text-label uppercase tracking-label text-muted">
          <tr>
            <th className="py-xs pr-md font-medium">#</th>
            <th className="py-xs pr-md font-medium">Investor</th>
            <th className="py-xs pr-md font-medium">Source</th>
            <th className="py-xs font-medium">Backed a competitor</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.firmId} className="border-t border-border">
              <td className="py-xs pr-md text-muted">{i + 1}</td>
              <td className="py-xs pr-md text-heading">{e.name}</td>
              <td className="py-xs pr-md text-secondary">{SOURCE_LABEL[e.source]}</td>
              <td className="py-xs text-success">{e.backed.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const { fill, options } = state;
  const fillCard = fill.length ? (
        <Card>
          <h3 className="text-h4 text-heading">Step 4A: Fill in missing fields</h3>
          <p className="max-w-prose text-body-sm text-secondary">
            {n(fill.length)} added {fill.length === 1 ? "investor is" : "investors are"} missing a field the Step 1 filters need, so {fill.length === 1 ? "it stays" : "they stay"} off
            the Roster until filled in. {state.saved ? "The Roster is confirmed without them: once filled, Reopen and confirm again to add them." : "Not a blocker: you can confirm the Roster now, and reopen it once more are filled."}
          </p>
          <div className="mt-sm">
            <MissingFields
              items={fill}
              options={options}
              suggest={(ids) => suggestRosterFields(clientId, ids)}
              save={(id, fields) => fillRosterFields(clientId, id, fields)}
              dismiss={(id) => dismissRosterSuggestion(clientId, id)}
              skip={(id, on) => skipRosterFields(clientId, id, on)}
              onChanged={load}
            />
          </div>
          {errorLine}
        </Card>
  ) : null;

  // Confirmed: the green summary card.
  if (state.saved) {
    const saved = state.saved;
    return (
      <div className="space-y-md">
      {fillCard}
      <Card tone="final">
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0 flex-1">
            <BigNumber value={saved.counts.total} label="Step 4 · The Final Roster: confirmed" />
            <p className="text-body-sm text-secondary">
              Confirmed {when(saved.confirmedAt)}
              {saved.confirmedBy ? ` by ${saved.confirmedBy}` : ""}.{saved.facts.step2Skipped ? " Step 2 was skipped (no funded competitors)." : ""}
            </p>
          </div>
          <button type="button" className={`${secondaryButton} shrink-0`} disabled={busy !== null} onClick={() => void run("reopen", () => reopenFinalRoster(clientId))}>
            {busy === "reopen" ? "Reopening…" : "Reopen"}
          </button>
        </div>
        {state.changed.length ? (
          <p className="mt-sm rounded-md border border-warning/40 bg-surface px-md py-sm text-body-sm text-warning">
            Since it was confirmed, the data behind it changed: {state.changed.join(" ")} Reopen to rebuild it.
          </p>
        ) : null}
        <SummaryTable counts={saved.counts} />
        {panel("added", `the ${saved.added.length} added investors`, <AddedTable added={saved.added} />)}
        {panel("exclusions", `the ${saved.exclusions.length} exclusion lines`, <ExclusionTable exclusions={saved.exclusions} />)}
        {panel("list", "the Roster", listTable(saved.entries))}
        <div className="mt-md flex justify-end">
          <button type="button" className={secondaryButton} onClick={() => download(saved.entries, clientName)}>
            Download (CSV)
          </button>
        </div>
        {fill.length ? null : errorLine}
      </Card>
      </div>
    );
  }

  const { draft } = state;
  const c = draft.counts;
  return (
    <div className="space-y-md">
      {fillCard}
      <Card tone="final">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <BigNumber value={c.total} label="The Final Roster" />
          <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void run("confirm", () => confirmFinalRoster(clientId))}>
            {busy === "confirm" ? "Saving…" : "Confirm Roster"}
          </button>
        </div>
        {state.facts.step2Skipped ? <p className="text-body-sm text-muted">Step 2 was skipped (no funded competitors): the Roster is the Dry Match minus exclusions.</p> : null}
        {c.addedMissing > 0 ? (
          <p className="mt-xs text-body-sm text-warning">
            {n(c.addedMissing)} added {c.addedMissing === 1 ? "investor isn't" : "investors aren't"} on the Roster yet: missing fields (Step 4A).
          </p>
        ) : null}
        <SummaryTable counts={c} />
        <p className="mt-sm text-body-sm text-muted">
          Added in 2D and 3D: {n(c.added)} in, {n(c.addedFailed)} out on the filters{c.addedMissing ? `, ${n(c.addedMissing)} waiting` : ""}. Exclusions: only clear matches count;
          {" "}
          {n(draft.exclusions.filter((e) => e.result === "not_matched").length)} of {n(draft.exclusions.length)} lines matched nothing and are ignored.
          {c.gone ? ` ${n(c.gone)} shortlist funds are no longer in the database.` : ""}
        </p>
        {panel("added", `the ${draft.added.length} added investors`, <AddedTable added={draft.added} />)}
        {panel("exclusions", `the ${draft.exclusions.length} exclusion lines`, <ExclusionTable exclusions={draft.exclusions} />)}
        {panel("list", "the Roster", listTable(draft.entries))}
        <div className="mt-md flex justify-end">
          <button type="button" className={secondaryButton} onClick={() => download(draft.entries, clientName)}>
            Download (CSV)
          </button>
        </div>
        {fill.length ? null : errorLine}
      </Card>
    </div>
  );
}
