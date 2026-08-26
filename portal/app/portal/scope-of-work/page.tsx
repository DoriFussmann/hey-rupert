import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { MarkdownBody } from "@/components/markdown-body";
import { AcknowledgeButton } from "@/app/portal/scope-of-work/acknowledge-button";
import { getPortalClient } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { isEngagementStage } from "@/lib/types";

export default async function ScopeOfWorkPage() {
  const client = await getPortalClient();

  if (
    isSupabaseConfigured() &&
    client?.stage &&
    !isEngagementStage(client.stage)
  ) {
    redirect("/portal");
  }

  return (
    <>
      <PageHeader
        title="Scope of work"
        description="The engagement as agreed: what Rupert runs, what stays with you, and how decisions are made."
      />
      <section className="rounded-card border border-border bg-surface p-lg">
        <MarkdownBody
          content={client?.scope_of_work_content ?? ""}
          emptyLabel="No scope of work has been added yet."
        />
        <div className="mt-lg max-w-prose">
          {client ? (
            <AcknowledgeButton
              acknowledgedAt={client.scope_acknowledged_at ?? null}
            />
          ) : null}
        </div>
      </section>
    </>
  );
}
