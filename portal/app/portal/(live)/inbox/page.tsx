import { PageHeader } from "@/components/page-header";
import { InboxView } from "@/app/portal/(live)/inbox/inbox-view";
import { listReplies } from "@/lib/data";

export default async function InboxPage() {
  const replies = await listReplies();

  return (
    <>
      <PageHeader
        title="Investor Inbox"
        description="Investor replies for this raise. Every conversation stays yours."
      />
      <InboxView replies={replies} />
    </>
  );
}
