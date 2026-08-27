import { PageHeader } from "@/components/page-header";
import { Checklist } from "@/components/checklist";
import { getPortalClient } from "@/lib/data";
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
    </>
  );
}
