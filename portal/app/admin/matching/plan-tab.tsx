import Link from "next/link";
import { n } from "@/app/admin/clients/[id]/match/ui";
import { Alert, Section } from "@/app/admin/clients/[id]/match/four-tier/run-view";
import { PlanBuilder } from "@/app/admin/matching/plan-builder";
import { DEFAULT_SPLIT, SOURCE_LABEL, poolsOf, sizesOf } from "@/lib/match/capacity/allocate";
import { CAPACITY_MODEL_VERSION } from "@/lib/match/capacity/schedule";
import { latestCampaignPlan, planForRun, rebuildsExactly, removalsFor, type SavedPlan } from "@/lib/match/capacity/server";
import { matchPath } from "@/lib/match/shared";
import type { StoredResult } from "@/lib/match/tiers/stored";
import type { RunHeader } from "@/lib/match/tiers/server";

function when(iso: string) {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "–";
}

/** The confirmed plan of the newest run: the split, and the funds taken out since. */
function ConfirmedPlan({ clientId, plan, rebuilds }: { clientId: string; plan: SavedPlan; rebuilds: boolean | null }) {
  const allocation = plan.allocation!;
  return (
    <Section title={`Confirmed plan · version ${plan.version}`} meta={`${when(plan.createdAt)} by ${plan.createdBy ?? "unknown"}`}>
      <p className="text-body-sm text-secondary">
        {n(allocation.planned)} funds over {plan.inputs.months} month{plan.inputs.months === 1 ? "" : "s"}
        {allocation.monthsNeeded !== null ? ` (they need ${allocation.monthsNeeded})` : ""}.{" "}
        <Link href={matchPath(clientId, "tiers")} className="text-primary underline hover:text-primary-hover">
          See the campaign on the Tiers tab
        </Link>
        .
      </p>
      {allocation.weights && allocation.split ? (
        <p className="mt-xs text-body-sm text-muted">
          After Core: weights {allocation.weights.sphere} / {allocation.weights.tier3} / {allocation.weights.tier4}; actual split {allocation.split.sphere}% /{" "}
          {allocation.split.tier3}% / {allocation.split.tier4}% (Sphere / Tier 3 / Tier 4).
        </p>
      ) : null}
      <div className="mt-sm overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-xs pr-md font-normal">Tier</th>
              <th className="py-xs pr-md text-right font-normal">Available</th>
              <th className="py-xs pr-md text-right font-normal">Planned</th>
              <th className="py-xs font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {allocation.rows
              .filter((row) => row.source !== "generalist" || row.requested > 0)
              .map((row) => (
                <tr key={row.source} className="border-b border-border">
                  <td className="py-xs pr-md text-heading">{SOURCE_LABEL[row.source]}</td>
                  <td className="py-xs pr-md text-right tabular-nums">{n(row.available)}</td>
                  <td className="py-xs pr-md text-right tabular-nums text-heading">{n(row.planned)}</td>
                  <td className={`py-xs ${row.short > 0 ? "text-warning" : "text-secondary"}`}>
                    {row.short > 0 ? `${n(row.short)} fewer than planned: no fund left in this tier to replace a removal` : "OK"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {allocation.removed.length > 0 ? (
        <details className="mt-sm">
          <summary className="cursor-pointer text-body-sm text-secondary hover:text-heading">Removed from the campaign ({n(allocation.removed.length)})</summary>
          <ul className="mt-xs space-y-xs text-body-sm text-secondary">
            {allocation.removed.map((firm) => (
              <li key={firm.firmId}>
                {firm.name} · {SOURCE_LABEL[firm.source]} · {firm.reason} <span className="text-muted">({firm.by ?? "unknown"}, {when(firm.at)})</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {rebuilds === false ? <p className="mt-sm text-body-sm text-error">This plan no longer rebuilds identically from its run. Tell the developer.</p> : null}
    </Section>
  );
}

function VersionList({ plans, runId }: { plans: SavedPlan[]; runId: string | null }) {
  return (
    <Section title="Plan versions" meta={`${plans.length}`}>
      {plans.length === 0 ? (
        <p className="text-body-sm text-muted">None yet.</p>
      ) : (
        <ul className="divide-y divide-border text-body-sm">
          {plans.map((plan) => (
            <li key={plan.id} className="py-xs">
              <span className="text-heading">Version {plan.version}</span>{" "}
              <span className="text-secondary">
                · {when(plan.createdAt)} by {plan.createdBy ?? "unknown"}
                {plan.allocation ? ` · ${n(plan.allocation.planned)} funds · ${plan.inputs.months} months` : " · earlier capacity calculator"}
                {plan.runId === runId ? "" : " · an earlier run"}
                {plan.generalistsApproved ? " · generalists approved" : ""}
                {plan.note ? ` · ${plan.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * The Plan tab: campaign months, the funds that takes, and their split
 * across the newest run's tiers. Confirming saves a plan version; the Tiers
 * tab, Verify emails and Push to client then work from it.
 */
export function PlanTab({
  clientId,
  run,
  plans,
  plansError,
}: {
  clientId: string;
  run: { header: RunHeader; rows: StoredResult[]; complete: boolean } | null;
  plans: SavedPlan[];
  plansError: string | null;
}) {
  const runId = run?.header.id ?? null;
  const confirmed = runId ? planForRun(plans, runId) : null;
  // A new run starts from the newest plan: same months, setup and split, to confirm again.
  const carried = confirmed ? null : latestCampaignPlan(plans);
  const start = confirmed ?? carried;
  return (
    <>
      {plansError ? <Alert tone="error">{plansError}</Alert> : null}
      {!run ? (
        <p className="mb-lg rounded-card border border-border bg-surface px-lg py-lg text-body-sm text-muted">Run the match first: the plan is built from the newest run.</p>
      ) : !run.complete ? (
        <Alert tone="error">The newest run is incomplete. Run the match again before planning.</Alert>
      ) : (
        <>
          {confirmed ? (
            <ConfirmedPlan clientId={clientId} plan={confirmed} rebuilds={rebuildsExactly(confirmed, run.rows, CAPACITY_MODEL_VERSION)} />
          ) : (
            <Alert tone="warning">
              {carried
                ? `The match was re-run, so this run has no confirmed plan yet. Below is plan version ${carried.version} from the previous run (same months and split): check it and confirm. Push to client stays off until you do.`
                : "No plan confirmed for the newest run yet. Push to client stays off until one is."}
            </Alert>
          )}
          <h2 className="mb-sm text-h4 text-heading">{confirmed ? "Change the plan" : "Build the plan"}</h2>
          <p className="mb-md text-body-sm text-muted">
            From the run of {when(run.header.ranAt)}. Only funds in the four tiers are used, and generalists when you approve them; rejected funds never are.
          </p>
          <PlanBuilder
            key={`${run.header.id}:${start?.id ?? "new"}`}
            clientId={clientId}
            runId={run.header.id}
            sizes={sizesOf(poolsOf(run.rows), removalsFor(plans, run.header.id, run.rows))}
            initial={
              start?.allocation
                ? { inputs: start.inputs, counts: start.allocation.counts, useGeneralists: start.generalistsApproved, weights: start.allocation.weights ?? DEFAULT_SPLIT }
                : null
            }
            initialLabel={confirmed ? "Back to the confirmed split" : "Back to the previous plan's split"}
            nextVersion={(plans[0]?.version ?? 0) + 1}
          />
        </>
      )}
      <div className="mt-lg">
        <VersionList plans={plans} runId={runId} />
      </div>
    </>
  );
}
