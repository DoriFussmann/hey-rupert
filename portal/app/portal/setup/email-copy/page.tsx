import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { ResponseHistory } from "@/components/setup/response-history";
import { ReviewStatus } from "@/components/setup/review-status";
import { EmailCopyReview } from "@/app/portal/setup/email-copy/email-copy-review";
import { getPortalSetup } from "@/lib/portal-setup";
import { asEmailCopy, asInvestorList, questionsOf, tierCounts } from "@/lib/setup";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadApprovedCoreForClient } from "@/lib/outreach/core-server";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function EmailCopyPage() {
  const { client, item, row, viewAs } = await getPortalSetup("email_copy");
  const visible = Boolean(row && row.version > 0);
  const copy = asEmailCopy(row?.published);
  const list = client?.setup_steps?.find((entry) => entry.step === "investor_list");
  const investors = asInvestorList(list?.published);
  // Fund counts only when the list groups funds the same way as the copy.
  const counts =
    (investors.tier_scheme ?? "three") === (copy.tier_scheme ?? "three")
      ? tierCounts(investors.rows, copy.tier_scheme)
      : [];
  // The personal Core emails Rupert approved, for copy written by fund type.
  const coreEmails =
    visible && client?.id && copy.copy_version === 2 && isServiceRoleConfigured()
      ? await loadApprovedCoreForClient(createServiceClient(), client.id)
      : [];
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
      <ReviewStatus
        item={item}
        row={row}
        clientTitle="Review the emails and LinkedIn messages, then confirm them or ask Rupert a question."
        waitingTitle="Rupert has your note."
        waitingDetail="He'll reply and send the emails back for you to confirm."
      />
      {visible && row ? (
        <>
          <EmailCopyReview
            copy={copy}
            counts={counts}
            version={row.version}
            open={row.status === "with_client"}
            sentNotes={sentNotes}
            adminNote={copy.admin_note}
            questions={questionsOf(row)}
            readOnly={viewAs}
            coreEmails={coreEmails}
          />
          <ResponseHistory history={row.history} currentVersion={row.version} />
        </>
      ) : null}
    </>
  );
}
