import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { listClients } from "@/lib/data";
import { formatDate, statusLabel } from "@/lib/format";
import {
  POST_KICKOFF_MILESTONES,
  buildTimeline,
  milestoneText,
} from "@/lib/timeline";

export default async function TimelinePage() {
  const clients = (await listClients()).filter((client) => !client.archived_at);
  const now = new Date();

  const rows = clients
    .map((client) => ({ client, timeline: buildTimeline(client, now) }))
    .sort((a, b) => {
      // Kicked-off clients first, most recent kick-off first.
      if (a.timeline.kickoffAt && b.timeline.kickoffAt) {
        return b.timeline.kickoffAt.localeCompare(a.timeline.kickoffAt);
      }
      if (a.timeline.kickoffAt) return -1;
      if (b.timeline.kickoffAt) return 1;
      return a.client.company_name.localeCompare(b.client.company_name);
    });

  return (
    <>
      <PageHeader
        title="Timeline"
        description="Where every active client stands, counted from Day 1: the day the Service Order is signed and the Setup Fee is paid. Days are calendar days, Pacific time."
      />
      {rows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-lg py-lg text-body-sm text-muted">
          No active clients yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[960px] text-left text-body-sm">
            <thead>
              <tr className="whitespace-nowrap border-b border-border text-label uppercase tracking-label text-muted">
                <th scope="col" className="px-md py-sm font-medium">Client</th>
                <th scope="col" className="px-md py-sm font-medium">Day 1</th>
                <th scope="col" className="px-md py-sm font-medium">Today</th>
                {POST_KICKOFF_MILESTONES.map((milestone) => (
                  <th
                    key={milestone.id}
                    scope="col"
                    title={milestone.label}
                    className="px-md py-sm font-medium"
                  >
                    {milestone.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ client, timeline }) => {
                const byId = new Map(
                  timeline.milestones.map((milestone) => [milestone.id, milestone]),
                );
                return (
                  <tr key={client.id} className="border-b border-border last:border-b-0">
                    <th scope="row" className="whitespace-nowrap px-md py-sm font-normal">
                      <Link
                        href={`/admin/clients/${client.id}`}
                        className="text-heading no-underline hover:text-primary"
                      >
                        {client.company_name || client.founder_name}
                      </Link>
                      <span className="block text-muted">
                        {client.stage ? statusLabel(client.stage) : "—"}
                      </span>
                    </th>
                    {timeline.kickoffAt ? (
                      <>
                        <td className="whitespace-nowrap px-md py-sm text-muted">
                          {formatDate(timeline.kickoffAt)}
                        </td>
                        <td className="whitespace-nowrap px-md py-sm font-mono text-mono text-heading">
                          Day {timeline.today}
                        </td>
                      </>
                    ) : (
                      <td colSpan={2} className="whitespace-nowrap px-md py-sm text-muted">
                        Not kicked off yet
                      </td>
                    )}
                    {POST_KICKOFF_MILESTONES.map((column) => {
                      const milestone = byId.get(column.id);
                      const text = milestone ? milestoneText(milestone) : "—";
                      return (
                        <td
                          key={column.id}
                          title={
                            milestone?.at
                              ? `${column.label}: ${formatDate(milestone.at)}`
                              : undefined
                          }
                          className={`whitespace-nowrap px-md py-sm font-mono text-mono ${
                            text === "—" ? "text-muted" : "text-heading"
                          }`}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
