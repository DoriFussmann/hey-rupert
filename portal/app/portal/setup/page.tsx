import { PageHeader } from "@/components/page-header";
import { Checklist } from "@/components/checklist";
import { getPortalClient } from "@/lib/data";
import {
  SETUP_ITEMS,
  checklistProgress,
  isSetupUnlocked,
  parseChecklistStatus,
} from "@/lib/checklists";

export default async function SetupPage() {
  const client = await getPortalClient();
  const unlocked = isSetupUnlocked(client?.stage);
  const { complete, total } = checklistProgress(SETUP_ITEMS, client);

  return (
    <>
      <PageHeader
        title="Setup"
        description={
          unlocked
            ? `${complete} of ${total} complete.`
            : `Opens once your engagement reaches Setup. ${complete} of ${total} complete.`
        }
      />
      <Checklist
        items={SETUP_ITEMS.map((item) => ({
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
