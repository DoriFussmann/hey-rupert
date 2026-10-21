import Link from "next/link";
import { FourTierControls } from "@/app/admin/fund-database/four-tier-controls";
import { Alert, FourTierRunView } from "@/app/admin/clients/[id]/match/four-tier/run-view";
import type { Client } from "@/lib/types";
import { isServiceRoleConfigured } from "@/lib/env";
import { buildProfile, canRun, loadProfileState } from "@/lib/match/profile-server";
import { loadHidden, loadReviews } from "@/lib/match/run-server";
import type { MatchView, Review } from "@/lib/match/shared";
import { RULES_VERSION } from "@/lib/match/tiers/core";
import { latestTierRun, loadTierRun, staleReasons } from "@/lib/match/tiers/server";
import { createServiceClient } from "@/lib/supabase/admin";

/**
 * Rupert Match on the four-tier engine: the client's newest saved run, its
 * four tiers side by side, the admin-only groups and the near misses.
 * Everything shown is read from the saved run.
 */
export async function FourTierMatch({ client }: { client: Client }) {
  if (!isServiceRoleConfigured()) return <Alert tone="error">Service role key is not configured.</Alert>;
  const supabase = createServiceClient();
  const sandbox = client.is_match_sandbox === true;
  const [state, latest, reviews, hidden] = await Promise.all([
    loadProfileState(supabase, client.id),
    latestTierRun(supabase, client.id),
    loadReviews(supabase, client.id),
    loadHidden(supabase),
  ]);
  if (!state.ok) return <Alert tone="error">{state.error}</Alert>;
  if (!latest.ok) return <Alert tone="error">{latest.error}</Alert>;
  const profileState = state.value;
  const runnable = Boolean(profileState && canRun(buildProfile(profileState.answers, profileState.settings).profile));
  const loaded = latest.value ? await loadTierRun(supabase, client.id, latest.value.id) : null;
  const run = loaded && loaded.ok ? loaded.value : null;
  const stale = run ? await staleReasons(supabase, client.id, run.header, run.rows) : null;

  let pushBlocked: string | null = null;
  if (!run) pushBlocked = "Run the match first.";
  else if (!run.complete) pushBlocked = "This run is incomplete. Run the match again.";
  else if (stale && !stale.ok) pushBlocked = stale.error;
  else if (stale && stale.value.length > 0) pushBlocked = "Push is off until you run the match again (see why below).";

  const reviewMap: Record<string, Review> = {};
  if (reviews.ok) reviews.reviews.forEach((review, firmId) => (reviewMap[firmId] = review));
  const hiddenList: MatchView["hidden"] = hidden.ok ? hidden.hidden : [];

  return (
    <>
      <p className="mb-md rounded-card border border-primary/40 bg-primary-tint px-lg py-md text-body-sm text-heading">
        Match engine: <strong className="font-medium">Four-tier</strong> (rules {RULES_VERSION}).{" "}
        <Link href="/admin/matching" className="text-primary hover:text-primary-hover">
          Change the engine
        </Link>
      </p>
      <FourTierControls
        clientId={client.id}
        runId={run?.header.id ?? null}
        canRun={runnable}
        pushBlocked={pushBlocked}
        sandbox={sandbox}
        settings={profileState?.settings ?? null}
        hidden={hiddenList}
      />
      {!runnable ? (
        <Alert tone="warning">
          The company profile is not ready to match.{" "}
          <Link href={`/admin/clients/${client.id}/profile`} className="underline">
            Open the profile
          </Link>
        </Alert>
      ) : null}
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
      {run ? (
        <FourTierRunView
          clientId={client.id}
          header={run.header}
          rows={run.rows}
          complete={run.complete}
          columns
          review={{ clientId: client.id, reviews: reviewMap }}
          footnote="This run is saved permanently. Exports read it; Push to client sends it."
        />
      ) : latest.value === null ? (
        <p className="rounded-card border border-border bg-surface px-lg py-lg text-body-sm text-muted">
          No four-tier run yet for this client. Run match when the profile can run and the Fund Database is live.
        </p>
      ) : null}
    </>
  );
}
