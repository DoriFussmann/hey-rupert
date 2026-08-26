import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getPortalClient } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { isEngagementStage } from "@/lib/types";

export default async function PortalIndexPage() {
  if (isSupabaseConfigured()) {
    const client = await getPortalClient();
    if (!client || (client.stage && !isEngagementStage(client.stage))) {
      return (
        <>
          <PageHeader
            title="Portal"
            description="This engagement is not available yet."
          />
        </>
      );
    }
  }

  redirect("/portal/scope-of-work");
}
