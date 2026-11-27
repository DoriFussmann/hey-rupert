import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { CampaignAnalyticsView } from "@/components/campaign-analytics-view";
import { getAdminClient } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { clientAnalytics, loadCampaignData, periodChoice } from "@/lib/outreach/analytics-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Rupert's view of a client's Campaign Analytics: the client's page, plus the
// investors' names under each fund in Who Opened, and every reply counted
// (not only the ones passed on to the client).
export default async function AdminAnalyticsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; to?: string };
}) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();
  const loaded = isServiceRoleConfigured() ? await loadCampaignData(createServiceClient(), client.id) : null;
  const data = loaded?.ok ? loaded.value : null;
  const basePath = `/admin/clients/${client.id}/analytics`;

  const header = (
    <>
      <BackLink href={`/admin/clients/${client.id}`} label={client.company_name} />
      <PageHeader
        title="Campaign Analytics"
        description="What the client sees on their Campaign Analytics page, with the investors' names under Who Opened. Replies count every reply, including ones not yet passed on."
      />
    </>
  );

  if (!data) {
    return (
      <>
        {header}
        <p className="rounded-card border border-border bg-surface px-lg py-md text-body-sm text-muted">
          {loaded && !loaded.ok ? `Analytics couldn't load: ${loaded.error}` : "Analytics start once the campaign is live."}
        </p>
      </>
    );
  }

  const choice = periodChoice(searchParams ?? {}, data.currentWeek);
  return (
    <CampaignAnalyticsView
      data={data}
      choice={choice}
      view={clientAnalytics(data, choice, { allReplies: true })}
      basePath={basePath}
      people
      header={header}
    />
  );
}
