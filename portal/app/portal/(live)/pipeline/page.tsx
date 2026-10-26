import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { StatusBadge } from "@/components/status-badge";
import { getPortalView } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import type { PipelineStage } from "@/lib/outreach/live";
import { clientLiveData } from "@/lib/outreach/replies-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const columns: { status: PipelineStage; label: string }[] = [
  { status: "queued", label: "Queued" },
  { status: "contacted", label: "Contacted" },
  { status: "replied", label: "Replied" },
  { status: "meeting", label: "Meeting" },
  { status: "passed", label: "Passed" },
];

const TIER: Record<number, string> = { 1: "Core", 2: "Sphere", 3: "Tier 3", 4: "Tier 4" };

export default async function PipelinePage() {
  const { client } = await getPortalView();
  const data = client?.id && isServiceRoleConfigured() ? await clientLiveData(createServiceClient(), client.id) : { funds: [] };

  return (
    <>
      <BackLink href="/portal/live-campaign" label="Live Campaign" />
      <PageHeader
        title="Engagement Tracker"
        description="Where each fund stands. Funds move as emails go out and as Rupert passes on their replies."
      />
      <div className="grid gap-md xl:grid-cols-3">
        {columns.map((column) => {
          const items = data.funds.filter((fund) => fund.stage === column.status);
          return (
            <section key={column.status} className="rounded-card border border-border bg-surface p-md">
              <div className="mb-md flex items-center justify-between gap-sm">
                <h2 className="text-h4">{column.label}</h2>
                <span className="font-mono text-mono text-muted">{items.length}</span>
              </div>
              <ul className="grid gap-sm">
                {items.length === 0 ? (
                  <li className="px-sm py-md text-body-sm text-muted">Empty</li>
                ) : (
                  items.map((fund) => (
                    <li key={fund.firm_id} className="rounded-md border border-border bg-background px-md py-md">
                      <p className="text-body-sm text-heading">{fund.fund}</p>
                      {fund.contacts ? <p className="mt-xs text-body-sm text-muted">{fund.contacts}</p> : null}
                      <div className="mt-sm flex items-center gap-sm">
                        <StatusBadge status={fund.stage} />
                        <span className="text-body-sm text-muted">{TIER[fund.tier] ?? ""}</span>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
