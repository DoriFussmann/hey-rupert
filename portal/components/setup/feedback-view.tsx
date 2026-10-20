import { CollapsiblePanel } from "@/components/setup/collapsible-panel";
import { FeedbackChecklist } from "@/components/setup/feedback-checklist";
import { FilesLinksView } from "@/components/setup/files-links-view";
import { MarkdownBody } from "@/components/markdown-body";
import type { FeedbackPublished } from "@/lib/setup";

/**
 * The Analysis & Feedback as the client sees it: Rupert's Company Summary
 * and Investor Framing (panels, closed by default, one above the other),
 * and the files and links he shared. Feedback sent
 * before that shows its message and recommendations checklist instead.
 */
export function FeedbackView({
  feedback,
  fileLinks,
  doneIds,
  readOnly,
  meta,
}: {
  feedback: FeedbackPublished;
  /** Signed download links by file path. */
  fileLinks: Record<string, string>;
  /** Recommendations the client ticked as done (earlier feedback). */
  doneIds: string[];
  readOnly: boolean;
  /** "Shared …" line under the first section. */
  meta?: string;
}) {
  return (
    <div className="grid gap-md">
      {feedback.summary.trim() ? (
        <CollapsiblePanel title="Company Summary" meta={meta}>
          <MarkdownBody content={feedback.summary} emptyLabel="" />
        </CollapsiblePanel>
      ) : null}
      {feedback.framing.trim() ? (
        <CollapsiblePanel title="Investor Framing">
          <MarkdownBody content={feedback.framing} emptyLabel="" />
        </CollapsiblePanel>
      ) : null}
      {feedback.intro.trim() ? (
        <CollapsiblePanel title="From Rupert" meta={feedback.summary.trim() ? undefined : meta}>
          <MarkdownBody content={feedback.intro} emptyLabel="" />
        </CollapsiblePanel>
      ) : null}
      {feedback.items.length > 0 ? (
        <FeedbackChecklist items={feedback.items} initialDone={doneIds} readOnly={readOnly} />
      ) : null}
      <FilesLinksView
        attachments={feedback.attachments}
        links={feedback.links}
        fileLinks={fileLinks}
      />
    </div>
  );
}
