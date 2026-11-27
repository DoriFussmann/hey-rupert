import { PageHeader } from "@/components/page-header";
import { Checklist } from "@/components/checklist";
import { getPortalClient } from "@/lib/data";
import { UpcomingDaysTable } from "@/components/upcoming-days-table";
import { loadUpcoming } from "@/lib/outreach/live-server";
import { localDate } from "@/lib/outreach/live";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { LiveBanner } from "@/components/live-banner";
import {
  LIVE_ITEMS,
  checklistProgress,
  isLiveUnlocked,
  parseChecklistStatus,
} from "@/lib/checklists";

export default async function LiveCampaignPage() {
  const client = await getPortalClient();
  const unlocked = isLiveUnlocked(client?.stage);
  const { complete, total } = checklistProgress(LIVE_ITEMS, client);
  const upcoming =
    client?.stage === "live" && isSupabaseConfigured() ? await loadUpcoming(createServiceClient(), client.id) : null;
  const next = upcoming?.ok ? upcoming.value : null;

  return (
    <>
      <PageHeader
        title="Live Campaign"
        description={
          unlocked
            ? `${complete} of ${total} complete.`
            : `Opens once your campaign is live. ${complete} of ${total} complete.`
        }
      />
      {client?.stage === "live" ? (
        <div className="mb-lg">
          <LiveBanner since={client.live_at ?? null} />
        </div>
      ) : null}
      <Checklist
        items={LIVE_ITEMS.map((item) => ({
          id: item.column,
          title: item.title,
          href: item.href,
          status: parseChecklistStatus(client?.[item.column]),
          clickable: unlocked,
          dimmed: !unlocked,
        }))}
      />
      {next ? (
        <UpcomingDaysTable days={next.days} today={localDate(Date.now(), next.timezone)} paused={next.paused} left={next.left} />
      ) : null}
    </>
  );
}
