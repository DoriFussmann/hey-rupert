import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { NarrativeView } from "@/components/setup/narrative-view";
import { ResponseHistory } from "@/components/setup/response-history";
import { AdminReply } from "@/components/setup/admin-reply";
import { NarrativeReview } from "@/components/setup/narrative-review";
import { ReviewStatus } from "@/components/setup/review-status";
import { QuestionThread } from "@/components/setup/question-thread";
import { FounderQuestions } from "@/components/setup/founder-questions";
import { loadFounderQuestions } from "@/lib/brief-server";
import { isServiceRoleConfigured } from "@/lib/env";
import { getPortalSetup } from "@/lib/portal-setup";
import {
  asFeedbackPublished,
  asNarrative,
  feedbackChecks,
  isSharedWithClient,
  questionsOf,
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

  // Rupert's questions sent with this version, with any answers already given.
  const asked = narrative.founder_questions ?? [];
  const answers = supabase && client && asked.length > 0 ? await loadFounderQuestions(supabase, client.id) : null;
  const founderQuestions = asked.map((item) => ({
    ...item,
    answer: (answers?.ok ? answers.value.find((entry) => entry.id === item.id)?.answer : "") ?? "",
  }));

  const open = row?.status === "with_client";
  const questions = questionsOf(row);

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Outreach Narrative"
        description="How Rupert will present your company to investors. With it, his feedback on your materials."
      />
      <ReviewStatus
        item={item}
        row={row}
        clientTitle={
          narrative.feedback
            ? "Confirm The Outreach Narrative. Rupert's feedback on your materials is below it: nothing to confirm there."
            : "Confirm The Outreach Narrative, or ask Rupert a question."
        }
        waitingTitle="Rupert has your note."
        waitingDetail="He'll reply and send the narrative back for you to confirm."
      />
      {visible && row ? (
        <>
          {open ? <AdminReply note={narrative.admin_note} /> : null}
          <FounderQuestions items={founderQuestions} readOnly={viewAs} />
          <NarrativeView
            narrative={narrative}
            fileLinks={fileLinks}
            feedback={feedback}
            actions={
              open ? (
                <>
                  <QuestionThread questions={questions} />
                  <NarrativeReview
                    version={row.version}
                    hasFeedback={Boolean(narrative.feedback)}
                    readOnly={viewAs}
                  />
                </>
              ) : questions.length > 0 ? (
                <QuestionThread questions={questions} />
              ) : null
            }
          />
          <ResponseHistory history={row.history} currentVersion={row.version} />
        </>
      ) : null}
    </>
  );
}
