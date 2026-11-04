"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { confirmThePlan, loadThePlan, reopenThePlan } from "@/app/admin/plan-actions";
import { inputClass, labelClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/match/ui";
import { BigNumber, Card } from "@/app/admin/matching/dry-match";
import {
  PLAN_DEFAULTS,
  PLAN_INPUT_KEYS,
  PLAN_LIMITS,
  PLAN_TIERS,
  SAME_STAGE_SEEDS_MIN,
  TIER_LABEL,
  TIER_RULE,
  planCapacity,
  planInputProblems,
  rankFunds,
  waterfall,
  type PlanFund,
  type PlanInputs,
  type Planned,
  type Waterfall,
} from "@/lib/match/plan/core";
import type { PlanState, SubSectorView } from "@/lib/match/plan/server";

const n = (value: number) => value.toLocaleString("en-US");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

type Boxes = Record<keyof PlanInputs, string>;
const toBoxes = (i: PlanInputs) => Object.fromEntries(PLAN_INPUT_KEYS.map((k) => [k, String(i[k])])) as Boxes;
const toInputs = (b: Boxes) => Object.fromEntries(PLAN_INPUT_KEYS.map((k) => [k, b[k].trim() === "" ? Number.NaN : Number(b[k])])) as PlanInputs;

function download(planned: Planned[], funds: PlanFund[], clientName: string) {
  const byId = new Map(funds.map((f) => [f.firmId, f]));
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    ["#", "Tier", "Rank in tier", "Investor", "Fund Database ID", "Website", "Contacts used", "Contacts available", "Backed a competitor", "Backed at the client's stage", "Look-alike", "Sub-sectors listed", "Matched on", "Source"].join(","),
    ...planned.map((p, i) => {
      const f = byId.get(p.firmId);
      return [
        String(i + 1),
        TIER_LABEL[p.tier],
        String(p.rank),
        f?.name ?? p.firmId,
        p.firmId,
        f?.website ?? "",
        String(p.slots),
        String(f?.contacts ?? ""),
        f?.backed.join("; ") ?? "",
        f?.sameStage?.join("; ") ?? "",
        f ? f.lookAlike.toFixed(3) : "",
        String(f?.focus ?? ""),
        f?.hit.join("; ") ?? "",
        f?.source ?? "",
      ].map(cell).join(",");
    }),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${clientName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-final-outreach-roster.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SubSectors({ list }: { list: SubSectorView[] }) {
  return (
    <dl className="mt-sm grid gap-x-lg gap-y-xs text-body-sm sm:grid-cols-3">
      {list.map((s) => (
        <div key={s.role}>
          <dt className={labelClass}>{s.role}</dt>
          <dd className="text-heading">
            {s.label}
            {s.sector ? <span className="text-muted"> ({s.sector})</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function WaterfallTable({ w }: { w: Waterfall }) {
  // The Roster's side (who can be approached) | the Plan's side (who fits the campaign).
  const split = "border-l-2 border-primary/50 pl-md";
  const th = "whitespace-nowrap py-xs pr-md text-right font-medium";
  return (
    <div className="mt-md max-w-4xl overflow-x-auto">
      <table className="w-full text-left text-body-sm">
        <thead className="text-label uppercase tracking-label text-muted">
          <tr>
            <th className="whitespace-nowrap py-xs pr-md font-medium">Tier</th>
            <th className={th}>Approachable funds</th>
            <th className={th}># of contacts</th>
            <th className={th}>No contact</th>
            <th className={`${th} ${split}`}>Funds in plan</th>
            <th className={`${th} pr-0`}># of contacts</th>
          </tr>
        </thead>
        <tbody>
          {w.rows.map((r) => (
            <tr key={r.tier} className="border-t border-border">
              <td className="whitespace-nowrap py-xs pr-md text-heading" title={TIER_RULE[r.tier]}>{TIER_LABEL[r.tier]}</td>
              <td className="py-xs pr-md text-right">{n(r.funds)}</td>
              <td className="py-xs pr-md text-right">{n(r.contacts)}</td>
              <td className="py-xs pr-md text-right text-muted">{n(r.noContact)}</td>
              <td className={`py-xs pr-md text-right ${split} ${r.plannedFunds ? "text-success" : "text-muted"}`}>{n(r.plannedFunds)}</td>
              <td className={`py-xs text-right ${r.plannedContacts ? "text-success" : "text-muted"}`}>{n(r.plannedContacts)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-primary">
            <td className="whitespace-nowrap py-xs pr-md text-heading">The Final Outreach Roster</td>
            <td className="py-xs pr-md text-right">{n(w.rows.reduce((s, r) => s + r.funds, 0))}</td>
            <td className="py-xs pr-md text-right">{n(w.rows.reduce((s, r) => s + r.contacts, 0))}</td>
            <td className="py-xs pr-md text-right text-muted">{n(w.rows.reduce((s, r) => s + r.noContact, 0))}</td>
            <td className={`py-xs pr-md text-right text-heading ${split}`}>{n(w.plannedFunds)}</td>
            <td className="py-xs text-right text-heading">{n(w.plannedContacts)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FundTable({ funds, slots }: { funds: PlanFund[]; slots?: Map<string, number> }) {
  if (!funds.length) return <p className="text-body-sm text-muted">None.</p>;
  return (
    <div className="max-h-[480px] overflow-auto">
      <table className="w-full text-left text-body-sm">
        <thead className="sticky top-0 bg-surface text-label uppercase tracking-label text-muted">
          <tr>
            <th className="py-xs pr-md font-medium">Tier</th>
            <th className="py-xs pr-md font-medium">#</th>
            <th className="py-xs pr-md font-medium">Investor</th>
            <th className="py-xs pr-md font-medium">Matched on</th>
            <th className="py-xs pr-md font-medium">Backed a competitor</th>
            <th className="py-xs pr-md text-right font-medium">Look-alike</th>
            <th className="py-xs pr-md text-right font-medium">Sub-sectors</th>
            <th className="py-xs text-right font-medium">Contacts</th>
          </tr>
        </thead>
        <tbody>
          {funds.map((f) => (
            <tr key={f.firmId} className="border-t border-border">
              <td className="py-xs pr-md text-secondary">{TIER_LABEL[f.tier]}</td>
              <td className="py-xs pr-md text-muted">{f.rank || "–"}</td>
              <td className="py-xs pr-md text-heading">{f.name}</td>
              <td className="py-xs pr-md text-secondary">{f.hit.join(", ")}</td>
              <td className="py-xs pr-md text-success">
                {f.backed.join(", ")}
                {f.sameStage?.length ? <span className="text-muted"> (at the client&apos;s stage: {f.sameStage.join(", ")})</span> : null}
              </td>
              <td className="py-xs pr-md text-right">{f.lookAlike.toFixed(2)}</td>
              <td className="py-xs pr-md text-right">{f.focus}</td>
              <td className="py-xs text-right">{slots ? `${slots.get(f.firmId) ?? 0} of ${f.contacts}` : f.contacts || "no contact"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PanelKey = "planned" | "ranked" | "outside" | "none" | "nocontact";

/** Step 4: The Plan. */
export function ThePlan({ clientId, clientName, refreshKey }: { clientId: string; clientName: string; refreshKey: number }) {
  const [state, setState] = useState<PlanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<PanelKey | null>(null);
  const [boxes, setBoxes] = useState<Boxes>(toBoxes(PLAN_DEFAULTS));

  const load = useCallback(async () => {
    const result = await loadThePlan(clientId);
    if (!result.ok) return setError(result.error);
    setError(null);
    setState(result.state);
    if (result.state.status === "ready" && result.state.saved) setBoxes(toBoxes(result.state.saved.inputs));
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const inputs = useMemo(() => toInputs(boxes), [boxes]);
  const problems = useMemo(() => planInputProblems(inputs), [inputs]);
  const capacity = useMemo(() => (problems.length ? null : planCapacity(inputs)), [inputs, problems.length]);
  const cap = Number.isInteger(inputs.contactsPerFund) && inputs.contactsPerFund > 0 ? inputs.contactsPerFund : 2;
  const funds = useMemo(() => (state?.status === "ready" ? rankFunds(state.funds, cap) : []), [state, cap]);
  const w = useMemo(() => waterfall(funds, capacity?.contacts ?? 0, cap), [funds, capacity, cap]);

  async function run(label: string, action: () => Promise<{ ok: true; state: PlanState } | { ok: false; error: string }>) {
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

  const panel = (key: PanelKey, label: string, body: React.ReactNode) => (
    <div className="mt-sm">
      <button type="button" className="text-body-sm text-primary underline" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
        {open === key ? `Hide ${label}` : `Show ${label}`}
      </button>
      {open === key ? <div className="mt-xs">{body}</div> : null}
    </div>
  );

  const listsFor = (list: PlanFund[]) => {
    const outside = list.filter((f) => f.tier === "outside");
    const none = list.filter((f) => f.tier === "none");
    const noContact = list.filter((f) => (PLAN_TIERS as readonly string[]).includes(f.tier) && f.contacts === 0);
    return { outside, none, noContact };
  };

  // Confirmed: the green summary card.
  if (state.saved) {
    const saved = state.saved;
    const byId = new Map(saved.funds.map((f) => [f.firmId, f]));
    const plannedFunds = saved.planned.map((p) => byId.get(p.firmId)).filter((f): f is PlanFund => !!f);
    const slots = new Map(saved.planned.map((p) => [p.firmId, p.slots]));
    const savedW = waterfall(saved.funds, saved.capacity.contacts, saved.inputs.contactsPerFund);
    const l = listsFor(saved.funds);
    return (
      <Card tone="final">
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0 flex-1">
            <BigNumber value={saved.counts.plannedContacts} label="Step 4 · The Plan: confirmed (contacts)" />
            <p className="text-body-sm text-secondary">
              {n(saved.counts.plannedFunds)} funds, of {n(saved.counts.roster)} on the Roster. {saved.inputs.inboxes} {saved.inputs.inboxes === 1 ? "inbox" : "inboxes"}, {saved.inputs.months}{" "}
              {saved.inputs.months === 1 ? "month" : "months"}, {saved.capacity.emailsPerContact} emails per contact. Confirmed {when(saved.confirmedAt)}
              {saved.confirmedBy ? ` by ${saved.confirmedBy}` : ""}.
            </p>
          </div>
          <button type="button" className={`${secondaryButton} shrink-0`} disabled={busy !== null} onClick={() => void run("reopen", () => reopenThePlan(clientId))}>
            {busy === "reopen" ? "Reopening…" : "Reopen"}
          </button>
        </div>
        {state.changed.length ? (
          <p className="mt-sm rounded-md border border-warning/40 bg-surface px-md py-sm text-body-sm text-warning">
            Since it was confirmed, the Roster behind it changed: {state.changed.join(" ")} Reopen to plan it again.
          </p>
        ) : null}
        <WaterfallTable w={savedW} />
        {panel("planned", `the Final Outreach Roster (${n(plannedFunds.length)} funds)`, <FundTable funds={plannedFunds} slots={slots} />)}
        {panel("outside", `"Same sector, other sub-sectors" (${n(l.outside.length)})`, <FundTable funds={l.outside} />)}
        {panel("nocontact", `the funds with no contact (${n(l.noContact.length)})`, <FundTable funds={l.noContact} />)}
        <div className="mt-md flex justify-end">
          <button type="button" className={secondaryButton} onClick={() => download(saved.planned, saved.funds, clientName)}>
            Download (CSV)
          </button>
        </div>
        {errorLine}
      </Card>
    );
  }

  const l = listsFor(funds);
  const byId = new Map(funds.map((f) => [f.firmId, f]));
  const plannedFunds = w.planned.map((p) => byId.get(p.firmId)).filter((f): f is PlanFund => !!f);
  const slots = new Map(w.planned.map((p) => [p.firmId, p.slots]));
  const ranked = funds.filter((f) => f.rank > 0);
  const warmupPerDay = capacity ? capacity.dailyWarmup : null;

  return (
    <div className="space-y-md">
      <Card>
        <h3 className="text-h4 text-heading">4A. Tiers of the Final Roster</h3>
        <SubSectors list={state.subSectors} />
        <ul className="mt-sm list-disc pl-lg text-body-sm text-secondary">
          {PLAN_TIERS.map((t) => (
            <li key={t}>
              <span className="text-heading">{TIER_LABEL[t]}</span>: {TIER_RULE[t]} {n(funds.filter((f) => f.tier === t).length)} funds.
            </li>
          ))}
        </ul>
        <p className="mt-xs text-body-sm text-muted">A match on a sub-sector counts that sub-sector and the ones under it.</p>
        <p className="mt-sm text-body-sm text-secondary">
          <span className="text-heading">Same sector, other sub-sectors:</span> {n(l.outside.length)} funds, not sent. If real fits show up here, fix the taxonomy
          mapping (it may be missing synonyms), not the tier rule.
          {l.none.length ? ` ${n(l.none.length)} more list nothing the tiers look at.` : ""}
        </p>
        {panel("outside", `"Same sector, other sub-sectors" (${n(l.outside.length)})`, <FundTable funds={l.outside} />)}
        {l.none.length ? panel("none", `the funds not placed (${n(l.none.length)})`, <FundTable funds={l.none} />) : null}
      </Card>

      <Card>
        <h3 className="text-h4 text-heading">4B. Ranking inside each tier</h3>
        <p className="max-w-prose text-body-sm text-secondary">
          1. Backed a competitor at the client&apos;s stage ({state.clientStage || "no stage on the profile"}; Pre-Seed and Seed count as one):{" "}
          {n(state.sameStageSeeds)} of the {n(state.seeds)} competitor investors in the database. 2. Backed a competitor at another stage. 3. Look-alike score: resemblance to{" "}
          {state.seedsBasis === "same_stage" ? "the same-stage backers" : `every competitor investor (fewer than ${SAME_STAGE_SEEDS_MIN} backed one at the client's stage)`}
          {state.profile.length ? `, led by ${state.profile.slice(0, 3).map((p) => `${p.sector} ${Math.round(p.share * 100)}%`).join(", ")}` : ""}. 4. Focus: fewer
          sub-sectors listed ranks higher. 5. Contacts available: 2 before 1.
        </p>
        <p className="mt-xs text-body-sm text-secondary">
          Funds with no contact are not used: {n(l.noContact.length)} in the tiers.
        </p>
        {panel("ranked", `the ranked tiers (${n(ranked.length)} funds)`, <FundTable funds={ranked} />)}
        {panel("nocontact", `the funds with no contact (${n(l.noContact.length)})`, <FundTable funds={l.noContact} />)}
      </Card>

      <Card tone="final">
        <h3 className="text-h4 text-heading">4C. Capacity and the Final Outreach Roster</h3>
        <div className="mt-sm grid gap-md sm:grid-cols-3">
          {PLAN_INPUT_KEYS.map((key) => (
            <label key={key} className="block">
              <span className={labelClass}>{PLAN_LIMITS[key].label}</span>
              <input
                className={`${inputClass} mt-xs`}
                inputMode="numeric"
                value={boxes[key]}
                onChange={(e) => setBoxes({ ...boxes, [key]: e.target.value })}
              />
              <span className="mt-xs block text-body-sm text-muted">
                {key === "warmupPercent" && warmupPerDay !== null ? `= ${n(warmupPerDay)} emails a day during the warm-up. ` : ""}
                {PLAN_LIMITS[key].hint ?? ""}
              </span>
            </label>
          ))}
        </div>
        {problems.length ? <p className="mt-sm text-body-sm text-error">{problems.join(" ")}</p> : null}
        {capacity ? (
          <>
            <div className="mt-md flex flex-wrap items-start justify-between gap-md">
              <BigNumber value={capacity.contacts} label="Contacts the campaign can reach" />
              <button
                type="button"
                className={primaryButton}
                disabled={busy !== null || w.plannedFunds < 1}
                onClick={() => void run("confirm", () => confirmThePlan(clientId, inputs))}
              >
                {busy === "confirm" ? "Saving…" : "Confirm Plan"}
              </button>
            </div>
            <p className="text-body-sm text-secondary">
              {n(capacity.sends)} sends in {n(capacity.days)} days; {capacity.emailsPerContact} emails per contact. {n(w.plannedFunds)} funds and {n(w.plannedContacts)} contacts fit.
              {w.unused ? ` ${n(w.unused)} contacts of capacity are left: every tier is used up.` : ""}
              {w.partial ? ` The last fund, ${byId.get(w.partial)?.name ?? w.partial}, gets fewer contacts than it has, to fit.` : ""}
            </p>
            <ul className="mt-xs list-disc pl-lg text-body-sm text-muted">
              {capacity.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <WaterfallTable w={w} />
            {panel("planned", `the Final Outreach Roster (${n(plannedFunds.length)} funds)`, <FundTable funds={plannedFunds} slots={slots} />)}
            <div className="mt-md flex justify-end">
              <button type="button" className={secondaryButton} disabled={!w.planned.length} onClick={() => download(w.planned, funds, clientName)}>
                Download (CSV)
              </button>
            </div>
          </>
        ) : null}
        {errorLine}
      </Card>
    </div>
  );
}
