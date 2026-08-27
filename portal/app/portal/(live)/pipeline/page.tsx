import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { StatusBadge } from "@/components/status-badge";
import { listInvestors } from "@/lib/data";
import type { InvestorStatus } from "@/lib/types";

const columns: { status: InvestorStatus; label: string }[] = [
  { status: "identified", label: "Identified" },
  { status: "queued", label: "Queued" },
  { status: "contacted", label: "Contacted" },
  { status: "replied", label: "Replied" },
  { status: "meeting", label: "Meeting" },
  { status: "passed", label: "Passed" },
];

export default async function PipelinePage() {
  const investors = await listInvestors();

  return (
    <>
      <BackLink href="/portal/live-campaign" label="Live Campaign" />
      <PageHeader
        title="Engagement Tracker"
        description="Where each investor stands. Names move as outreach and replies come in."
      />
      <div className="grid gap-md xl:grid-cols-3">
        {columns.map((column) => {
          const items = investors.filter(
            (investor) => investor.status === column.status,
          );

          return (
            <section
              key={column.status}
              className="rounded-card border border-border bg-surface p-md"
            >
              <div className="mb-md flex items-center justify-between gap-sm">
                <h2 className="text-h4">{column.label}</h2>
                <span className="font-mono text-mono text-muted">
                  {items.length}
                </span>
              </div>
              <ul className="grid gap-sm">
                {items.length === 0 ? (
                  <li className="px-sm py-md text-body-sm text-muted">Empty</li>
                ) : (
                  items.map((investor) => (
                    <li
                      key={investor.id}
                      className="rounded-md border border-border bg-background px-md py-md"
                    >
                      <p className="text-body-sm text-heading">{investor.fund}</p>
                      <p className="mt-xs text-body-sm text-muted">
                        {investor.partner}
                      </p>
                      <p className="mt-sm font-mono text-mono text-muted">
                        {investor.check_size}
                      </p>
                      <div className="mt-sm">
                        <StatusBadge status={investor.status} />
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
