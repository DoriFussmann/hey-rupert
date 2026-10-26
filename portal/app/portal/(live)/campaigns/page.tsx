import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { getPortalView } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { clientLiveData } from "@/lib/outreach/replies-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const tiles = [
  ["funds", "Funds in the campaign"],
  ["contacted", "Investors emailed"],
  ["opened", "Opened"],
  ["replied", "Funds replied"],
  ["meetings", "Meetings"],
] as const;

export default async function CampaignsPage() {
  const { client } = await getPortalView();
  const data =
    client?.id && isServiceRoleConfigured()
      ? await clientLiveData(createServiceClient(), client.id)
      : { totals: { funds: 0, contacted: 0, opened: 0, replied: 0, meetings: 0 } };

  return (
    <>
      <BackLink href="/portal/live-campaign" label="Live Campaign" />
      <PageHeader
        title="Campaign Analytics"
        description="How your outreach is going. Replies count once Rupert passes them on; opens are an estimate, since some email apps block them."
      />
      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([key, label]) => (
          <div key={key} className="rounded-card border border-border bg-surface px-lg py-lg">
            <p className="text-label uppercase tracking-label text-muted">{label}</p>
            <p className="mt-sm font-mono text-h2 text-heading">{data.totals[key]}</p>
          </div>
        ))}
      </div>
    </>
  );
}
