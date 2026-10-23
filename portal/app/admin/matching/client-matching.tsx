import Link from "next/link";
import { MatchControls } from "@/app/admin/matching/match-controls";
import { PlanTab } from "@/app/admin/matching/plan-tab";
import type { HiddenFund } from "@/app/admin/matching/settings-panel";
import {
  Alert,
  CampaignColumns,
  FourTierRunView,
  NearMissSection,
  OutsideSection,
  RunSummary,
  Section,
  TierColumns,
} from "@/app/admin/clients/[id]/match/four-tier/run-view";
import { n } from "@/app/admin/clients/[id]/match/ui";
import { READINESS_LABEL } from "@/lib/company-profile/core";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadProfileState } from "@/lib/match/profile-server";
import { loadHidden, loadReviews } from "@/lib/match/run-server";
import { MATCH_TABS, MATCH_TAB_LABEL, matchPath, type MatchTab, type Review } from "@/lib/match/shared";
import {
  latestTierRun,
  listRuns,
  loadTierRun,
  profileReadiness,
  runWebsites,
  staleReasons,
  type ProfileReadiness,
} from "@/lib/match/tiers/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadVerifyOverview } from "@/lib/match/verify-server";
import { VerifyWorkspace } from "@/app/admin/clients/[id]/match/verify/verify-workspace";
import { listCapacityPlans, planForRun, plannedIds } from "@/lib/match/capacity/server";
import type { Client } from "@/lib/types";

function when(iso: string) {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "–";
}

const BORDER = { ready: "border-success/40", limited: "border-warning/40", blocked: "border-error/40" } as const;
const TEXT = { ready: "text-success", limited: "text-warning", blocked: "text-error" } as const;

/** Whether the profile can be matched, and what to fix. */
function ReadinessCard({ clientId, readiness }: { clientId: string; readiness: ProfileReadiness }) {
  const { readiness: level, missing, issues } = readiness;
  return (
    <section className={`mb-lg rounded-card border bg-surface px-lg py-md text-body-sm text-secondary ${BORDER[level]}`} aria-label="Profile readiness">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-heading">
          Profile: <span className={TEXT[level]}>{level === "limited" ? "Limited: runs, with warnings" : READINESS_LABEL[level]}</span>
        </p>
        <Link href={`/admin/clients/${clientId}/profile`} className="text-primary underline hover:text-primary-hover">
          Open the company profile
        </Link>
      </div>
      {missing.length > 0 ? <p className="mt-xs">Missing: {missing.join(", ")}. The match can&apos;t run without them.</p> : null}
      {issues.length > 0 ? (
        <ul className="mt-xs list-disc pl-lg">
          {issues.map((issue) => (
            <li key={`${issue.field}-${issue.message}`}>
              {issue.field}: {issue.message}
            </li>
          ))}
        </ul>
      ) : level === "ready" ? (
        <p className="mt-xs text-secondary">Every field the match needs is set and confirmed.</p>
      ) : null}
    </section>
  );
}

function Tabs({ clientId, tab }: { clientId: string; tab: MatchTab }) {
  return (
    <nav aria-label="Results" className="mb-md flex flex-wrap gap-xs border-b border-border">
      {MATCH_TABS.map((key) => (
        <Link
          key={key}
          href={matchPath(clientId, key)}
          aria-current={key === tab ? "page" : undefined}
          className={`-mb-px border-b-2 px-md py-sm text-body-sm no-underline ${key === tab ? "border-primary text-heading" : "border-transparent text-secondary hover:text-heading"}`}
        >
          {MATCH_TAB_LABEL[key]}
        </Link>
      ))}
    </nav>
  );
}

/** The Verify Emails tab: checks the plan's contacts, 5 at a time. */
async function VerifyTab({ client, onlyTier }: { client: Client; onlyTier: string | null }) {
  const loaded = await loadVerifyOverview(createServiceClient(), client.id);
  const overview = loaded.ok ? loaded.value : null;
  return (
    <>
      {client.is_match_sandbox ? (
        <Alert tone="warning">
          Test Pilot sandbox: checks cost real money, and Remove, Update email, Update name and Update firm change the Fund
          Database for every client.
        </Alert>
      ) : null}
      {overview ? (
        <p className="mb-md text-body-sm text-muted">
          {overview.planFunds === null
            ? "No campaign plan is confirmed for the newest run, so every fund in the four tiers is in scope. Confirm a plan on the Plan tab to check only its funds."
            : `Checking the confirmed campaign plan: ${n(overview.planFunds)} funds.`}
        </p>
      ) : null}
      <VerifyWorkspace
        clientId={client.id}
        initialOverview={overview}
        initialError={loaded.ok ? null : loaded.error}
        onlyTier={onlyTier}
      />
    </>
  );
}

/** The History tab: every saved run of the client; the one picked is shown in full, read-only. */
async function HistoryTab({ clientId, runId }: { clientId: string; runId: string | null }) {
  const supabase = createServiceClient();
  const runs = await listRuns(supabase, clientId, 60);
  if (!runs.ok) return <Alert tone="error">{runs.error}</Alert>;
  const tierRuns = runs.value.runs.filter((run) => run.engine === "tiers");
  if (tierRuns.length === 0) return <p className="text-body-sm text-muted">No saved runs yet.</p>;
  const picked = runId && tierRuns.some((run) => run.id === runId) ? runId : tierRuns[0].id;
  const loaded = await loadTierRun(supabase, clientId, picked);
  const websites = loaded.ok ? await runWebsites(supabase, loaded.value.rows) : {};
  return (
    <>
      {runs.value.since ? <p className="mb-md text-body-sm text-muted">Test client: runs since it was last started clean ({when(runs.value.since)}).</p> : null}
      <Section title="Saved runs" meta={`${tierRuns.length}`}>
        <ul className="space-y-xs text-body-sm">
          {tierRuns.map((run) => (
            <li key={run.id}>
              <Link href={`${matchPath(clientId, "history")}&run=${run.id}`} className={run.id === picked ? "text-heading underline" : "text-secondary hover:text-heading"}>
                {when(run.ranAt)}
              </Link>{" "}
              <span className="text-muted">
                by {run.ranBy ?? "unknown"} · rules {run.rulesVersion} ·{" "}
                {run.saved === run.resultsExpected ? `${n(run.saved)} funds` : `incomplete (${n(run.saved)} of ${n(run.resultsExpected)})`}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      {loaded.ok ? <FourTierRunView clientId={clientId} {...loaded.value} websites={websites} /> : <Alert tone="error">{loaded.error}</Alert>}
    </>
  );
}

/**
 * Matching for one client: readiness, the actions, and the newest saved run
 * in tabs. Everything shown about a run is read from the saved run.
 */
export async function ClientMatching({
  client,
  tab,
  runId,
  verifyTier,
}: {
  client: Client;
  tab: MatchTab;
  runId: string | null;
  /** Verify Emails opened from one tier's panel. */
  verifyTier: string | null;
}) {
  if (!isServiceRoleConfigured()) return <Alert tone="error">Service role key is not configured.</Alert>;
  const supabase = createServiceClient();
  const sandbox = client.is_match_sandbox === true;
  const [state, readiness, latest, reviews, hidden, plans] = await Promise.all([
    loadProfileState(supabase, client.id),
    profileReadiness(supabase, client.id),
    latestTierRun(supabase, client.id),
    loadReviews(supabase, client.id),
    loadHidden(supabase),
    listCapacityPlans(supabase, client.id),
  ]);
  if (!state.ok) return <Alert tone="error">{state.error}</Alert>;
  if (!latest.ok) return <Alert tone="error">{latest.error}</Alert>;
  const runnable = readiness.ok && readiness.value.readiness !== "blocked";
  const loaded = latest.value ? await loadTierRun(supabase, client.id, latest.value.id) : null;
  const run = loaded && loaded.ok ? loaded.value : null;
  const savedPlans = plans.ok ? plans.value : [];
  const plan = run ? planForRun(savedPlans, run.header.id) : null;
  const planned = plan ? plannedIds(plan) : null;
  const stale = run ? await staleReasons(supabase, client.id, run.header, run.rows, planned ?? undefined) : null;
  // Websites are only needed where funds are listed.
  const websites = run && tab === "tiers" ? await runWebsites(supabase, run.rows) : {};

  let pushBlocked: string | null = null;
  if (!run) pushBlocked = "Run the match first.";
  else if (!run.complete) pushBlocked = "This run is incomplete. Run the match again.";
  else if (!plans.ok) pushBlocked = plans.error;
  else if (!plan) pushBlocked = "Push is off until you confirm a campaign plan on the Plan tab.";
  else if (stale && !stale.ok) pushBlocked = stale.error;
  else if (stale && stale.value.length > 0) pushBlocked = "Push is off until you run the match again (see why below).";

  const reviewMap: Record<string, Review> = {};
  if (reviews.ok) reviews.reviews.forEach((review, firmId) => (reviewMap[firmId] = review));
  const hiddenList: HiddenFund[] = hidden.ok ? hidden.hidden : [];

  return (
    <>
      {readiness.ok ? <ReadinessCard clientId={client.id} readiness={readiness.value} /> : <Alert tone="error">{readiness.error}</Alert>}
      <MatchControls
        clientId={client.id}
        runId={run?.header.id ?? null}
        canRun={runnable}
        pushBlocked={pushBlocked}
        planFunds={planned ? planned.size : null}
        sandbox={sandbox}
        settings={state.value?.settings ?? null}
        hidden={hiddenList}
      />
      {loaded && !loaded.ok ? <Alert tone="error">{loaded.error}</Alert> : null}
      {!reviews.ok ? <Alert tone="error">{reviews.error}</Alert> : null}
      {stale?.ok && stale.value.length > 0 ? (
        <Alert tone="warning">
          <p className="text-heading">This run no longer reflects the client&apos;s data. Run the match again before pushing.</p>
          <ul className="mt-xs list-disc pl-lg">
            {stale.value.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Tabs clientId={client.id} tab={tab} />
      {tab === "plan" ? (
        <PlanTab clientId={client.id} run={run} plans={savedPlans} plansError={plans.ok ? null : plans.error} />
      ) : tab === "history" ? (
        <HistoryTab clientId={client.id} runId={runId} />
      ) : tab === "verify" ? (
        <VerifyTab client={client} onlyTier={verifyTier} />
      ) : !run ? (
        <p className="rounded-card border border-border bg-surface px-lg py-lg text-body-sm text-muted">
          No run yet for this client. Run match when the profile can run.
        </p>
      ) : tab === "outside" ? (
        <OutsideSection rows={run.rows} />
      ) : tab === "near" ? (
        <NearMissSection clientId={client.id} header={run.header} rows={run.rows} />
      ) : (
        <>
          {plan && planned ? (
            <CampaignColumns
              rows={run.rows}
              planned={planned}
              review={{ clientId: client.id, reviews: reviewMap }}
              campaign={{ clientId: client.id, runId: run.header.id }}
              websites={websites}
              heading={
                <p className="text-body-sm text-secondary">
                  <span className="text-heading">Campaign: {planned.size.toLocaleString("en-US")} funds</span> · plan version {plan.version},{" "}
                  {plan.inputs.months} month{plan.inputs.months === 1 ? "" : "s"}. Each tier lists its campaign funds; the rest are under &quot;Not in this
                  campaign&quot;.{" "}
                  <Link href={matchPath(client.id, "plan")} className="text-primary underline hover:text-primary-hover">
                    Change the plan
                  </Link>
                </p>
              }
            />
          ) : (
            <Alert tone="warning">
              No campaign plan for this run yet: every fund in the tiers is shown.{" "}
              <Link href={matchPath(client.id, "plan")} className="underline">
                Build the plan
              </Link>{" "}
              to pick the campaign&apos;s funds.
            </Alert>
          )}
          <RunSummary
            clientId={client.id}
            header={run.header}
            rows={run.rows}
            complete={run.complete}
            title={planned ? "Whole run" : "Counts"}
            footnote={`Ran ${when(run.header.ranAt)} by ${run.header.ranBy ?? "unknown"}. Saved permanently: exports read it; Push to client sends its confirmed campaign plan.`}
          />
          {planned ? null : <TierColumns rows={run.rows} review={{ clientId: client.id, reviews: reviewMap }} websites={websites} />}
        </>
      )}
    </>
  );
}
