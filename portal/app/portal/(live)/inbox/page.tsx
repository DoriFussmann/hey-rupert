import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { InboxView } from "@/app/portal/(live)/inbox/inbox-view";
import { getPortalView } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { releasedRepliesFor } from "@/lib/outreach/replies-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { client, viewAs } = await getPortalView();
  const replies = client?.id && isServiceRoleConfigured() ? await releasedRepliesFor(createServiceClient(), client.id) : [];

  return (
    <>
      <BackLink href="/portal/live-campaign" label="Live Campaign" />
      <PageHeader
        title="Investor Inbox"
        description="Investor replies that need you, passed on by Rupert. Out-of-office notes, bounces and the like stay with him. Every conversation is yours: answer from your own email, in the same thread."
      />
      <InboxView replies={replies} readOnly={viewAs} />
    </>
  );
}
