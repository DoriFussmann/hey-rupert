import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { InboxView } from "@/app/portal/(live)/inbox/inbox-view";
import { listReplies } from "@/lib/data";

export default async function InboxPage() {
  const replies = await listReplies();

  return (
    <>
      <BackLink href="/portal/live-campaign" label="Live Campaign" />
      <PageHeader
        title="Investor Inbox"
        description="Investor replies for this raise. Every conversation stays yours."
      />
      <InboxView replies={replies} />
    </>
  );
}
