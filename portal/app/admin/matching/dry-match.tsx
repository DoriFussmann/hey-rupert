"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDryMatch } from "@/app/admin/dry-match-actions";
import { DRY_STEPS, DRY_STEP_LABEL, expandStage, funnel, type DryData, type DryFund, type DryStep } from "@/lib/match/dry/core";
import { primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";

const n = (value: number) => value.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

/** A card that slides in from the side when it appears. */
function Card({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "result" | "final" }) {
  const look =
    tone === "result" ? "border-primary/40 bg-primary-tint/40" : tone === "final" ? "border-primary bg-primary-tint/60" : "border-border bg-surface";
  return <section className={`animate-slide-in rounded-card border px-lg py-md ${look}`}>{children}</section>;
}

function BigNumber({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-label uppercase tracking-label text-muted">{label}</p>
      <p className="text-h1 font-light text-heading">{n(value)}</p>
    </div>
  );
}

/** A dropdown of checkboxes, in the house style. */
function MultiSelect({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { id: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const picked = options.filter((o) => value.includes(o.id)).map((o) => o.label);
  return (
    <details className="group/drop relative w-full max-w-md">
      <summary
        className={`flex min-h-[44px] list-none items-center justify-between gap-md rounded-md border border-border bg-background px-md py-sm text-body-sm [&::-webkit-details-marker]:hidden ${disabled ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
      >
        <span className="text-heading">{picked.length ? picked.join(", ") : "Choose…"}</span>
        <span className="text-muted transition-transform duration-hover group-open/drop:rotate-180">▾</span>
      </summary>
      <div className="absolute z-20 mt-xs max-h-72 w-full overflow-auto rounded-md border border-border bg-surface p-xs shadow-lg">
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
    </details>
  );
}

function labelsOf(data: DryData, step: DryStep, ids: string[]) {
  const shown = step === "stage" ? expandStage(ids) : ids;
  return data.options[step].filter((o) => shown.includes(o.id)).map((o) => o.label).join(", ");
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

/**
 * Dry Match: the new step-by-step shortlist. Each step shows the company's
 * own choice (from the profile), lets the admin change it, and on Confirm
 * shows how many funds it removed and how many are left. Nothing is saved.
 */
export function DryMatch({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [data, setData] = useState<DryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Partial<Record<DryStep, string[]>>>({});
  const [confirmed, setConfirmed] = useState<Partial<Record<DryStep, string[]>>>({});
  /** How many steps are open: 0 = only the total; a step opens on Next. */
  const [open, setOpen] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    setConfirmed({});
    setOpen(0);
    setDone(false);
    void loadDryMatch(clientId).then((result) => {
      if (!live) return;
      if (!result.ok) return setError(result.error);
      setData(result.data);
      setChoices({ ...result.data.defaults });
      setOpen(1);
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  const steps = useMemo(() => (data ? funnel(data, confirmed) : []), [data, confirmed]);

  if (error) return <p className="rounded-card border border-error/40 bg-surface px-lg py-md text-body-sm text-error">{error}</p>;
  if (!data) return <p className="text-body-sm text-muted">Loading the Fund Database…</p>;

  const total = data.funds.length;
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
            <Card>
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
                  {open === i + 1 ? (
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
            <button type="button" className={secondaryButton} onClick={() => download(data, final.funds, clientName)}>
              Download the list (CSV)
            </button>
          </div>
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
              {steps.map((s, i) => (
                <tr key={s.step} className="border-t border-border">
                  <td className="py-xs pr-md text-heading">
                    {i + 1}. {DRY_STEP_LABEL[s.step]}
                  </td>
                  <td className="py-xs pr-md text-secondary">{labelsOf(data, s.step, confirmed[s.step] ?? [])}</td>
                  <td className="py-xs pr-md text-right">{n(s.before)}</td>
                  <td className="py-xs pr-md text-right text-error">−{n(s.removed)}</td>
                  <td className="py-xs pr-md text-right text-heading">{n(s.left)}</td>
                  <td className="py-xs text-right">{pct(s.left, s.before)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-primary">
                <td className="py-xs pr-md text-heading" colSpan={4}>
                  Dry Match Short List
                </td>
                <td className="py-xs pr-md text-right text-heading">{n(final.left)}</td>
                <td className="py-xs text-right">{pct(final.left, total)} of all</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-md text-body-sm text-muted">
            Generalists in the list: {n(final.funds.filter((f) => f.generalist).length)}. Exclusions, contacts and duplicates are not applied yet.
          </p>
          <div className="mt-md max-h-[480px] overflow-auto rounded-md border border-border bg-surface">
            <table className="w-full text-left text-body-sm">
              <thead className="sticky top-0 bg-surface text-label uppercase tracking-label text-muted">
                <tr>
                  <th className="px-sm py-xs font-medium">Fund</th>
                  <th className="px-sm py-xs font-medium">Stage</th>
                  <th className="px-sm py-xs font-medium">Geography</th>
                  <th className="px-sm py-xs font-medium">Sectors</th>
                </tr>
              </thead>
              <tbody>
                {final.funds.map((fund) => {
                  const c = fundCells(data, fund);
                  return (
                    <tr key={`${fund.id}-${c.name}`} className="border-t border-border align-top">
                      <td className="px-sm py-xs text-heading">
                        {c.name}
                        {fund.generalist ? <span className="ml-xs text-label uppercase text-muted">generalist</span> : null}
                      </td>
                      <td className="px-sm py-xs text-secondary">{c.stage}</td>
                      <td className="px-sm py-xs text-secondary">{c.geography}</td>
                      <td className="px-sm py-xs text-secondary">{c.sectors}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
