import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { FeedbackView } from "@/components/setup/feedback-view";
import { ReviewActions } from "@/components/setup/review-actions";
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
import { markStepViewed } from "@/lib/step-views-server";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function DeckReviewPage() {
  const { item, row, viewAs } = await getPortalSetup("deck_review");
  const shared = isSharedWithClient(row);
  const feedback = asFeedbackPublished(row?.published);

  const supabase = shared && isServiceRoleConfigured() ? createServiceClient() : null;
  if (supabase && row && !viewAs) await markStepViewed(supabase, row, "deck_review");
  const fileLinks =
    supabase && feedback.attachments.length > 0
      ? await signFileLinks(supabase, feedback.attachments)
      : {};

  const sharedAt = row?.published_at
    ? `${row.version > 1 ? "Updated" : "Shared"} ${formatDateAtTime(row.published_at)}`
    : "";

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Analysis & Feedback"
        description="Rupert's feedback on your pitch deck and materials. Apply what's useful: the deck is yours."
      />
      {!shared || !row ? (
        <TurnBanner
          owner="rupert"
          title={item?.detail ?? "Rupert is reviewing your materials."}
          detail="We'll email you when the feedback is ready."
        />
      ) : (
        <>
          {row.status === "with_client" ? (
            <TurnBanner
              owner="client"
              title={
                row.version > 1
                  ? "Rupert updated his feedback. Read it through, then confirm."
                  : "Read Rupert's feedback, then confirm."
              }
              detail="Confirming tells Rupert you've seen it. Once you've also confirmed the outreach narrative, he sends your matched investor list."
            />
          ) : (
            <TurnBanner
              owner="done"
              title={
                row.status === "confirmed" && row.response?.at
                  ? `You confirmed this on ${formatDateAtTime(row.response.at)}.`
                  : "Feedback shared. Nothing more to do here."
              }
              detail="Tick off the recommendations as you go: it helps you and Rupert track them."
            />
          )}
          <FeedbackView
            feedback={feedback}
            fileLinks={fileLinks}
            doneIds={feedbackChecks(row.client_checks, feedback.items)}
            readOnly={viewAs}
            meta={sharedAt}
          />
          {row.status === "with_client" ? (
            <ReviewActions
              step="deck_review"
              version={row.version}
              confirmLabel="Confirm feedback"
              allowChanges={false}
              intro="Confirm that you've read the feedback. Add a note if there's anything Rupert should know."
              notePlaceholder="Anything Rupert should know (optional)"
              readOnly={viewAs}
            />
          ) : null}
        </>
      )}
    </>
  );
}
