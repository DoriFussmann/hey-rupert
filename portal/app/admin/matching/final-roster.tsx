"use client";

import { useCallback, useEffect, useState } from "react";
import { confirmFinalRoster, fillRosterFields, loadFinalRoster, reopenFinalRoster } from "@/app/admin/roster-actions";
import { primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { BigNumber, Card } from "@/app/admin/matching/dry-match";
import { MISSING_LABEL, SOURCE_LABEL, type AddedCheck, type ExclusionCheck, type MissingField, type RosterCounts, type RosterEntry } from "@/lib/match/roster/core";
import type { FillItem, RosterOptions, RosterState } from "@/lib/match/roster/server";

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
        {row("Brought back (2C)", `+${n(counts.broughtBack)}`)}
        {row("Added (2D), passing the filters", `+${n(counts.added)}`)}
        {row("Combined", n(counts.combined))}
        {row("Excluded by the client", `−${n(counts.excluded)}`, "text-error")}
        {row("The Final Roster", n(counts.total), "text-heading", true)}
        {row("Of which backed a competitor", n(counts.backed), "text-success")}
      </tbody>
    </table>
  );
}

const RESULT_TEXT: Record<AddedCheck["result"], { label: string; tone: string }> = {
  pass: { label: "In: passes the filters", tone: "text-success" },
  secondary: { label: "In: by the client's secondary sector", tone: "text-success" },
  fail: { label: "Out", tone: "text-error" },
  missing: { label: "Waiting: missing fields", tone: "text-warning" },
  not_found: { label: "Out: not in the database", tone: "text-error" },
};

function AddedTable({ added }: { added: AddedCheck[] }) {
  if (!added.length) return <p className="text-body-sm text-muted">No investors were added in 2D.</p>;
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

/** Chips plus a dropdown to add one more. */
function ChipPicker({ options, value, onChange, disabled }: { options: string[]; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-xs">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-xs rounded-md border border-primary/40 bg-primary-tint/40 px-sm py-[2px] text-body-sm text-heading">
          {v}
          <button type="button" aria-label={`Remove ${v}`} disabled={disabled} className="text-muted hover:text-heading" onClick={() => onChange(value.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <select
        className="rounded-md border border-border bg-background px-sm py-[3px] text-body-sm text-body"
        value=""
        disabled={disabled}
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
      >
        <option value="">Add…</option>
        {options
          .filter((o) => !value.includes(o))
          .map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
      </select>
    </div>
  );
}

const FIELD_KEY: Record<MissingField, "stages" | "geographies" | "sectors"> = { stage: "stages", geography: "geographies", sector: "sectors" };

/** 3A: one added investor with missing fields. */
function FillRow({ item, options, busy, onSave }: { item: FillItem; options: RosterOptions; busy: boolean; onSave: (fields: Partial<Record<"stages" | "geographies" | "sectors", string[]>>) => void }) {
  const [picked, setPicked] = useState<Partial<Record<"stages" | "geographies" | "sectors", string[]>>>({});
  const ready = item.missing.every((m) => (picked[FIELD_KEY[m]] ?? []).length > 0);
  return (
    <li className="border-t border-border py-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <p className="text-body-sm text-heading">
          {item.name} <span className="text-muted">({item.kind === "angel" ? "angel" : "fund"})</span>
          {item.website ? (
            <a className="ml-sm text-primary underline" href={item.website.startsWith("http") ? item.website : `https://${item.website}`} target="_blank" rel="noreferrer noopener">
              website
            </a>
          ) : null}
        </p>
        <button type="button" className={smallButton} disabled={busy || !ready} onClick={() => onSave(picked)}>
          Save
        </button>
      </div>
      <div className="mt-xs space-y-xs">
        {item.missing.map((m) => {
          const key = FIELD_KEY[m];
          const current = item[key];
          return (
            <div key={m} className="grid grid-cols-[96px_1fr] items-start gap-sm">
              <span className="pt-[3px] text-label uppercase tracking-label text-muted">{MISSING_LABEL[m]}</span>
              <div>
                <ChipPicker options={options[key]} value={picked[key] ?? []} disabled={busy} onChange={(v) => setPicked({ ...picked, [key]: v })} />
                {current.length ? <p className="mt-[2px] text-body-sm text-muted">Research said {current.join(", ")}, which the taxonomy doesn&apos;t map.</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </li>
  );
}

/** Step 3: The Final Roster. */
export function FinalRoster({ clientId, clientName, refreshKey }: { clientId: string; clientName: string; refreshKey: number }) {
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

  // Confirmed: the green summary card.
  if (state.saved) {
    const saved = state.saved;
    return (
      <Card tone="final">
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0 flex-1">
            <BigNumber value={saved.counts.total} label="Step 3 · The Final Roster: confirmed" />
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
            Changed since it was confirmed: {state.changed.join(" ")} Reopen to rebuild it.
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
        {errorLine}
      </Card>
    );
  }

  const { draft, fill, options } = state;
  const c = draft.counts;
  return (
    <div className="space-y-md">
      {fill.length ? (
        <Card>
          <h3 className="text-h4 text-heading">Step 3A: Fill in missing fields</h3>
          <p className="max-w-prose text-body-sm text-secondary">
            {n(fill.length)} added {fill.length === 1 ? "investor is" : "investors are"} missing a field the Step 1 filters need. Choose the values; nothing is guessed. The Roster
            can&apos;t be confirmed until these are done.
          </p>
          <ul className="mt-sm">
            {fill.map((item) => (
              <FillRow key={item.addedId} item={item} options={options} busy={busy !== null} onSave={(fields) => void run(`fill-${item.addedId}`, () => fillRosterFields(clientId, item.addedId, fields))} />
            ))}
          </ul>
          {errorLine}
        </Card>
      ) : null}

      <Card tone="final">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <BigNumber value={c.total} label="The Final Roster" />
          <button type="button" className={primaryButton} disabled={busy !== null || c.addedMissing > 0} onClick={() => void run("confirm", () => confirmFinalRoster(clientId))}>
            {busy === "confirm" ? "Saving…" : "Confirm Roster"}
          </button>
        </div>
        {state.facts.step2Skipped ? <p className="text-body-sm text-muted">Step 2 was skipped (no funded competitors): the Roster is the Dry Match minus exclusions.</p> : null}
        {c.addedMissing > 0 ? <p className="mt-xs text-body-sm text-warning">Fill in the missing fields above first ({n(c.addedMissing)} to go).</p> : null}
        <SummaryTable counts={c} />
        <p className="mt-sm text-body-sm text-muted">
          Added in 2D: {n(c.added)} in, {n(c.addedFailed)} out on the filters{c.addedMissing ? `, ${n(c.addedMissing)} waiting` : ""}. Exclusions: only clear matches count;
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
