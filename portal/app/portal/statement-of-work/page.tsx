import { redirect } from "next/navigation";
import { StatementOfWorkPanel } from "@/app/portal/statement-of-work/statement-of-work-panel";
import { getPortalView } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { isEngagementStage } from "@/lib/types";

export default async function StatementOfWorkPage() {
  const { client, viewAs } = await getPortalView();

  if (
    isSupabaseConfigured() &&
    client?.stage &&
    !isEngagementStage(client.stage)
  ) {
    redirect("/portal/onboarding");
  }

  return (
    <StatementOfWorkPanel
      content={client?.statement_of_work_content ?? ""}
      acknowledgedAt={client ? (client.sow_confirmed_at ?? null) : undefined}
      readOnly={viewAs}
    />
  );
}
