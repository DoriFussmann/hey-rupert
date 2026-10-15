import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { ResponseHistory } from "@/components/setup/response-history";
import { ReviewStatus } from "@/components/setup/review-status";
import { InvestorListReview } from "@/app/portal/setup/investor-list/investor-list-review";
import { InvestorListSummaryPanel } from "@/components/setup/investor-list-summary";
import { getPortalSetup } from "@/lib/portal-setup";
import { asInvestorList } from "@/lib/setup";

export default async function InvestorListPage() {
  const { item, row, viewAs } = await getPortalSetup("investor_list");
  const visible = Boolean(row && row.version > 0);
  const list = asInvestorList(row?.published);
  const sentNotes =
    row && row.response && row.response.version === row.version
      ? row.response.item_notes
      : {};

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Investor Matching"
        description="The investors Rupert matched for this raise, in three fit tiers. Add a note on any fund (already in touch, not a fit, a question), then confirm."
      />
      <ReviewStatus item={item} row={row} />
      {visible && row ? (
        <>
          {list.summary ? (
            <div className="mb-lg">
              <InvestorListSummaryPanel summary={list.summary} />
            </div>
          ) : null}
          <InvestorListReview
            rows={list.rows}
            version={row.version}
            open={row.status === "with_client"}
            sentNotes={sentNotes}
            readOnly={viewAs}
          />
          <ResponseHistory history={row.history} currentVersion={row.version} />
        </>
      ) : null}
    </>
  );
}
