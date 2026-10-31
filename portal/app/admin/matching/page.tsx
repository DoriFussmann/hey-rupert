import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { getAdminClient, listClients } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { findSandboxId } from "@/lib/match/sandbox-server";
import { asMatchTab } from "@/lib/match/shared";
import { createServiceClient } from "@/lib/supabase/admin";
import { ClientPicker } from "@/app/admin/matching/client-picker";
import { ClientMatching } from "@/app/admin/matching/client-matching";
import { TestClientTools } from "@/app/admin/matching/test-client-tools";
import { MatchingSteps } from "@/app/admin/matching/matching-steps";

// Running the match and saving the run happen in server actions here.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f-]{36}$/i;


const TIER_KEY = /^(core|sphere|tier3|tier4)$/;

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: { client?: string; tab?: string; run?: string; tier?: string };
}) {
  await requireAdmin();
  const clientId = typeof searchParams.client === "string" && UUID.test(searchParams.client) ? searchParams.client : null;
  const runId = typeof searchParams.run === "string" && UUID.test(searchParams.run) ? searchParams.run : null;
  const [clients, picked, sandbox] = await Promise.all([
    listClients(),
    clientId ? getAdminClient(clientId) : Promise.resolve(null),
    isServiceRoleConfigured() ? findSandboxId(createServiceClient()) : Promise.resolve(null),
  ]);
  const testClientId = sandbox?.ok ? sandbox.value : null;
  const real = clients
    .filter((client) => !client.archived_at)
    .map((client) => ({ id: client.id, name: client.company_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const options = testClientId ? [...real, { id: testClientId, name: "Test client (Test Pilot)" }] : real;

  return (
    <>
      <PageHeader title="Matching" description="Pick a client, check the profile is ready, run the match and push the list to the client's page." />
      <section className="mb-lg rounded-card border border-border bg-surface px-lg py-md">
        <ClientPicker clients={options} selectedId={picked?.id ?? null} />
        {clientId && !picked ? (
          <p role="alert" className="mt-sm text-body-sm text-error">
            That client was not found.
          </p>
        ) : null}
        {picked?.is_match_sandbox || !testClientId ? <TestClientTools testClientId={testClientId} clients={real} /> : null}
      </section>
      {picked ? (
        <div className="mb-xl">
          <MatchingSteps key={picked.id} clientId={picked.id} clientName={picked.company_name} />
        </div>
      ) : null}
      {picked ? (
        <ClientMatching
          key={picked.id}
          client={picked}
          tab={asMatchTab(searchParams.tab)}
          runId={runId}
          verifyTier={typeof searchParams.tier === "string" && TIER_KEY.test(searchParams.tier) ? searchParams.tier : null}
        />
      ) : null}
    </>
  );
}
