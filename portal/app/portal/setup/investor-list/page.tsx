import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { ResponseHistory } from "@/components/setup/response-history";
import { TurnBanner } from "@/components/setup/turn-banner";
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
        description="The investors Rupert matched for this raise. Open a fund type to look through it. Add a comment if you want, then confirm."
      />
      {row?.status === "with_client" ? (
        <TurnBanner
          owner="client"
          title="Review the list and confirm it, or send Rupert your notes. Outreach can't start until you confirm."
        />
      ) : null}
      <ReviewStatus
        item={item}
        row={row}
        waitingTitle="Rupert has your note."
        waitingDetail="He'll reply and send this list back for you to confirm."
      />
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
            adminNote={list.admin_note}
            readOnly={viewAs}
          />
          <ResponseHistory history={row.history} currentVersion={row.version} />
        </>
      ) : null}
    </>
  );
}
