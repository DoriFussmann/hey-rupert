import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getPortalClient } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { PORTAL_PHASE_HOME, currentPortalPhase } from "@/lib/portal-phase";
import { isEngagementStage } from "@/lib/types";

/** The portal opens on the phase the client is in. */
export default async function PortalIndexPage() {
  if (!isSupabaseConfigured()) redirect(PORTAL_PHASE_HOME.onboarding);

  const client = await getPortalClient();
  if (!client || (client.stage && !isEngagementStage(client.stage))) {
    return (
      <PageHeader title="Portal" description="This engagement is not available yet." />
    );
  }

  redirect(PORTAL_PHASE_HOME[currentPortalPhase(client.stage, client)]);
}
