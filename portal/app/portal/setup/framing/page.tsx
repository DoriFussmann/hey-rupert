import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { NarrativeView } from "@/components/setup/narrative-view";
import { ResponseHistory } from "@/components/setup/response-history";
import { AdminReply } from "@/components/setup/admin-reply";
import { NarrativeReview } from "@/components/setup/narrative-review";
import { ReviewStatus } from "@/components/setup/review-status";
import { TurnBanner } from "@/components/setup/turn-banner";
import { isServiceRoleConfigured } from "@/lib/env";
import { getPortalSetup } from "@/lib/portal-setup";
import {
  asFeedbackPublished,
  asNarrative,
  feedbackChecks,
  isSharedWithClient,
} from "@/lib/setup";
import { signFileLinks } from "@/lib/setup-server";
import { markStepViewed } from "@/lib/step-views-server";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function FramingPage() {
  const { client, item, row, viewAs } = await getPortalSetup("framing");
  const visible = Boolean(row && row.version > 0);
  const narrative = asNarrative(row?.published);

  const supabase = visible && isServiceRoleConfigured() ? createServiceClient() : null;
  if (supabase && row && !viewAs) await markStepViewed(supabase, row, "framing");
  const fileLinks =
    supabase && narrative.attachments.length > 0
      ? await signFileLinks(supabase, narrative.attachments)
      : {};

  // Feedback the client received as its own step earlier, shown beside the
  // narrative when this version carries no Company Materials Feedback.
  const feedbackRow = client?.setup_steps?.find((entry) => entry.step === "deck_review") ?? null;
  const shared =
    !narrative.feedback && feedbackRow && isSharedWithClient(feedbackRow)
      ? asFeedbackPublished(feedbackRow.published)
      : null;
  const feedback =
    feedbackRow && shared && (shared.framing.trim() || shared.items.length > 0)
      ? {
          framing: shared.framing,
          items: shared.items,
          doneIds: feedbackChecks(feedbackRow.client_checks, shared.items),
          href: "/portal/setup/deck-review",
        }
      : null;

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Outreach Narrative"
        description="How we'll present the company to investors: the story, the key messages, and how Rupert will approach them. With it, Rupert's feedback on your materials."
      />
      {row?.status === "with_client" ? (
        <TurnBanner
          owner="client"
          title={
            narrative.feedback
              ? "Review the story, the key messages and the approach, then confirm or send Rupert your notes. Read his feedback on your materials too: nothing to confirm there."
              : "Review the story, the key messages and the approach, then confirm or send Rupert your notes."
          }
        />
      ) : null}
      <ReviewStatus
        item={item}
        row={row}
        waitingTitle="Rupert has your note."
        waitingDetail="He'll reply and send the narrative back for you to confirm."
      />
      {visible && row ? (
        <>
          {row.status === "with_client" && narrative.admin_note ? (
            <div className="sticky top-0 z-20">
              <AdminReply note={narrative.admin_note} />
            </div>
          ) : null}
          <NarrativeView narrative={narrative} fileLinks={fileLinks} feedback={feedback} />
          {row.status === "with_client" ? (
            <>
              <AdminReply note={narrative.admin_note} />
              <NarrativeReview
                version={row.version}
                hasFeedback={Boolean(narrative.feedback)}
                readOnly={viewAs}
              />
            </>
          ) : null}
          <ResponseHistory history={row.history} currentVersion={row.version} />
        </>
      ) : null}
    </>
  );
}
