import Link from "next/link";
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
import {
  ClassificationPanel,
  type SectorChoice,
  type VersionRow,
} from "@/app/admin/clients/[id]/profile/classification-panel";
import { SECTOR_KINDS, choosable, sectorAnswers, validateProfile } from "@/lib/company-profile/core";
import { currentProfile, loadVersions, type ProfileVersion } from "@/lib/company-profile/server";
import { loadTaxonomy } from "@/lib/taxonomy/server";

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

function versionRow(v: ProfileVersion): VersionRow {
  return { version: v.version, source: v.source, readiness: v.readiness, createdBy: v.createdBy, createdAt: v.createdAt, note: v.note };
}

/** The canonical profile with its issues and history, or why it can't be shown. */
async function loadClassification(clientId: string, state: MatchProfileState | null) {
  if (!state || !isServiceRoleConfigured()) return null;
  const supabase = createServiceClient();
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return { error: taxonomy.error };
  const index = taxonomy.value;
  const [current, versions] = await Promise.all([
    currentProfile(supabase, clientId, state, index),
    loadVersions(supabase, clientId, 20),
  ]);
  if (!current.ok) return { error: current.error };
  if (!versions.ok) return { error: versions.error };
  const { issues, readiness } = validateProfile(current.value.profile, index, current.value.buildProblems);
  const choices: SectorChoice[] = choosable(index, "sector", SECTOR_KINDS)
    .map((node) => ({ id: node.id, label: node.label, broad: node.attrs.granularity === "broad" }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return {
    data: {
      profile: current.value.profile,
      issues,
      readiness,
      version: current.value.version ? versionRow(current.value.version) : null,
      versions: versions.value.map(versionRow),
      outOfSync: current.value.outOfSync,
      unusable: sectorAnswers(current.value.profile, index).unusable,
      choices,
    },
  };
}

export default async function CompanyProfilePage({ params }: { params: { id: string } }) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();

  const [{ state, error }, interview] = await Promise.all([
    loadState(client.id),
    getIntakeInterview(client.id),
  ]);
  const classification = await loadClassification(client.id, state);
  const claudeReady = isClaudeConfigured();
  const hasInterview = Boolean(interview && interview.messages.length > 0);

  return (
    <>
      <BackLink href={`/admin/clients/${client.id}`} label={client.company_name} />
      <PageHeader
        title="Company Profile"
        description={`Everything Rupert knows about ${client.company_name}, by topic. Matching, the materials analysis and the outreach narrative all read from here.`}
        actions={
          <div className="flex flex-wrap items-end gap-sm">
            <a
              href={`/admin/clients/${client.id}/profile/export`}
              className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading"
            >
              Download as Markdown
            </a>
            <a
              href={`/admin/clients/${client.id}/profile/framing-pack`}
              title="The profile, the full intake transcript, the materials, and the analysis and narrative, in one file."
              className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading"
            >
              Download everything (framing pack)
            </a>
            <Link
              href={`/admin/clients/${client.id}`}
              className="rounded-md bg-primary px-md py-sm text-body-sm text-white no-underline transition-colors duration-hover hover:bg-primary-hover"
            >
              Back to Client
            </Link>
          </div>
        }
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
      {classification?.data ? <ClassificationPanel clientId={client.id} {...classification.data} /> : null}
      {classification?.error ? (
        <p role="alert" className="mb-lg rounded-card border border-warning/40 bg-surface px-lg py-md text-body-sm text-warning">
          Classification: {classification.error}
        </p>
      ) : null}
      <ProfileWorkspace
        clientId={client.id}
        initialState={state}
        canBuildFromIntake={hasInterview && claudeReady && Boolean(client.intake_completed_at)}
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
