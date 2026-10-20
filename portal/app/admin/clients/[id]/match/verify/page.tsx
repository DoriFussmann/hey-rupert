import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { VerifyWorkspace } from "@/app/admin/clients/[id]/match/verify/verify-workspace";
import { getAdminClient } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { matchPath } from "@/lib/match/shared";
import { loadVerifyOverview } from "@/lib/match/verify-server";
import type { VerifyOverview } from "@/lib/match/verify";
import { createServiceClient } from "@/lib/supabase/admin";

// Each step runs up to five web searches or mailbox checks in parallel.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function loadOverview(clientId: string): Promise<{ overview: VerifyOverview | null; error: string | null }> {
  if (!isServiceRoleConfigured()) return { overview: null, error: "Service role key is not configured." };
  const loaded = await loadVerifyOverview(createServiceClient(), clientId);
  return loaded.ok ? { overview: loaded.value, error: null } : { overview: null, error: loaded.error };
}

export default async function VerifyEmailsPage({ params }: { params: { id: string } }) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();
  const { overview, error } = await loadOverview(client.id);

  return (
    <>
      <BackLink href={matchPath(client.id)} label="Rupert Match" />
      <PageHeader
        title="Verify emails"
        description={`Checks ${client.company_name}'s matched contacts 5 at a time: is the person at the firm, is the email public, and does the mailbox accept mail. Fixes apply to the Fund Database for every client.`}
      />
      {client.is_match_sandbox ? (
        <p className="mb-lg rounded-card border border-warning/40 bg-surface px-lg py-md text-body-sm text-warning">
          Test Pilot sandbox: checks cost real money, and Remove, Update email, Update name and Update firm change the
          Fund Database for every client.
        </p>
      ) : null}
      <VerifyWorkspace clientId={client.id} initialOverview={overview} initialError={error} />
    </>
  );
}
