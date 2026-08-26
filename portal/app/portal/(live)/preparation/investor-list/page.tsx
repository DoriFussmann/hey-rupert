import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ReviewPanel } from "@/components/review-panel";
import { StatusBadge } from "@/components/status-badge";
import { listInvestors } from "@/lib/data";

export default async function InvestorListPage() {
  const investors = await listInvestors();

  return (
    <>
      <PageHeader
        title="Target List"
        description="The matched list for this raise. Acknowledge it before names are queued for outreach."
      />
      {investors.length === 0 ? (
        <EmptyState
          title="List not ready"
          description="Matched investors will appear here after the fit pass."
        />
      ) : (
        <>
          <div className="mb-lg overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full min-w-[720px] text-left text-body-sm">
              <thead>
                <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                  <th className="px-lg py-sm font-medium">Fund</th>
                  <th className="px-lg py-sm font-medium">Partner</th>
                  <th className="px-lg py-sm font-medium">Thesis</th>
                  <th className="px-lg py-sm font-medium">Check</th>
                  <th className="px-lg py-sm font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {investors.map((investor) => (
                  <tr
                    key={investor.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-lg py-md">
                      <p className="text-heading">{investor.fund}</p>
                      <p className="text-muted">{investor.geography}</p>
                    </td>
                    <td className="px-lg py-md">{investor.partner}</td>
                    <td className="px-lg py-md text-muted">{investor.thesis}</td>
                    <td className="px-lg py-md font-mono text-mono">
                      {investor.check_size}
                    </td>
                    <td className="px-lg py-md">
                      <StatusBadge status={investor.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ReviewPanel
            kicker="List"
            title="Acknowledge this list"
            updatedLabel={`${investors.length} names currently in scope`}
          >
            <p>
              Confirm that these names may be contacted, or request holds and
              removals before outreach is queued.
            </p>
          </ReviewPanel>
        </>
      )}
    </>
  );
}
