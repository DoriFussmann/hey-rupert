import { FeedbackChecklist } from "@/components/setup/feedback-checklist";
import { FilesLinksView } from "@/components/setup/files-links-view";
import { MarkdownBody } from "@/components/markdown-body";
import type { FeedbackPublished } from "@/lib/setup";

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-md">
        <h2 className="text-h4">{title}</h2>
        {meta ? <p className="mt-xs text-body-sm text-muted">{meta}</p> : null}
      </div>
      <div className="px-lg py-lg">{children}</div>
    </section>
  );
}

/**
 * The Analysis & Feedback as the client sees it: Rupert's Company Summary
 * and Investor Framing, and the files and links he shared. Feedback sent
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
    <div className="grid gap-lg">
      {feedback.summary.trim() ? (
        <Section title="Company summary" meta={meta}>
          <MarkdownBody content={feedback.summary} emptyLabel="" />
        </Section>
      ) : null}
      {feedback.framing.trim() ? (
        <Section title="Investor framing">
          <MarkdownBody content={feedback.framing} emptyLabel="" />
        </Section>
      ) : null}
      {feedback.intro.trim() ? (
        <Section title="From Rupert" meta={feedback.summary.trim() ? undefined : meta}>
          <MarkdownBody content={feedback.intro} emptyLabel="" />
        </Section>
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
