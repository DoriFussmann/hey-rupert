"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { confirmDryMatch, loadDryMatch, startOverDryMatch, type DryFacts, type SavedDryList } from "@/app/admin/dry-match-actions";
import { DRY_STEPS, DRY_STEP_LABEL, expandStage, funnel, type DryData, type DryFund, type DryStep } from "@/lib/match/dry/core";
import { primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";

const n = (value: number) => value.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

/** A card that slides in from the side when it appears. */
function Card({ children, tone = "plain", raised = false }: { children: React.ReactNode; tone?: "plain" | "result" | "final"; raised?: boolean }) {
  const look =
    tone === "result" ? "border-primary/40 bg-primary-tint/40" : tone === "final" ? "border-primary bg-primary-tint/60" : "border-border bg-surface";
  return <section className={`relative animate-slide-in rounded-card border px-lg py-md ${raised ? "z-30" : "z-0"} ${look}`}>{children}</section>;
}

function BigNumber({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-label uppercase tracking-label text-muted">{label}</p>
      <p className="text-h1 font-light text-heading">{n(value)}</p>
    </div>
  );
}

/** A dropdown of checkboxes, in the house style. Closes on an outside click, Escape, or when it is locked. */
function MultiSelect({
  options,
  value,
  onChange,
  disabled,
  onOpenChange,
}: {
  options: { id: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const close = useRef(() => setOpen(false));
  close.current = () => setOpen(false);

  useEffect(() => {
    if (disabled) close.current();
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const picked = options.filter((o) => value.includes(o.id)).map((o) => o.label);
  return (
    <div ref={box} className="relative w-full max-w-md">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-[44px] w-full items-center justify-between gap-md rounded-md border border-border bg-background px-md py-sm text-left text-body-sm disabled:cursor-default disabled:opacity-60"
      >
        <span className="text-heading">{picked.length ? picked.join(", ") : "Choose…"}</span>
        {disabled ? null : <span className={`text-muted transition-transform duration-hover ${open ? "rotate-180" : ""}`}>▾</span>}
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-xs max-h-72 overflow-auto rounded-md border border-border bg-surface p-xs shadow-lg">
          {options.map((option) => (
            <label key={option.id} className="flex cursor-pointer items-center gap-sm rounded px-sm py-xs text-body-sm text-body hover:bg-background">
              <input
                type="checkbox"
                className="accent-primary"
                checked={value.includes(option.id)}
                onChange={(event) => onChange(event.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id))}
              />
              {option.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function fundCells(data: DryData, fund: DryFund) {
  const pick = (list: { label: string }[], at: number[]) => at.map((i) => list[i]?.label ?? "").join("; ");
  return {
    name: fund.name,
    financing: pick(data.options.financing, fund.fin),
    stage: pick(data.options.stage, fund.stage),
    geography: fund.geo.map((i) => data.labels.geo[i]).join("; "),
    sectors: fund.sector.map((i) => data.labels.sector[i]).join("; "),
    generalist: fund.generalist ? "Yes" : "",
  };
}

function download(data: DryData, funds: DryFund[], clientName: string) {
  const head = ["FirmID", "Firm name", "Financing", "Stage", "Geography", "Sectors (industry + vertical)", "Generalist"];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  for (const fund of funds) {
    const c = fundCells(data, fund);
    lines.push([fund.id, c.name, c.financing, c.stage, c.geography, c.sectors, c.generalist].map((v) => esc(String(v))).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dry-match-${clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type Row = { label: string; chosen: string; before: number; removed: number; left: number };

/** The bottom line: the funnel table. Used for the live result and the saved list. */
function Summary({
  total,
  rows,
  generalists,
  children,
}: {
  total: number;
  rows: Row[];
  generalists: number | null;
  children?: React.ReactNode;
}) {
  const final = rows.length ? rows[rows.length - 1].left : total;
  return (
    <>
      <table className="mt-md w-full text-left text-body-sm">
        <thead className="text-label uppercase tracking-label text-muted">
          <tr>
            <th className="py-xs pr-md font-medium">Step</th>
            <th className="py-xs pr-md font-medium">Chosen</th>
            <th className="py-xs pr-md text-right font-medium">In</th>
            <th className="py-xs pr-md text-right font-medium">Removed</th>
            <th className="py-xs pr-md text-right font-medium">Left</th>
            <th className="py-xs text-right font-medium">Kept</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <td className="py-xs pr-md text-heading">Fund Database</td>
            <td className="py-xs pr-md text-secondary">All funds</td>
            <td className="py-xs pr-md text-right">–</td>
            <td className="py-xs pr-md text-right">–</td>
            <td className="py-xs pr-md text-right text-heading">{n(total)}</td>
            <td className="py-xs text-right">100%</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={r.label} className="border-t border-border">
              <td className="py-xs pr-md text-heading">
                {i + 1}. {r.label}
              </td>
              <td className="py-xs pr-md text-secondary">{r.chosen}</td>
              <td className="py-xs pr-md text-right">{n(r.before)}</td>
              <td className="py-xs pr-md text-right text-error">−{n(r.removed)}</td>
              <td className="py-xs pr-md text-right text-heading">{n(r.left)}</td>
              <td className="py-xs text-right">{pct(r.left, r.before)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-primary">
            <td className="py-xs pr-md text-heading" colSpan={4}>
              Dry Match Short List
            </td>
            <td className="py-xs pr-md text-right text-heading">{n(final)}</td>
            <td className="py-xs text-right">{pct(final, total)} of all</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-md text-body-sm text-muted">
        {generalists !== null ? `Generalists in the list: ${n(generalists)}. ` : ""}Exclusions, contacts and duplicates are not applied yet.
      </p>
      {children}
    </>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * Dry Match: the step-by-step shortlist. Each step shows the company's own
 * choice (from the profile), lets the admin change it, and on Confirm shows
 * how many funds it removed and how many are left. Confirming the summary
 * saves the list for the next steps; Start over sets it aside.
 */
export function DryMatch({
  clientId,
  clientName,
  onSavedChange,
}: {
  clientId: string;
  clientName: string;
  onSavedChange?: (saved: boolean) => void;
}) {
  const [data, setData] = useState<DryData | null>(null);
  const [facts, setFacts] = useState<DryFacts | null>(null);
  const [saved, setSaved] = useState<SavedDryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [choices, setChoices] = useState<Partial<Record<DryStep, string[]>>>({});
  const [confirmed, setConfirmed] = useState<Partial<Record<DryStep, string[]>>>({});
  /** How many steps are open: 0 = only the total; a step opens on Next. */
  const [open, setOpen] = useState(0);
  const [done, setDone] = useState(false);
  const [openMenu, setOpenMenu] = useState<DryStep | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    setSaved(null);
    setConfirmed({});
    setOpen(0);
    setDone(false);
    void loadDryMatch(clientId).then((result) => {
      if (!live) return;
      if (!result.ok) return setError(result.error);
      setData(result.data);
      setFacts(result.facts);
      setSaved(result.saved);
      setChoices({ ...result.data.defaults });
      setOpen(1);
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  const steps = useMemo(() => (data ? funnel(data, confirmed) : []), [data, confirmed]);
  const hasSaved = saved !== null;
  useEffect(() => {
    onSavedChange?.(hasSaved);
  }, [hasSaved, onSavedChange]);

  if (error && !data) return <p className="rounded-card border border-error/40 bg-surface px-lg py-md text-body-sm text-error">{error}</p>;
  if (!data) return <p className="text-body-sm text-muted">Loading the Fund Database…</p>;

  const total = data.funds.length;
  const errorLine = error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null;

  const startOver = async () => {
    if (!window.confirm("Start over? The confirmed list is set aside (kept on record) and the steps open again from the company's profile.")) return;
    setBusy("start");
    setError(null);
    const result = await startOverDryMatch(clientId);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setSaved(null);
    setConfirmed({});
    setChoices({ ...data.defaults });
    setOpen(1);
    setDone(false);
  };

  if (saved) {
    const byId = new Map(data.funds.map((f) => [f.id, f]));
    const funds = saved.fundIds.map((id) => byId.get(id)).filter((f): f is DryFund => !!f);
    const changed: string[] = [];
    if (facts && saved.facts.fundDbVersion && facts.fundDbVersion !== saved.facts.fundDbVersion) changed.push("the Fund Database");
    if (facts && saved.facts.taxonomyRevision && facts.taxonomyRevision !== saved.facts.taxonomyRevision) changed.push("the taxonomy");
    if (facts && saved.facts.profileVersion && facts.profileVersion !== saved.facts.profileVersion) changed.push("the company profile");
    return (
      <Card tone="final">
        <div className="flex flex-wrap items-end justify-between gap-md">
          <div>
            <BigNumber value={saved.fundCount} label="Dry Match Short List: confirmed" />
            <p className="text-body-sm text-secondary">
              Confirmed {when(saved.confirmedAt)}
              {saved.confirmedBy ? ` by ${saved.confirmedBy}` : ""}. Saved for the next steps.
            </p>
          </div>
          <div className="flex flex-wrap gap-sm">
            <button type="button" className={secondaryButton} disabled={funds.length === 0} onClick={() => download(data, funds, clientName)}>
              Download the list (CSV)
            </button>
            <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void startOver()}>
              {busy === "start" ? "Starting over…" : "Start over"}
            </button>
          </div>
        </div>
        {changed.length ? (
          <p className="mt-sm rounded-md border border-warning/40 bg-surface px-md py-sm text-body-sm text-warning">
            Since this list was confirmed, {changed.join(" and ")} changed. Start over to rebuild it on the current data.
          </p>
        ) : null}
        <Summary
          total={saved.totalFunds}
          generalists={funds.length === saved.fundIds.length ? funds.filter((f) => f.generalist).length : null}
          rows={saved.steps.map((s) => ({ label: DRY_STEP_LABEL[s.step], chosen: s.chosenLabels.join(", "), before: s.before, removed: s.removed, left: s.left }))}
        />
        {errorLine}
      </Card>
    );
  }

  const resetFrom = (i: number) => {
    const keep: Partial<Record<DryStep, string[]>> = {};
    DRY_STEPS.slice(0, i).forEach((s) => {
      if (confirmed[s]) keep[s] = confirmed[s];
    });
    setConfirmed(keep);
    setOpen(i + 1);
    setDone(false);
  };
  const final = steps.length === DRY_STEPS.length ? steps[steps.length - 1] : null;
  const confirmList = async () => {
    setBusy("confirm");
    setError(null);
    const result = await confirmDryMatch(clientId, confirmed);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setSaved(result.saved);
  };
  const chosenText = (step: DryStep) => {
    const ids = step === "stage" ? expandStage(confirmed[step] ?? []) : confirmed[step] ?? [];
    return data.options[step].filter((o) => ids.includes(o.id)).map((o) => o.label).join(", ");
  };

  return (
    <div className="space-y-md">
      <Card>
        <BigNumber value={total} label="Funds in the Fund Database" />
      </Card>

      {DRY_STEPS.slice(0, open).map((step, i) => {
        const isConfirmed = !!confirmed[step];
        const result = steps[i];
        const value = choices[step] ?? [];
        return (
          <div key={step} className="space-y-md">
            <Card raised={openMenu === step}>
              <div className="flex flex-wrap items-baseline justify-between gap-sm">
                <h3 className="text-h4 text-heading">
                  Filter {i + 1}: {DRY_STEP_LABEL[step]}
                </h3>
                <p className="text-body-sm text-muted">{data.defaultsFrom[step]}</p>
              </div>
              <div className="mt-sm flex flex-wrap items-center gap-sm">
                <MultiSelect
                  options={data.options[step]}
                  value={value}
                  disabled={isConfirmed}
                  onChange={(next) => setChoices((c) => ({ ...c, [step]: next }))}
                  onOpenChange={(isOpen) => setOpenMenu((current) => (isOpen ? step : current === step ? null : current))}
                />
                {isConfirmed ? (
                  <button type="button" className={smallButton} onClick={() => resetFrom(i)}>
                    Change
                  </button>
                ) : (
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={value.length === 0}
                    onClick={() => setConfirmed((c) => ({ ...c, [step]: value }))}
                  >
                    Confirm
                  </button>
                )}
              </div>
              {step === "stage" ? <p className="mt-xs text-body-sm text-muted">Pre-Seed and Seed count as one stage: choosing either includes both.</p> : null}
              {step === "geography" ? (
                <p className="mt-xs text-body-sm text-muted">A fund passes if any geography it states is inside the choice (e.g. a US region for the United States) or contains it.</p>
              ) : null}
              {step === "sector" ? (
                <p className="mt-xs text-body-sm text-muted">A fund passes if any of its industries or verticals sits in a chosen sector group.</p>
              ) : null}
            </Card>
            {isConfirmed && result ? (
              <Card tone="result">
                <div className="flex flex-wrap items-end justify-between gap-md">
                  <BigNumber value={result.left} label={`Funds left after ${DRY_STEP_LABEL[step].toLowerCase()}`} />
                  <p className="text-body-sm text-secondary">
                    {n(result.before)} in · <span className="text-error">−{n(result.removed)} removed</span> · {pct(result.left, result.before)} kept
                  </p>
                  {open === i + 1 && !done ? (
                    <button
                      type="button"
                      className={primaryButton}
                      onClick={() => (i + 1 < DRY_STEPS.length ? setOpen(i + 2) : setDone(true))}
                    >
                      {i + 1 < DRY_STEPS.length ? "Next" : "See the Dry Match Short List"}
                    </button>
                  ) : null}
                </div>
              </Card>
            ) : null}
          </div>
        );
      })}

      {done && final ? (
        <Card tone="final">
          <div className="flex flex-wrap items-end justify-between gap-md">
            <BigNumber value={final.left} label="Dry Match Short List" />
            <div className="flex flex-wrap gap-sm">
              <button type="button" className={secondaryButton} onClick={() => download(data, final.funds, clientName)}>
                Download the list (CSV)
              </button>
              <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void confirmList()}>
                {busy === "confirm" ? "Saving…" : "Confirm list"}
              </button>
            </div>
          </div>
          <Summary
            total={total}
            generalists={final.funds.filter((f) => f.generalist).length}
            rows={steps.map((s) => ({ label: DRY_STEP_LABEL[s.step], chosen: chosenText(s.step), before: s.before, removed: s.removed, left: s.left }))}
          >
            <p className="mt-xs text-body-sm text-muted">Confirm list saves it as the base for the next steps. Start over is always available.</p>
          </Summary>
          {errorLine}
        </Card>
      ) : null}
    </div>
  );
}
