import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { getAdminClient } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { n } from "@/app/admin/clients/[id]/match/ui";
import { RunFourTierButton } from "@/app/admin/clients/[id]/match/four-tier/run-button";
import { Alert, FourTierRunView, Section } from "@/app/admin/clients/[id]/match/four-tier/run-view";
import { matchEngine } from "@/lib/match/engine-setting";
import { matchPath } from "@/lib/match/shared";
import { RULES_VERSION } from "@/lib/match/tiers/core";
import { listRuns, loadTierRun } from "@/lib/match/tiers/server";

// Running the engine and saving the run happens in a server action here.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function when(iso: string) {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "–";
}

export default async function FourTierPreviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { run?: string };
}) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();
  const header = (
    <>
      <BackLink href={`/admin/clients/${client.id}`} label={client.company_name} />
      <PageHeader
        title="Four-tier runs"
        description={`Rules ${RULES_VERSION}. Every saved four-tier run of this client. Push to client is on the Match page, when the match engine is Four-tier.`}
        actions={<RunFourTierButton clientId={client.id} />}
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
  const [runs, engine] = await Promise.all([listRuns(supabase, client.id, 60), matchEngine(supabase)]);
  if (!runs.ok) {
    return (
      <>
        {header}
        <Alert tone="error">{runs.error}</Alert>
      </>
    );
  }
  const tierRuns = runs.value.runs.filter((r) => r.engine === "tiers");
  const picked = searchParams.run && tierRuns.some((r) => r.id === searchParams.run) ? searchParams.run : tierRuns[0]?.id ?? null;
  const loaded = picked ? await loadTierRun(supabase, client.id, picked) : null;

  return (
    <>
      {header}
      <p className="mb-md text-body-sm">
        <Link href={matchPath(client.id)} className="text-secondary underline hover:text-heading">
          Open the Match page
        </Link>{" "}
        ·{" "}
        <Link href={`/admin/clients/${client.id}/match/compare`} className="text-secondary underline hover:text-heading">
          Compare with the current engine
        </Link>{" "}
        ·{" "}
        <Link href={`/admin/clients/${client.id}/match/capacity`} className="text-secondary underline hover:text-heading">
          Campaign capacity
        </Link>
      </p>
      {runs.value.since ? (
        <p className="mb-md text-body-sm text-muted">Sandbox: showing runs since its last reset ({when(runs.value.since)}). Earlier runs are kept as history.</p>
      ) : null}
      {!loaded ? (
        <p className="text-body-sm text-muted">No four-tier run yet for this client.</p>
      ) : !loaded.ok ? (
        <Alert tone="error">{loaded.error}</Alert>
      ) : (
        <FourTierRunView
          clientId={client.id}
          {...loaded.value}
          footnote={
            engine === "four_tier"
              ? "To push a run, open the Match page: it pushes the client's newest run."
              : "Push to client sends four-tier runs only when the match engine is Four-tier."
          }
        />
      )}
      {tierRuns.length > 0 ? (
        <Section title="Saved four-tier runs" meta={`${tierRuns.length}`}>
          <ul className="space-y-xs text-body-sm">
            {tierRuns.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/clients/${client.id}/match/four-tier?run=${r.id}`}
                  className={r.id === picked ? "text-heading underline" : "text-secondary hover:text-heading"}
                >
                  {when(r.ranAt)}
                </Link>{" "}
                <span className="text-muted">
                  by {r.ranBy ?? "unknown"} · rules {r.rulesVersion} · {r.comparisonId ? "comparison run" : "match run"} ·{" "}
                  {r.saved === r.resultsExpected ? `${n(r.saved)} funds` : `incomplete (${n(r.saved)} of ${n(r.resultsExpected)})`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
