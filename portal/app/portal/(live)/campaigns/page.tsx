import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { CampaignAnalyticsView } from "@/components/campaign-analytics-view";
import { getPortalView } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { clientAnalytics, loadCampaignData, periodChoice } from "@/lib/outreach/analytics-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const { client } = await getPortalView();
  const loaded = client?.id && isServiceRoleConfigured() ? await loadCampaignData(createServiceClient(), client.id) : null;
  const data = loaded?.ok ? loaded.value : null;

  const header = (
    <>
      <BackLink href="/portal/live-campaign" label="Live Campaign" />
      <PageHeader
        title="Campaign Analytics"
        description="How your outreach is going, by week, tier and fund type. Replies count once Rupert passes them on; opens are an estimate, since some email apps block them."
      />
    </>
  );

  if (!data) {
    return (
      <>
        {header}
        <p className="rounded-card border border-border bg-surface px-lg py-md text-body-sm text-muted">
          {loaded && !loaded.ok ? "Analytics couldn't load. Rupert has been told." : "Analytics start once your campaign is live."}
        </p>
      </>
    );
  }

  const choice = periodChoice(searchParams ?? {}, data.currentWeek);
  return (
    <CampaignAnalyticsView
      data={data}
      choice={choice}
      view={clientAnalytics(data, choice)}
      basePath="/portal/campaigns"
      people={false}
      header={header}
    />
  );
}
