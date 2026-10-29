import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { NudgeClientPicker } from "@/app/admin/nudge/nudge-client-picker";
import { NudgeWorkspace } from "@/app/admin/nudge/nudge-workspace";
import { ReadyNudges } from "@/app/admin/nudge/ready-nudges";
import { listReadyNudges } from "@/lib/reminders";
import { isServiceRoleConfigured } from "@/lib/env";
import { daysLabel, type NudgeClientSummary } from "@/lib/nudge";
import { loadNudgeDetail, loadNudgeOverview } from "@/lib/nudge-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function clientTurnText(client: NudgeClientSummary) {
  if (client.clientTurns.length === 0) return "—";
  const longest = Math.max(...client.clientTurns.map((turn) => turn.days));
  const steps = client.clientTurns.map((turn) => turn.label).join(", ");
  return `${steps} · ${daysLabel(longest)}`;
}

function ourTurnText(client: NudgeClientSummary) {
  return client.ourItems.length > 0 ? client.ourItems.map((item) => item.action).join(", ") : "—";
}

export default async function NudgePage({
  searchParams,
}: {
  searchParams: { client?: string | string[] };
}) {
  const header = (
    <PageHeader
      title="Nudge"
      description="Scheduled reminders wait here for you to send. Or pick a client to see where they stand, draft a personal nudge, edit it, and send it."
    />
  );

  if (!isServiceRoleConfigured()) {
    return (
      <>
        {header}
        <EmptyState title="Not available" description="The service role key is not configured." />
      </>
    );
  }

  const supabase = createServiceClient();
  const [overview, ready] = await Promise.all([loadNudgeOverview(supabase), listReadyNudges(supabase)]);
  if (!overview.ok) {
    return (
      <>
        {header}
        <EmptyState title="Clients could not be loaded" description={overview.error} />
      </>
    );
  }

  const selectedId = typeof searchParams.client === "string" ? searchParams.client : "";
  const detail = selectedId ? await loadNudgeDetail(supabase, selectedId) : null;
  const options = overview.clients.map((client) => ({
    id: client.id,
    label: client.company && client.company !== client.name ? `${client.company} · ${client.name}` : client.name,
    waiting: client.clientTurns.length > 0,
  }));

  return (
    <>
      {header}
      <ReadyNudges nudges={ready.nudges} errors={ready.errors} />
      <NudgeClientPicker clients={options} selectedId={detail?.ok ? selectedId : ""} />
      {overview.warnings.length > 0 ? (
        <p className="mb-md text-body-sm text-warning">{overview.warnings.join(" ")}</p>
      ) : null}

      {detail && !detail.ok ? (
        <p role="alert" className="mb-md text-body-sm text-error">
          {detail.error}
        </p>
      ) : null}

      {detail?.ok ? (
        <NudgeWorkspace key={detail.detail.id} detail={detail.detail} />
      ) : overview.clients.length === 0 ? (
        <EmptyState title="No active clients" description="Clients appear here once they are added." />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[720px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th scope="col" className="px-md py-sm font-medium">Client</th>
                <th scope="col" className="px-md py-sm font-medium">Stage</th>
                <th scope="col" className="px-md py-sm font-medium">Waiting on client</th>
                <th scope="col" className="px-md py-sm font-medium">Your turn</th>
              </tr>
            </thead>
            <tbody>
              {overview.clients.map((client) => (
                <tr key={client.id} className="border-t border-border align-top">
                  <td className="px-md py-sm">
                    <Link
                      href={`/admin/nudge?client=${encodeURIComponent(client.id)}`}
                      className="text-heading hover:text-primary"
                    >
                      {client.name}
                    </Link>
                    {client.company && client.company !== client.name ? (
                      <span className="block text-muted">{client.company}</span>
                    ) : null}
                  </td>
                  <td className="px-md py-sm text-secondary">{client.stageLabel}</td>
                  <td className="px-md py-sm text-body">{clientTurnText(client)}</td>
                  <td className="px-md py-sm text-body">{ourTurnText(client)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
