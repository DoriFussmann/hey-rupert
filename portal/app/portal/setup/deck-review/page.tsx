import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { FeedbackView } from "@/components/setup/feedback-view";
import { TurnBanner } from "@/components/setup/turn-banner";
import { isServiceRoleConfigured } from "@/lib/env";
import { formatDateAtTime } from "@/lib/format";
import { getPortalSetup } from "@/lib/portal-setup";
import {
  asFeedbackPublished,
  feedbackChecks,
  isSharedWithClient,
} from "@/lib/setup";
import { signFileLinks } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

/**
 * Feedback sent as its own step, before it moved into the Outreach
 * Narrative. Read only: kept for the clients who received it.
 */
export default async function DeckReviewPage() {
  const { row, viewAs } = await getPortalSetup("deck_review");
  const shared = isSharedWithClient(row);
  const feedback = asFeedbackPublished(row?.published);

  const supabase = shared && isServiceRoleConfigured() ? createServiceClient() : null;
  const fileLinks =
    supabase && feedback.attachments.length > 0
      ? await signFileLinks(supabase, feedback.attachments)
      : {};

  const sharedAt = row?.published_at
    ? `${row.version > 1 ? "Updated" : "Shared"} ${formatDateAtTime(row.published_at)}`
    : "";

  return (
    <>
      <BackLink href="/portal/setup/framing" label="Outreach Narrative" />
      <PageHeader
        title="Analysis & Feedback"
        description="Rupert's earlier feedback on your company and materials. For your reference: there's nothing to confirm."
      />
      {!shared || !row ? (
        <TurnBanner
          owner="rupert"
          title="Rupert's feedback on your materials comes with your outreach narrative."
          detail="We'll email you when it's ready."
        />
      ) : (
        <>
          <TurnBanner
            owner="done"
            title="Feedback shared. Nothing to do here."
            detail={
              feedback.items.length > 0
                ? "Tick off the recommendations as you go: it helps you and Rupert track them."
                : undefined
            }
          />
          <FeedbackView
            feedback={feedback}
            fileLinks={fileLinks}
            doneIds={feedbackChecks(row.client_checks, feedback.items)}
            readOnly={viewAs}
            meta={sharedAt}
          />
        </>
      )}
    </>
  );
}
