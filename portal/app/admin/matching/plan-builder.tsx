"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmPlanAction } from "@/app/admin/capacity-actions";
import { cardClass, errorText, inputClass, labelClass, n, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/match/ui";
import {
  CORE_CAP,
  DEFAULT_SPLIT,
  SOURCES,
  SOURCE_LABEL,
  TIER_CEILING,
  suggestCounts,
  weightProblems,
  type Counts,
  type PlanSource,
  type Sizes,
  type SplitTier,
  type Weights,
} from "@/lib/match/capacity/allocate";
import { countsTotal, monthsNeeded } from "@/lib/match/capacity/plan";
import { DEFAULT_INPUTS, INPUT_LIMITS, benchmarkFor, compareToBenchmark, inputProblems, schedule, type CapacityInputs } from "@/lib/match/capacity/schedule";

type Boxes = Record<keyof CapacityInputs, string>;
type CountBoxes = Record<PlanSource, string>;
type WeightBoxes = Record<SplitTier, string>;

const SPLIT_TIERS: SplitTier[] = ["sphere", "tier3", "tier4"];

/** Everything but the campaign length, under "Sending setup". */
const SETUP: (keyof CapacityInputs)[] = [
  "inboxes",
  "emailsPerInboxPerDay",
  "warmupWeeks",
  "warmupPercent",
  "sendingDaysPerWeek",
  "contactsPerFirm",
  "followUps",
  "followUpDelayDays",
];

const HINT: Partial<Record<keyof CapacityInputs, string>> = {
  contactsPerFirm: "2 = Primary + Backup.",
  followUps: "2 = the Email Copy sequence (first email and two follow-ups).",
  followUpDelayDays: "Calendar days from one email to the next.",
  sendingDaysPerWeek: "5 = Monday to Friday.",
  warmupPercent: "Each later warm-up week steps up evenly to full. 2 weeks at 33% of 30 = 10, then 20, then 30 a day.",
  emailsPerInboxPerDay: "Follow-ups included. Never more than 30 per inbox.",
};

const BENCHMARK_TEXT = { under: "under", on: "on", over: "over" } as const;

function toBoxes(inputs: CapacityInputs): Boxes {
  return Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value)])) as Boxes;
}

function toInputs(boxes: Boxes): CapacityInputs {
  return Object.fromEntries(Object.entries(boxes).map(([key, value]) => [key, value.trim() === "" ? Number.NaN : Number(value)])) as CapacityInputs;
}

function toCountBoxes(counts: Counts): CountBoxes {
  return Object.fromEntries(SOURCES.map((source) => [source, String(counts[source])])) as CountBoxes;
}

function toCounts(boxes: CountBoxes): Counts {
  return Object.fromEntries(SOURCES.map((source) => [source, boxes[source].trim() === "" ? 0 : Number(boxes[source])])) as Counts;
}

function toWeightBoxes(weights: Weights): WeightBoxes {
  return { sphere: String(weights.sphere), tier3: String(weights.tier3), tier4: String(weights.tier4) };
}

function toWeights(boxes: WeightBoxes): Weights {
  const value = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));
  return { sphere: value(boxes.sphere), tier3: value(boxes.tier3), tier4: value(boxes.tier4) };
}

function percentOf(count: number, base: number) {
  return base > 0 ? Math.round((count / base) * 100) : 0;
}

/**
 * Builds the campaign plan for the newest run: campaign months first, then
 * Calculate gives the funds the inboxes can work through and a suggested
 * split across the tiers, by weights the admin can change. Any number can
 * then be edited. Only Confirm plan saves anything (with the weights), and
 * only a plan no tier is short for.
 */
export function PlanBuilder({
  clientId,
  runId,
  sizes,
  initial,
  initialLabel,
  nextVersion,
}: {
  clientId: string;
  runId: string;
  /** Eligible funds per tier, after any removed from this run's campaign. */
  sizes: Sizes;
  /** Where the builder starts: this run's confirmed plan, or the previous run's. */
  initial: { inputs: CapacityInputs; counts: Counts; useGeneralists: boolean; weights: Weights } | null;
  /** The button that puts the starting split back. */
  initialLabel: string;
  nextVersion: number;
}) {
  const router = useRouter();
  const [boxes, setBoxes] = useState<Boxes>(toBoxes(initial?.inputs ?? DEFAULT_INPUTS));
  const [useGeneralists, setUseGeneralists] = useState(initial?.useGeneralists ?? false);
  const [countBoxes, setCountBoxes] = useState<CountBoxes | null>(initial ? toCountBoxes(initial.counts) : null);
  const [weightBoxes, setWeightBoxes] = useState<WeightBoxes>(toWeightBoxes(initial?.weights ?? DEFAULT_SPLIT));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const inputs = useMemo(() => toInputs(boxes), [boxes]);
  const problems = useMemo(() => inputProblems(inputs), [inputs]);
  const capacity = useMemo(() => (problems.length === 0 ? schedule(inputs) : null), [inputs, problems.length]);
  const fundsRequired = capacity?.firms ?? null;
  const counts = countBoxes ? toCounts(countBoxes) : null;
  const total = counts ? countsTotal(counts) : 0;
  const needed = useMemo(
    () => (problems.length === 0 && Number.isFinite(total) && total > 0 ? monthsNeeded(inputs, total) : null),
    [inputs, problems.length, total],
  );
  const benchmark = benchmarkFor(inputs.months);
  const weights = toWeights(weightBoxes);
  const weightIssues = weightProblems(weights);

  const rows = SOURCES.filter((source) => source !== "generalist" || useGeneralists).map((source) => {
    const planned = counts ? counts[source] : 0;
    return { source, available: sizes[source], planned, short: Math.max(0, (Number.isFinite(planned) ? planned : 0) - sizes[source]) };
  });

  const countProblems: string[] = [];
  if (counts) {
    for (const source of SOURCES) {
      if (!Number.isInteger(counts[source]) || counts[source] < 0) countProblems.push(`${SOURCE_LABEL[source]}: a whole number, 0 or more.`);
    }
    if (counts.core > CORE_CAP) countProblems.push(`Core is capped at ${CORE_CAP} funds.`);
    for (const row of rows) if (row.short > 0) countProblems.push(`${SOURCE_LABEL[row.source]} is short by ${n(row.short)}: lower it, or move funds to a tier that has them.`);
    if (total < 1) countProblems.push("Plan at least one fund.");
  }
  const canConfirm = Boolean(counts) && problems.length === 0 && weightIssues.length === 0 && countProblems.length === 0 && !saving;
  const unfilled = fundsRequired !== null && Number.isFinite(total) ? Math.max(0, fundsRequired - total) : 0;

  function calculate() {
    if (fundsRequired === null || weightIssues.length > 0) return;
    setCountBoxes(toCountBoxes(suggestCounts(sizes, fundsRequired, useGeneralists, weights)));
    setMessage(null);
  }

  function setCount(source: PlanSource, value: string) {
    setCountBoxes((current) => (current ? { ...current, [source]: value.replace(/[^\d]/g, "") } : current));
  }

  function toggleGeneralists(next: boolean) {
    setUseGeneralists(next);
    if (!next) setCountBoxes((current) => (current ? { ...current, generalist: "0" } : current));
  }

  async function confirm() {
    if (!counts) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await confirmPlanAction(clientId, runId, { inputs, counts, useGeneralists, weights }, note);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setMessage({ kind: "ok", text: `Plan version ${result.version} confirmed. The Tiers tab now shows the campaign.` });
      setNote("");
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "The plan was not saved.") });
    } finally {
      setSaving(false);
    }
  }

  const box = (key: keyof CapacityInputs) => {
    const { min, max, label } = INPUT_LIMITS[key];
    return (
      <label key={key} className="text-body-sm">
        <span className={labelClass}>{label}</span>
        <input
          inputMode="numeric"
          className={`${inputClass} mt-xs font-mono`}
          value={boxes[key]}
          aria-describedby={`${key}-hint`}
          onChange={(event) => setBoxes((current) => ({ ...current, [key]: event.target.value }))}
        />
        <span id={`${key}-hint`} className="mt-xs block text-label text-muted">
          {HINT[key] ? `${HINT[key]} ` : ""}
          {min}–{max}
        </span>
      </label>
    );
  };

  return (
    <div className="space-y-lg">
      <section className={`${cardClass} px-lg py-md`}>
        <div className="flex flex-wrap items-end gap-md">
          <label className="text-body-sm">
            <span className={labelClass}>Campaign months</span>
            <input
              inputMode="numeric"
              className={`${inputClass} mt-xs w-28 font-mono text-h4`}
              value={boxes.months}
              aria-describedby="months-hint"
              onChange={(event) => setBoxes((current) => ({ ...current, months: event.target.value }))}
            />
          </label>
          <button type="button" className={primaryButton} disabled={fundsRequired === null || weightIssues.length > 0} onClick={calculate}>
            {countBoxes ? "Recalculate" : "Calculate"}
          </button>
          <p id="months-hint" className="text-body-sm text-secondary">
            {fundsRequired === null ? (
              "Fix the inputs to calculate."
            ) : (
              <>
                The inboxes can work through <span className="text-heading">{n(fundsRequired)} funds</span> in {inputs.months} month{inputs.months === 1 ? "" : "s"}.
                {benchmark !== null
                  ? ` Planning benchmark ${n(benchmark)} (${BENCHMARK_TEXT[compareToBenchmark(fundsRequired, benchmark).status]}).`
                  : ""}
              </>
            )}
          </p>
        </div>
        <details className="mt-md">
          <summary className="cursor-pointer text-body-sm text-secondary hover:text-heading">Sending setup</summary>
          <div className="mt-sm grid gap-sm sm:grid-cols-2 lg:grid-cols-4">{SETUP.map(box)}</div>
          {capacity ? (
            <ul className="mt-sm list-disc pl-lg text-body-sm text-secondary">
              <li>
                {n(capacity.capacity)} sends in {n(capacity.sendingDays)} sending days; {Math.round(capacity.utilization * 100)}% used. {capacity.emailsPerFirm} emails per fund.
              </li>
              {capacity.bottlenecks.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </details>
        <label className="mt-md flex items-start gap-sm text-body-sm text-secondary">
          <input type="checkbox" className="mt-xs h-4 w-4 accent-primary" checked={useGeneralists} onChange={(event) => toggleGeneralists(event.target.checked)} />
          <span>
            Approve generalists to fill a shortfall ({n(sizes.generalist)} available). The founder sees them apart, as &quot;Also worth considering: broad investors&quot;, never as a tier.
          </span>
        </label>
        {problems.length > 0 ? (
          <ul role="alert" className="mt-md list-disc pl-lg text-body-sm text-error">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {countBoxes && counts ? (
        <section className={`${cardClass} px-lg py-md`}>
          <h2 className="text-h4 text-heading">Split across the tiers</h2>
          <p className="mt-xs text-body-sm text-muted">
            Core first (up to {CORE_CAP}). The rest is shared by these weights, as targets: a tier that runs out passes its share to the others by weight, but no tier
            takes more than {TIER_CEILING}× its target. What no tier can take is shown as a shortfall. Then change any number below.
          </p>
          <div className="mt-sm flex flex-wrap items-end gap-sm">
            {SPLIT_TIERS.map((tier) => (
              <label key={tier} className="text-body-sm">
                <span className={labelClass}>{SOURCE_LABEL[tier]} weight (%)</span>
                <input
                  inputMode="numeric"
                  className={`${inputClass} mt-xs w-24 text-right font-mono`}
                  value={weightBoxes[tier]}
                  onChange={(event) => setWeightBoxes((current) => ({ ...current, [tier]: event.target.value.replace(/[^\d]/g, "") }))}
                />
              </label>
            ))}
            <button type="button" className={secondaryButton} disabled={fundsRequired === null || weightIssues.length > 0} onClick={calculate}>
              Apply weights
            </button>
          </div>
          {weightIssues.length > 0 ? (
            <p role="alert" className="mt-xs text-body-sm text-error">
              {weightIssues.join(" ")}
            </p>
          ) : null}
          <div className="mt-sm overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-body-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-xs pr-md font-normal">Tier</th>
                  <th className="py-xs pr-md text-right font-normal">Available</th>
                  <th className="py-xs pr-md text-right font-normal">Planned</th>
                  <th className="py-xs pr-md text-right font-normal">Share</th>
                  <th className="py-xs font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.source} className="border-b border-border">
                    <td className="py-xs pr-md text-heading">{SOURCE_LABEL[row.source]}</td>
                    <td className="py-xs pr-md text-right tabular-nums">{n(row.available)}</td>
                    <td className="py-xs pr-md text-right">
                      <input
                        inputMode="numeric"
                        aria-label={`${SOURCE_LABEL[row.source]}: funds planned`}
                        className={`${inputClass} ml-auto w-24 text-right font-mono`}
                        value={countBoxes[row.source]}
                        onChange={(event) => setCount(row.source, event.target.value)}
                      />
                    </td>
                    <td className="py-xs pr-md text-right tabular-nums">{Number.isFinite(total) ? `${percentOf(row.planned, total)}%` : "–"}</td>
                    <td className={`py-xs ${row.short > 0 ? "text-error" : "text-secondary"}`}>
                      {row.short > 0 ? `Short by ${n(row.short)}` : row.source === "core" && row.planned > CORE_CAP ? `Over the cap of ${CORE_CAP}` : "OK"}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-xs pr-md text-heading">Total</td>
                  <td className="py-xs pr-md text-right tabular-nums">{n(rows.reduce((sum, row) => sum + row.available, 0))}</td>
                  <td className="py-xs pr-md text-right tabular-nums text-heading">{Number.isFinite(total) ? n(total) : "–"}</td>
                  <td className="py-xs pr-md text-right tabular-nums">{total > 0 ? "100%" : "–"}</td>
                  <td className="py-xs text-secondary" />
                </tr>
              </tbody>
            </table>
          </div>
          <p className={`mt-sm text-body-sm ${needed !== null && needed > inputs.months ? "text-warning" : "text-secondary"}`}>
            {total < 1 || !Number.isFinite(total)
              ? "Plan at least one fund."
              : needed === null
                ? `${n(total)} funds don't fit in ${INPUT_LIMITS.months.max} months with this sending setup.`
                : `${n(total)} funds need ${needed} month${needed === 1 ? "" : "s"} with this sending setup${needed > inputs.months ? `: more than the ${inputs.months} chosen` : ""}.`}
          </p>
          {unfilled > 0 && fundsRequired !== null ? (
            <p className="mt-xs text-body-sm text-warning">
              The plan fills {n(total)} of the {n(fundsRequired)} funds the inboxes can work through: {n(unfilled)} short.
              {!useGeneralists && sizes.generalist > 0 ? " Approve generalists above to offer them as a separate top-up, then Apply weights." : ""}
            </p>
          ) : null}
          {countProblems.length > 0 ? (
            <ul role="alert" className="mt-sm list-disc pl-lg text-body-sm text-error">
              {countProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-md border-t border-border pt-md">
            <label className="block text-body-sm text-secondary">
              Note (optional)
              <input className={`${inputClass} mt-xs`} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
            </label>
            <div className="mt-sm flex flex-wrap items-center gap-sm">
              <button type="button" className={primaryButton} disabled={!canConfirm} onClick={() => void confirm()}>
                {saving ? "Confirming…" : `Confirm plan (version ${nextVersion})`}
              </button>
              {initial ? (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={saving}
                  onClick={() => {
                    setCountBoxes(toCountBoxes(initial.counts));
                    setWeightBoxes(toWeightBoxes(initial.weights));
                  }}
                >
                  {initialLabel}
                </button>
              ) : null}
            </div>
            <p className="mt-xs text-body-sm text-muted">Confirming saves a new version. It doesn&apos;t push a list or send anything.</p>
            {message ? (
              <p role={message.kind === "error" ? "alert" : "status"} className={`mt-xs text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}>
                {message.text}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
