import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { IntakeBriefPanel } from "@/app/admin/clients/[id]/intake-brief-panel";
import { ProfileWorkspace } from "@/app/admin/clients/[id]/profile/profile-workspace";
import { isClaudeConfigured } from "@/lib/anthropic";
import { getAdminClient, getIntakeInterview } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import RME from "@/lib/match/engine/index.mjs";
import { loadProfileState } from "@/lib/match/profile-server";
import type { MatchProfileState } from "@/lib/match/shared";
import { createServiceClient } from "@/lib/supabase/admin";

// Building the profile from the intake runs in a server action here.
export const maxDuration = 120;

async function loadState(clientId: string): Promise<{
  state: MatchProfileState | null;
  error: string | null;
}> {
  if (!isServiceRoleConfigured()) {
    return { state: null, error: "Service role key is not configured." };
  }
  const loaded = await loadProfileState(createServiceClient(), clientId);
  return loaded.ok ? { state: loaded.value, error: null } : { state: null, error: loaded.error };
}

export default async function CompanyProfilePage({ params }: { params: { id: string } }) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();

  const [{ state, error }, interview] = await Promise.all([
    loadState(client.id),
    getIntakeInterview(client.id),
  ]);
  const claudeReady = isClaudeConfigured();
  const hasInterview = Boolean(interview && interview.messages.length > 0);

  return (
    <>
      <BackLink href={`/admin/clients/${client.id}`} label={client.company_name} />
      <PageHeader
        title="Company profile"
        description={`Everything Rupert knows about ${client.company_name}, by topic. Matching, the materials analysis and the outreach narrative all read from here.`}
      />
      {error ? (
        <p role="alert" className="mb-lg rounded-card border border-error/40 bg-surface px-lg py-md text-body-sm text-error">
          {error}
        </p>
      ) : null}
      {client.intake_completed_at || hasInterview ? (
        <IntakeBriefPanel
          clientId={client.id}
          initialBrief={interview?.admin_brief ?? null}
          interviewUpdatedAt={interview?.updated_at ?? null}
          hasInterview={hasInterview}
          claudeReady={claudeReady}
          completedAt={client.intake_completed_at ?? null}
        />
      ) : null}
      <ProfileWorkspace
        clientId={client.id}
        initialState={state}
        canBuildFromIntake={hasInterview && claudeReady}
        taxonomy={{
          stages: [...RME.VC_LADDER, ...RME.PE_STAGES],
          verticals: RME.VERTICALS,
          industries: RME.INDUSTRIES,
          countries: RME.COUNTRIES,
        }}
      />
    </>
  );
}
