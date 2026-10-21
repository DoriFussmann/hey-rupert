import Link from "next/link";
import { MatchWorkspace } from "@/app/admin/clients/[id]/match/match-workspace";
import { FourTierMatch } from "@/app/admin/fund-database/four-tier-match";
import type { Client } from "@/lib/types";
import { isServiceRoleConfigured } from "@/lib/env";
import { unmatchedExclusionEntries } from "@/lib/match/exclusion-warnings";
import { loadLiveDb } from "@/lib/match/db-server";
import { matchEngine } from "@/lib/match/engine-setting";
import { buildProfile, canRun, loadProfileState } from "@/lib/match/profile-server";
import { loadStoredMatch } from "@/lib/match/run-server";
import type { MatchProfileState, MatchView } from "@/lib/match/shared";
import { isFeedbackConfirmed, type SetupStepId } from "@/lib/setup";
import { createServiceClient } from "@/lib/supabase/admin";

/** Shown when the Match Sandbox is the picked client. */
function SandboxBanner({ clientId }: { clientId: string }) {
  return (
    <p className="mb-lg flex flex-wrap items-center gap-x-md gap-y-xs rounded-card border border-primary/40 bg-primary-tint px-lg py-md text-body-sm text-heading">
      <span>
        <strong className="font-medium">Test Pilot sandbox.</strong> Not a real client: no emails, never listed. Push
        to client publishes to its own portal.
      </span>
      <a href="#match-sandbox" className="text-primary hover:text-primary-hover">
        Change the sandbox inputs
      </a>
      <a
        href={`/admin/clients/${clientId}/view?next=/portal/setup/investor-list`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary-hover"
      >
        See Test Pilot view ↗
      </a>
    </p>
  );
}

async function loadMatch(clientId: string): Promise<{
  state: MatchProfileState | null;
  view: MatchView | null;
  stale: boolean;
  database: { firms: number; contacts: number } | null;
  error: string | null;
}> {
  if (!isServiceRoleConfigured()) {
    return { state: null, view: null, stale: false, database: null, error: "Service role key is not configured." };
  }
  const supabase = createServiceClient();
  const [live, loaded] = await Promise.all([
    loadLiveDb(supabase),
    loadProfileState(supabase, clientId),
  ]);
  if (!loaded.ok) {
    return { state: null, view: null, stale: false, database: null, error: loaded.error };
  }
  const state = loaded.value;
  const stored = await loadStoredMatch(supabase, clientId);
  const view = stored?.view ?? null;
  const stale = stored?.stale ?? false;
  if (!live.ok) {
    return { state, view, stale, database: null, error: live.empty ? null : live.error };
  }
  const database = { firms: live.value.db.firms.length, contacts: live.value.db.contacts.length };
  if (view && state) {
    const { profile } = buildProfile(state.answers, state.settings);
    view.unmatchedExclusions = unmatchedExclusionEntries(profile.exclusions, live.value.db.firms);
  }
  return { state, view, stale, database, error: null };
}

/** Rupert Match for the client picked on the Fund Database page. */
export async function ClientMatch({ client }: { client: Client }) {
  const engine = isServiceRoleConfigured() ? await matchEngine(createServiceClient()) : "current";
  if (engine === "four_tier") {
    const sandbox = client.is_match_sandbox === true;
    return (
      <section aria-labelledby="client-match-title" className="mb-xl">
        <div className="mb-md">
          <h2 id="client-match-title" className="text-h3 text-heading">
            Rupert Match · {client.company_name}
          </h2>
          <p className="mt-xs max-w-prose text-body-sm text-muted">
            Private to Rupert. Push to client saves the saved run&apos;s four tiers (fund names, tiers, websites and contact
            counts; never people) as a draft in the client&apos;s Investor Matching. You review it, preview it and send it with
            its email from the client page.{" "}
            {sandbox ? null : (
              <Link href={`/admin/clients/${client.id}`} className="text-primary hover:text-primary-hover">
                Open the client page
              </Link>
            )}
          </p>
        </div>
        {sandbox ? <SandboxBanner clientId={client.id} /> : null}
        <FourTierMatch key={client.id} client={client} />
      </section>
    );
  }
  const { state, view, stale, database, error } = await loadMatch(client.id);
  const stepRow = (step: SetupStepId) =>
    client.setup_steps?.find((row) => row.step === step) ?? null;
  const sandbox = client.is_match_sandbox === true;

  return (
    <section aria-labelledby="client-match-title" className="mb-xl">
      <div className="mb-md">
        <h2 id="client-match-title" className="text-h3 text-heading">
          Rupert Match · {client.company_name}
        </h2>
        <p className="mt-xs max-w-prose text-body-sm text-muted">
          Private to Rupert. Push to client saves the list (fund names, tiers, websites and contact counts; never
          people) as a draft in the client&apos;s Investor Matching. You review it, preview it and send it with its
          email from the client page.{" "}
          {sandbox ? null : (
            <Link href={`/admin/clients/${client.id}`} className="text-primary hover:text-primary-hover">
              Open the client page
            </Link>
          )}
        </p>
      </div>
      {sandbox ? <SandboxBanner clientId={client.id} /> : null}
      <p className="mb-md text-body-sm text-muted">
        Match engine: Current (three tiers).{" "}
        <Link href="/admin/matching" className="text-primary hover:text-primary-hover">
          Change the engine
        </Link>
      </p>
      <MatchWorkspace
        key={client.id}
        clientId={client.id}
        initialState={state}
        initialView={view}
        initialStale={stale}
        initialError={error}
        database={database}
        intakeComplete={Boolean(client.intake_completed_at)}
        feedbackConfirmed={isFeedbackConfirmed(stepRow("deck_review"))}
        narrativeConfirmed={stepRow("framing")?.status === "confirmed"}
        sandbox={sandbox}
        profileReady={Boolean(state && canRun(buildProfile(state.answers, state.settings).profile))}
      />
    </section>
  );
}
