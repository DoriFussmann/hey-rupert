import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { ResponseHistory } from "@/components/setup/response-history";
import { ReviewStatus } from "@/components/setup/review-status";
import { EmailCopyReview } from "@/app/portal/setup/email-copy/email-copy-review";
import { getPortalSetup } from "@/lib/portal-setup";
import { asEmailCopy, asInvestorList, tierCounts } from "@/lib/setup";

export default async function EmailCopyPage() {
  const { client, item, row, viewAs } = await getPortalSetup("email_copy");
  const visible = Boolean(row && row.version > 0);
  const copy = asEmailCopy(row?.published);
  const list = client?.setup_steps?.find((entry) => entry.step === "investor_list");
  const counts = tierCounts(asInvestorList(list?.published).rows);
  const sentNotes =
    row && row.response && row.response.version === row.version
      ? row.response.item_notes
      : {};

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Email Copy"
        description="The outreach emails for each investor tier: a first email and two follow-ups. Personal details like the investor's name are filled in per recipient."
      />
      <ReviewStatus item={item} row={row} />
      {visible && row ? (
        <>
          <EmailCopyReview
            copy={copy}
            counts={counts}
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
