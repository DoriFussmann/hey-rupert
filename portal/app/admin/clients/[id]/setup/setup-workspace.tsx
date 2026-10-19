import { EmailCopyPanel } from "@/app/admin/clients/[id]/setup/email-copy-panel";
import { FeedbackWorkspace } from "@/app/admin/clients/[id]/setup/feedback-workspace";
import { InvestorListPanel } from "@/app/admin/clients/[id]/setup/investor-list-panel";
import { NarrativeEditor } from "@/app/admin/clients/[id]/setup/narrative-editor";
import {
  SETUP_TOTAL,
  asFeedback,
  asFeedbackPublished,
  asInvestorList,
  feedbackChecks,
  getSetupItems,
  isSharedWithClient,
  readyForInvestorList,
  tierCounts,
  type SetupSource,
  type SetupStepId,
} from "@/lib/setup";

/**
 * Rupert's side of the Setup Turn Engine: one panel per step, in order.
 * Server component; each panel is interactive.
 */
export function SetupWorkspace({
  clientId,
  source,
  feedbackLinks,
  claudeReady,
}: {
  clientId: string;
  source: SetupSource;
  /** Signed links for files attached to the feedback. */
  feedbackLinks: Record<string, string>;
  claudeReady: boolean;
}) {
  const items = getSetupItems(source);
  const rows = source.setup_steps ?? [];
  const item = (id: SetupStepId) => items.find((entry) => entry.id === id)!;
  const row = (id: SetupStepId) => rows.find((entry) => entry.step === id) ?? null;
  const done = items.filter((entry) => entry.status === "done").length;
  const materialsSubmitted = row("materials")?.status === "submitted";
  const feedbackRow = row("deck_review");
  const hasAnalysis = Boolean(asFeedback(feedbackRow?.draft).analysis);
  const counts = tierCounts(asInvestorList(row("investor_list")?.published).rows);
  const ready = readyForInvestorList(source);

  // The feedback the client has, as it appears beside their narrative.
  const sharedFeedback = isSharedWithClient(feedbackRow)
    ? asFeedbackPublished(feedbackRow?.published).items
    : [];
  const narrativeFeedback =
    feedbackRow && sharedFeedback.length > 0
      ? { items: sharedFeedback, doneIds: feedbackChecks(feedbackRow.client_checks, sharedFeedback) }
      : null;

  return (
    <section className="mt-lg">
      <div className="rounded-card border border-border bg-surface px-lg py-lg">
        <div className="flex flex-wrap items-center gap-sm">
          <h2 className="text-h4">Setup</h2>
          {ready ? (
            <a
              href="#setup-investor_list"
              className="inline-flex rounded-full border border-primary/30 bg-primary-tint px-sm py-xs text-label uppercase tracking-label text-primary no-underline"
            >
              Ready for investor list
            </a>
          ) : null}
        </div>
        <p className="mt-xs text-body-sm text-muted">
          {done} of {SETUP_TOTAL} complete. Analysis & Feedback and the outreach narrative run
          side by side: push each one, email the client, and the client confirms. Once both are
          confirmed → investor list, client confirms → email copy, client confirms.
        </p>
        <ol className="mt-md flex flex-wrap gap-sm text-body-sm">
          {items.map((entry, index) => (
            <li key={entry.id}>
              <a
                href={`#setup-${entry.id}`}
                className={`inline-flex rounded-full border px-sm py-xs no-underline ${
                  entry.status === "waiting"
                    ? "border-primary/30 bg-primary-tint text-primary"
                    : entry.status === "done"
                      ? "border-border text-success"
                      : "border-border text-muted"
                }`}
              >
                {index + 1}. {entry.title}
                {entry.status === "waiting"
                  ? " · your turn"
                  : entry.status === "your_turn"
                    ? " · client"
                    : entry.status === "done"
                      ? " · done"
                      : ""}
              </a>
            </li>
          ))}
        </ol>
      </div>

      <FeedbackWorkspace
        clientId={clientId}
        item={item("deck_review")}
        row={feedbackRow}
        materialsSubmitted={materialsSubmitted}
        claudeReady={claudeReady}
        attachmentLinks={feedbackLinks}
      />
      <NarrativeEditor
        clientId={clientId}
        item={item("framing")}
        row={row("framing")}
        hasAnalysis={hasAnalysis}
        claudeReady={claudeReady}
        feedback={narrativeFeedback}
      />
      <InvestorListPanel
        clientId={clientId}
        item={item("investor_list")}
        row={row("investor_list")}
      />
      <EmailCopyPanel
        clientId={clientId}
        item={item("email_copy")}
        row={row("email_copy")}
        tierCounts={counts}
        claudeReady={claudeReady}
      />
    </section>
  );
}
