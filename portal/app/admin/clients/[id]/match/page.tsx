import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { MatchWorkspace } from "@/app/admin/clients/[id]/match/match-workspace";
import { getAdminClient } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveDb } from "@/lib/match/db-server";
import { buildProfile, canRun, loadProfileState } from "@/lib/match/profile-server";
import { loadStoredMatch } from "@/lib/match/run-server";
import type { MatchProfileState, MatchView } from "@/lib/match/shared";
import {
  INVESTOR_LIST_BLOCKED,
  canPublish,
  isFeedbackConfirmed,
  type SetupStepId,
} from "@/lib/setup";
import { createServiceClient } from "@/lib/supabase/admin";

// Matching and website checks run in server actions here.
export const maxDuration = 300;

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
  return { state, view, stale, database, error: null };
}

export default async function ClientMatchPage({ params }: { params: { id: string } }) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();

  const { state, view, stale, database, error } = await loadMatch(client.id);
  const stepRow = (step: SetupStepId) =>
    client.setup_steps?.find((row) => row.step === step) ?? null;

  return (
    <>
      <BackLink href={`/admin/clients/${client.id}`} label={client.company_name} />
      <PageHeader
        title="Rupert Match"
        description={`Investor matching for ${client.company_name}. Private to Rupert: the client only receives fund names and contact counts, through Send to client.`}
      />
      <MatchWorkspace
        clientId={client.id}
        initialState={state}
        initialView={view}
        initialStale={stale}
        initialError={error}
        database={database}
        intakeComplete={Boolean(client.intake_completed_at)}
        feedbackConfirmed={isFeedbackConfirmed(stepRow("deck_review"))}
        narrativeConfirmed={stepRow("framing")?.status === "confirmed"}
        sendBlocked={canPublish(client, "investor_list") ? null : INVESTOR_LIST_BLOCKED}
        profileReady={Boolean(
          state && canRun(buildProfile(state.answers, state.settings).profile),
        )}
      />
    </>
  );
}
