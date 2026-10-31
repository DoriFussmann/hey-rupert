import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { getAdminClient, listClients } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { findSandboxId } from "@/lib/match/sandbox-server";
import { asMatchTab } from "@/lib/match/shared";
import { RULES_VERSION } from "@/lib/match/tiers/core";
import { createServiceClient } from "@/lib/supabase/admin";
import { ClientPicker } from "@/app/admin/matching/client-picker";
import { ClientMatching } from "@/app/admin/matching/client-matching";
import { TestClientTools } from "@/app/admin/matching/test-client-tools";
import { DryMatch } from "@/app/admin/matching/dry-match";

// Running the match and saving the run happen in server actions here.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f-]{36}$/i;

function HowItWorks() {
  return (
    <details className="mb-lg max-w-prose text-body-sm text-secondary">
      <summary className="cursor-pointer text-muted hover:text-heading">How this works</summary>
      <ul className="mt-xs list-disc space-y-xs pl-lg">
        <li>A fund must invest at the company&apos;s stage, cover its location (the fund&apos;s stated geography), and offer the right fund type and financing.</li>
        <li>Sector decides the tier: Core (same sector), Sphere (right next to it), Tier 3 (broader link), Tier 4 (weak but approved link). Only approved sector links count.</li>
        <li>Funds with missing or unclear data are &ldquo;unresolved&rdquo;, generalists sit apart, and one-stage-off funds are near misses. Only admins see these groups.</li>
        <li>Every run is saved permanently. Push to client puts the run&apos;s four tiers on the client&apos;s page as a draft; you send it from there.</li>
        <li>Verify Emails checks the contacts of the confirmed campaign plan: is the person at the firm, and does the mailbox accept mail. Fixes apply to the Fund Database for every client.</li>
        <li>Rules {RULES_VERSION}.</li>
      </ul>
    </details>
  );
}

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
      <HowItWorks />
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
        <section className="mb-xl" aria-label="Dry Match">
          <h2 className="mb-xs text-h3 text-heading">Dry Match (new)</h2>
          <p className="mb-md max-w-prose text-body-sm text-secondary">
            The new matching, step by step: financing, stage, geography, then primary sector. Each step starts from the company&apos;s profile; change it if needed and confirm. Nothing is saved, and the tools below are unchanged.
          </p>
          <DryMatch key={picked.id} clientId={picked.id} clientName={picked.company_name} />
        </section>
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
