import { redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { AcknowledgeButton } from "@/app/portal/statement-of-work/acknowledge-button";
import { FullFormButton } from "@/app/portal/statement-of-work/full-form-button";
import { StatementOfWorkDocument } from "@/app/portal/statement-of-work/statement-of-work-document";
import { getPortalClient } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { isEngagementStage } from "@/lib/types";

export default async function StatementOfWorkPage() {
  const client = await getPortalClient();

  if (
    isSupabaseConfigured() &&
    client?.stage &&
    !isEngagementStage(client.stage)
  ) {
    redirect("/portal/onboarding");
  }

  return (
    <>
      <BackLink href="/portal/onboarding" label="Onboarding" />
      <h1 className="sr-only">Statement of Work</h1>
      <StatementOfWorkDocument
        content={client?.statement_of_work_content ?? ""}
      />
      {client ? (
        <div className="mt-lg max-w-prose">
          <AcknowledgeButton
            acknowledgedAt={client.sow_confirmed_at ?? null}
          />
          <FullFormButton content={client.statement_of_work_content ?? ""} />
        </div>
      ) : null}
    </>
  );
}
