import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { getAdminClient } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { n } from "@/app/admin/clients/[id]/match/ui";
import { Alert, Section } from "@/app/admin/clients/[id]/match/four-tier/run-view";
import { CapacityCalculator } from "@/app/admin/clients/[id]/match/capacity/capacity-calculator";
import { SOURCE_LABEL, poolsOf, type PlanSource } from "@/lib/match/capacity/allocate";
import { CAPACITY_MODEL_VERSION, INPUT_LIMITS, type CapacityInputs } from "@/lib/match/capacity/schedule";
import { listCapacityPlans, rebuildsExactly, type SavedPlan } from "@/lib/match/capacity/server";
import { matchPath } from "@/lib/match/shared";
import { listRuns, loadTierRun } from "@/lib/match/tiers/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function when(iso: string) {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "–";
}

function PlanDetails({ plan, rebuilds }: { plan: SavedPlan; rebuilds: boolean | null | undefined }) {
  const allocation = plan.allocation;
  const capacity = plan.capacity as { firms?: number; capacity?: number; utilization?: number };
  return (
    <div className="mt-xs space-y-xs text-body-sm text-secondary">
      <p>
        Run {plan.runId} · rules {plan.rulesVersion} · taxonomy revision {plan.taxonomyRevision} · profile version {plan.profileVersion ?? "legacy"} · Fund Database{" "}
        {plan.fundDbVersion} · model {plan.modelVersion}
      </p>
      <p>
        Inputs:{" "}
        {(Object.keys(INPUT_LIMITS) as (keyof CapacityInputs)[]).map((key) => `${INPUT_LIMITS[key].label} ${plan.inputs[key]}`).join(" · ")}
      </p>
      <p>
        Capacity {n(Number(capacity.capacity ?? 0))} sends · {n(Number(capacity.firms ?? 0))} firms the inboxes reach · utilization{" "}
        {Math.round(Number(capacity.utilization ?? 0) * 100)}%
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-xs pr-md font-normal">Tier or source</th>
              <th className="py-xs pr-md text-right font-normal">Available</th>
              <th className="py-xs pr-md text-right font-normal">Planned</th>
              <th className="py-xs text-right font-normal">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {(allocation.rows ?? []).map((row) => (
              <tr key={row.source} className="border-b border-border">
                <td className="py-xs pr-md">{SOURCE_LABEL[row.source as PlanSource] ?? row.source}</td>
                <td className="py-xs pr-md text-right tabular-nums">{n(row.available)}</td>
                <td className="py-xs pr-md text-right tabular-nums">{n(row.planned)}</td>
                <td className="py-xs text-right tabular-nums">{n(row.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rebuilds === true ? <p className="text-success">Rebuilt from its saved run now: identical.</p> : null}
      {rebuilds === false ? <p className="text-error">Rebuilt from its saved run now: different. Tell the developer.</p> : null}
      {rebuilds === null ? <p className="text-muted">Made with an earlier calculator version; not rebuilt.</p> : null}
      <details>
        <summary className="cursor-pointer hover:text-heading">Planned firms ({n((allocation.firms ?? []).length)})</summary>
        <ol className="mt-xs max-h-72 list-decimal overflow-auto pl-lg">
          {(allocation.firms ?? []).map((firm) => (
            <li key={firm.firmId}>
              {firm.name} <span className="font-mono text-label text-muted">{firm.firmId}</span> · {SOURCE_LABEL[firm.source as PlanSource] ?? firm.source}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

/**
 * Phase 4: how many unique firms the client's sending inboxes can reach in a
 * campaign, and how a target splits across one saved four-tier run's tiers.
 * Planning only: nothing here changes a run, pushes a list or sends anything.
 */
export default async function CapacityPage({ params, searchParams }: { params: { id: string }; searchParams: { run?: string } }) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();
  const header = (
    <>
      <BackLink href={matchPath(client.id)} label="Rupert Match" />
      <PageHeader
        title="Campaign capacity"
        description="How many unique investor firms the sending inboxes can reach, and how the target splits across a saved four-tier run. Planning only: nothing is pushed or sent."
      />
    </>
  );
  if (!isServiceRoleConfigured()) {
    return (
      <>
        {header}
        <Alert tone="error">Service role key is not configured.</Alert>
      </>
    );
  }
  const supabase = createServiceClient();
  const [runs, plans] = await Promise.all([listRuns(supabase, client.id, 60), listCapacityPlans(supabase, client.id)]);
  if (!runs.ok) {
    return (
      <>
        {header}
        <Alert tone="error">{runs.error}</Alert>
      </>
    );
  }
  const tierRuns = runs.value.runs.filter((run) => run.engine === "tiers" && run.saved === run.resultsExpected);
  const picked = searchParams.run && tierRuns.some((run) => run.id === searchParams.run) ? searchParams.run : tierRuns[0]?.id ?? null;
  const loaded = picked ? await loadTierRun(supabase, client.id, picked) : null;
  const savedPlans = plans.ok ? plans.value : [];
  const nextVersion = (savedPlans[0]?.version ?? 0) + 1;
  const base = `/admin/clients/${client.id}/match/capacity`;

  return (
    <>
      {header}
      {!plans.ok ? <Alert tone="warning">{plans.error}</Alert> : null}
      {!loaded ? (
        <Alert tone="warning">
          No complete four-tier run for this client yet.{" "}
          <Link href={`/admin/clients/${client.id}/match/four-tier`} className="underline">
            Run one
          </Link>{" "}
          first: the calculator plans from a saved run.
        </Alert>
      ) : !loaded.ok ? (
        <Alert tone="error">{loaded.error}</Alert>
      ) : (
        <>
          <Section title="Saved run used">
            <p className="text-body-sm text-secondary">
              {when(loaded.value.header.ranAt)} by {loaded.value.header.ranBy ?? "unknown"} · rules {loaded.value.header.rulesVersion} · run {loaded.value.header.id}
            </p>
            {tierRuns.length > 1 ? (
              <p className="mt-xs text-body-sm">
                Other runs:{" "}
                {tierRuns
                  .filter((run) => run.id !== picked)
                  .slice(0, 8)
                  .map((run, i) => (
                    <span key={run.id}>
                      {i > 0 ? " · " : ""}
                      <Link href={`${base}?run=${run.id}`} className="text-secondary underline hover:text-heading">
                        {when(run.ranAt)}
                      </Link>
                    </span>
                  ))}
              </p>
            ) : null}
            <p className="mt-xs text-body-sm text-muted">
              Only funds in the four tiers (and generalists, when you approve them) are used. Excluded, unresolved, near-miss and rejected funds, and records shown
              through another record, never are. Model {CAPACITY_MODEL_VERSION}.
            </p>
          </Section>
          <CapacityCalculator clientId={client.id} runId={loaded.value.header.id} pools={poolsOf(loaded.value.rows)} nextVersion={nextVersion} />
        </>
      )}
      <Section title="Saved plans" meta={`${savedPlans.length}`}>
        {savedPlans.length === 0 ? (
          <p className="text-body-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {savedPlans.map((plan) => (
              <li key={plan.id} className="py-xs">
                <details>
                  <summary className="cursor-pointer text-body-sm text-heading">
                    Version {plan.version} · {when(plan.createdAt)} by {plan.createdBy ?? "unknown"} · target {n(plan.allocation.target ?? 0)}
                    {plan.target === null ? " (capacity)" : ""} · planned {n(plan.allocation.planned ?? 0)}
                    {plan.allocation.shortfall ? ` · shortfall ${n(plan.allocation.shortfall)}` : ""}
                    {plan.generalistsApproved ? " · generalists approved" : ""}
                    {plan.note ? ` · ${plan.note}` : ""}
                  </summary>
                  <PlanDetails
                    plan={plan}
                    rebuilds={loaded && loaded.ok && plan.runId === loaded.value.header.id ? rebuildsExactly(plan, loaded.value.rows, CAPACITY_MODEL_VERSION) : undefined}
                  />
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
