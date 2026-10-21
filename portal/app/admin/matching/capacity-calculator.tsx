"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveCapacityPlanAction } from "@/app/admin/capacity-actions";
import { cardClass, errorText, inputClass, labelClass, n, primaryButton } from "@/app/admin/clients/[id]/match/ui";
import { SOURCE_LABEL, type PlanSource, type PoolFirm } from "@/lib/match/capacity/allocate";
import { buildPlanFromPools, planProblems, type CapacityPlan, type PlanRequest } from "@/lib/match/capacity/plan";
import {
  BENCHMARKS,
  DEFAULT_INPUTS,
  INPUT_LIMITS,
  compareToBenchmark,
  inputProblems,
  schedule,
  type CapacityInputs,
} from "@/lib/match/capacity/schedule";

type Boxes = Record<keyof CapacityInputs, string>;

const INFRA: (keyof CapacityInputs)[] = ["inboxes", "emailsPerInboxPerDay", "warmupWeeks", "warmupPercent", "sendingDaysPerWeek", "months"];
const SEQUENCE: (keyof CapacityInputs)[] = ["contactsPerFirm", "followUps", "followUpDelayDays"];

const HINT: Partial<Record<keyof CapacityInputs, string>> = {
  contactsPerFirm: "2 = Primary + Backup, as outreach is sequenced today.",
  followUps: "2 = the Email Copy sequence (first email and two follow-ups).",
  followUpDelayDays: "Calendar days from one email to the next.",
  sendingDaysPerWeek: "5 = Monday to Friday.",
  warmupPercent: "Share of normal capacity during warm-up.",
};

function toBoxes(inputs: CapacityInputs): Boxes {
  return Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value)])) as Boxes;
}

function toInputs(boxes: Boxes): CapacityInputs {
  return Object.fromEntries(Object.entries(boxes).map(([key, value]) => [key, value.trim() === "" ? Number.NaN : Number(value)])) as CapacityInputs;
}

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border px-sm py-xs">
      <p className="text-label text-muted">{label}</p>
      <p className="text-h4 tabular-nums text-heading">{value}</p>
      {hint ? <p className="text-label text-muted">{hint}</p> : null}
    </div>
  );
}

const STATUS_TEXT = { under: "Under the benchmark", on: "On the benchmark (within 5%)", over: "Over the benchmark" } as const;

/**
 * The capacity calculator for one saved run. Everything recalculates
 * in the browser as the inputs change; only Save plan writes anything.
 */
export function CapacityCalculator({
  clientId,
  runId,
  pools,
  nextVersion,
}: {
  clientId: string;
  runId: string;
  pools: Record<PlanSource, PoolFirm[]>;
  nextVersion: number;
}) {
  const router = useRouter();
  const [boxes, setBoxes] = useState<Boxes>(toBoxes(DEFAULT_INPUTS));
  const [targetBox, setTargetBox] = useState("");
  const [useGeneralists, setUseGeneralists] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const request: PlanRequest = useMemo(
    () => ({ inputs: toInputs(boxes), target: targetBox.trim() === "" ? null : Number(targetBox), useGeneralists }),
    [boxes, targetBox, useGeneralists],
  );
  const problems = planProblems(request);
  const plan: CapacityPlan | null = useMemo(() => (problems.length === 0 ? buildPlanFromPools(pools, request) : null), [pools, request, problems.length]);
  const benchmarks = useMemo(() => {
    const base = request.inputs;
    return BENCHMARKS.map((benchmark) => {
      const inputs = { ...base, months: benchmark.months };
      if (inputProblems(inputs).length > 0) return { ...benchmark, calculated: null as number | null, status: null as null | ReturnType<typeof compareToBenchmark> };
      const calculated = schedule(inputs).firms;
      return { ...benchmark, calculated, status: compareToBenchmark(calculated, benchmark.firms) };
    });
  }, [request.inputs]);

  async function save() {
    if (!plan) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveCapacityPlanAction(clientId, runId, request, note);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setMessage({ kind: "ok", text: `Saved as plan version ${result.version}. Nothing was pushed or sent.` });
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
          aria-describedby={HINT[key] ? `${key}-hint` : undefined}
          onChange={(event) => setBoxes((current) => ({ ...current, [key]: event.target.value }))}
        />
        <span id={`${key}-hint`} className="mt-xs block text-label text-muted">
          {HINT[key] ? `${HINT[key]} ` : ""}
          {min}–{max}
        </span>
      </label>
    );
  };

  const c = plan?.capacity;
  const a = plan?.allocation;
  return (
    <div className="space-y-lg">
      <section className={`${cardClass} px-lg py-md`}>
        <h2 className="text-h4 text-heading">Inputs</h2>
        <p className="mt-xs text-body-sm text-muted">Nothing is saved while you change these. Save plan records a version.</p>
        <p className={`${labelClass} mt-md`}>Email infrastructure</p>
        <div className="mt-xs grid gap-sm sm:grid-cols-2 lg:grid-cols-3">{INFRA.map(box)}</div>
        <p className={`${labelClass} mt-md`}>Outreach sequence</p>
        <div className="mt-xs grid gap-sm sm:grid-cols-2 lg:grid-cols-3">{SEQUENCE.map(box)}</div>
        <div className="mt-md grid gap-sm sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-body-sm">
            <span className={labelClass}>Target unique firms</span>
            <input
              inputMode="numeric"
              className={`${inputClass} mt-xs font-mono`}
              value={targetBox}
              placeholder={c ? `Blank = capacity (${n(c.firms)})` : "Blank = capacity"}
              onChange={(event) => setTargetBox(event.target.value)}
            />
            <span className="mt-xs block text-label text-muted">Work backward from a campaign size, or leave blank to plan for what the inboxes can reach.</span>
          </label>
          <label className="flex items-start gap-sm self-center text-body-sm text-secondary">
            <input type="checkbox" className="mt-xs h-4 w-4 accent-primary" checked={useGeneralists} onChange={(event) => setUseGeneralists(event.target.checked)} />
            <span>
              I approve topping up a shortfall with generalists. They stay labelled as generalists, never as a tier, and the plan still needs review before any list or campaign.
            </span>
          </label>
        </div>
        {problems.length > 0 ? (
          <ul role="alert" className="mt-md list-disc pl-lg text-body-sm text-error">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {plan && c && a ? (
        <>
          <section className={`${cardClass} px-lg py-md`}>
            <h2 className="text-h4 text-heading">Email capacity</h2>
            <div className="mt-sm grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Available sends" value={n(c.capacity)} hint={`${n(c.sendingDays)} sending days in ${n(c.days)} calendar days`} />
              <Fact label="Initial emails" value={n(c.initialEmails)} />
              <Fact label="Follow-up emails" value={n(c.followUpEmails)} />
              <Fact label="Utilization" value={pct(c.utilization)} hint={`${n(c.unused)} sends unused`} />
              <Fact label="Contacts reached" value={n(c.contactsReached)} />
              <Fact label="Unique firms the inboxes reach" value={n(c.firms)} hint={`${c.emailsPerFirm} emails per firm`} />
              <Fact label="Daily capacity" value={n(c.dailyNormal)} hint={`${n(c.dailyWarmup)} during warm-up (${n(c.warmupSendingDays)} days)`} />
              <Fact label="Plain division would say" value={n(c.naiveFirms)} hint="Capacity ÷ emails per firm, ignoring follow-up timing" />
            </div>
            {plan.reach ? (
              <p className={`mt-sm text-body-sm ${plan.reach.fits ? "text-success" : "text-warning"}`}>
                {plan.reach.fits
                  ? `The inboxes reach the target of ${n(plan.target)} firms: the last one starts on day ${n(plan.reach.lastStartDay + 1)} of ${n(c.days)}.`
                  : `The inboxes reach ${n(plan.reach.firmsAtTarget)} of ${n(plan.target)} firms in ${request.inputs.months} month${request.inputs.months === 1 ? "" : "s"}. ${
                      plan.reach.inboxesNeeded ? `${plan.reach.inboxesNeeded} inboxes would reach the target, with the other inputs unchanged.` : `Even ${INPUT_LIMITS.inboxes.max} inboxes would not: lengthen the campaign or shorten the sequence.`
                    }`}
              </p>
            ) : null}
            <ul className="mt-sm list-disc pl-lg text-body-sm text-secondary">
              {c.bottlenecks.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>

          <section className={`${cardClass} px-lg py-md`}>
            <h2 className="text-h4 text-heading">Planning benchmarks</h2>
            <p className="mt-xs text-body-sm text-muted">Reference targets only. The capacity above always comes from your inputs.</p>
            <div className="mt-sm overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-body-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="py-xs pr-md font-normal">Campaign</th>
                    <th className="py-xs pr-md text-right font-normal">Reference firms</th>
                    <th className="py-xs pr-md text-right font-normal">These inputs</th>
                    <th className="py-xs font-normal">Compared with the reference</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarks.map((b) => (
                    <tr key={b.months} className={`border-b border-border ${b.months === request.inputs.months ? "text-heading" : "text-secondary"}`}>
                      <td className="py-xs pr-md">
                        {b.months} month{b.months === 1 ? "" : "s"}
                        {b.months === request.inputs.months ? " (selected)" : ""}
                      </td>
                      <td className="py-xs pr-md text-right tabular-nums">{n(b.firms)}</td>
                      <td className="py-xs pr-md text-right tabular-nums">{b.calculated === null ? "–" : n(b.calculated)}</td>
                      <td className="py-xs">
                        {b.status ? `${STATUS_TEXT[b.status.status]} (${b.status.difference >= 0 ? "+" : ""}${n(b.status.difference)})` : "Inputs don't fit this length"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${cardClass} px-lg py-md`}>
            <h2 className="text-h4 text-heading">Allocation across the tiers</h2>
            <p className="mt-xs text-body-sm text-muted">
              Target {n(plan.target)} firms ({plan.targetSource === "entered" ? "entered" : "the inboxes' capacity"}). Core first (capped at 10), then Sphere, Tier 3 and Tier 4 in full before the next. Generalists only for what the four tiers can&apos;t fill.
            </p>
            <div className="mt-sm overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-body-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="py-xs pr-md font-normal">Tier or source</th>
                    <th className="py-xs pr-md text-right font-normal">Available</th>
                    <th className="py-xs pr-md text-right font-normal">Planned</th>
                    <th className="py-xs pr-md text-right font-normal">Remaining</th>
                    <th className="py-xs font-normal">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {a.rows.map((row) => (
                    <tr key={row.source} className="border-b border-border">
                      <td className="py-xs pr-md text-heading">{SOURCE_LABEL[row.source]}</td>
                      <td className="py-xs pr-md text-right tabular-nums">{n(row.available)}</td>
                      <td className="py-xs pr-md text-right tabular-nums text-heading">{n(row.planned)}</td>
                      <td className="py-xs pr-md text-right tabular-nums">{n(row.remaining)}</td>
                      <td className="py-xs text-secondary">{row.note}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-xs pr-md text-heading">Total</td>
                    <td className="py-xs pr-md text-right tabular-nums">{n(a.rows.reduce((sum, row) => sum + row.available, 0))}</td>
                    <td className="py-xs pr-md text-right tabular-nums text-heading">{n(a.planned)}</td>
                    <td className="py-xs pr-md text-right tabular-nums">{n(a.rows.reduce((sum, row) => sum + row.remaining, 0))}</td>
                    <td className="py-xs text-secondary">
                      {a.shortfall > 0 ? `Shortfall ${n(a.shortfall)}. This run can supply at most ${n(a.maxAchievable)} firms.` : "Target met."}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {a.generalistsProposed > 0 && !useGeneralists ? (
              <p className="mt-sm text-body-sm text-warning">
                {n(a.generalistsProposed)} generalist{a.generalistsProposed === 1 ? "" : "s"} could fill the shortfall. Tick the approval above to include them.
              </p>
            ) : null}
            <details className="mt-sm">
              <summary className="cursor-pointer text-body-sm text-secondary hover:text-heading">Planned firms ({n(a.firms.length)})</summary>
              <ol className="mt-xs max-h-96 list-decimal overflow-auto pl-lg text-body-sm text-secondary">
                {a.firms.map((firm) => (
                  <li key={firm.firmId}>
                    {firm.name} <span className="font-mono text-label text-muted">{firm.firmId}</span> · {SOURCE_LABEL[firm.source]}
                    {firm.score != null ? ` · fit ${firm.score}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          </section>

          <section className={`${cardClass} px-lg py-md`}>
            <h2 className="text-h4 text-heading">Week by week</h2>
            <div className="mt-sm overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-body-sm tabular-nums">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="py-xs pr-md font-normal">Week</th>
                    <th className="py-xs pr-md text-right font-normal">Capacity</th>
                    <th className="py-xs pr-md text-right font-normal">Initial</th>
                    <th className="py-xs pr-md text-right font-normal">Follow-ups</th>
                    <th className="py-xs pr-md text-right font-normal">Unused</th>
                    <th className="py-xs text-right font-normal">Firms started</th>
                  </tr>
                </thead>
                <tbody>
                  {c.weeks.map((week) => (
                    <tr key={week.week} className="border-b border-border text-secondary">
                      <td className="py-xs pr-md">
                        {week.week}
                        {week.warmup ? " (warm-up)" : ""}
                      </td>
                      <td className="py-xs pr-md text-right">{n(week.capacity)}</td>
                      <td className="py-xs pr-md text-right">{n(week.initial)}</td>
                      <td className="py-xs pr-md text-right">{n(week.followUps)}</td>
                      <td className="py-xs pr-md text-right">{n(week.unused)}</td>
                      <td className="py-xs text-right">{n(week.firmsStarted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${cardClass} px-lg py-md`}>
            <h2 className="text-h4 text-heading">Save this plan</h2>
            <p className="mt-xs text-body-sm text-muted">
              Saves version {nextVersion}: the inputs, the capacity and the allocation, with the run, profile version, taxonomy revision and rules version. Earlier
              versions never change. Saving doesn&apos;t push a list or start a campaign.
            </p>
            <label className="mt-sm block text-body-sm text-secondary">
              Note (optional)
              <input className={`${inputClass} mt-xs`} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
            </label>
            <button type="button" className={`${primaryButton} mt-sm`} disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : `Save plan version ${nextVersion}`}
            </button>
            {message ? (
              <p role={message.kind === "error" ? "alert" : "status"} className={`mt-xs text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}>
                {message.text}
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
