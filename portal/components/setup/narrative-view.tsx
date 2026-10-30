import Link from "next/link";
import { NarrativeStatementView } from "@/components/setup/narrative-statement";
import { CollapsiblePanel } from "@/components/setup/collapsible-panel";
import { FilesLinksView } from "@/components/setup/files-links-view";
import { MarkdownBody } from "@/components/markdown-body";
import {
  FEEDBACK_PRIORITIES,
  narrativeHasEarlierDraft,
  type FeedbackItem,
  type MaterialsFeedback,
  type NarrativePayload,
} from "@/lib/setup";

function MessageCard({
  title,
  detail,
  subject,
  body,
}: {
  title: string;
  detail: string;
  subject?: string;
  body: string;
}) {
  if (!body.trim() && !subject?.trim()) return null;
  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-md">
        <h3 className="text-h4">{title}</h3>
        <p className="mt-xs text-body-sm text-muted">{detail}</p>
      </div>
      <div className="px-lg py-md">
        {subject?.trim() ? (
          <p className="text-body-sm">
            <span className="text-label uppercase tracking-label text-muted">Subject </span>
            <span className="text-heading">{subject}</span>
          </p>
        ) : null}
        <p
          className={`whitespace-pre-wrap text-body-sm text-body ${subject?.trim() ? "mt-sm" : ""}`}
        >
          {body}
        </p>
      </div>
    </section>
  );
}

function priorityLabel(item: FeedbackItem) {
  return FEEDBACK_PRIORITIES.find((entry) => entry.value === item.priority)?.label ?? "";
}

/**
 * Feedback the client received as its own step, before it moved into the
 * narrative: Rupert's Investor Framing, or the recommendations from feedback
 * sent before the framing was shared, as one panel in the stack.
 */
function FeedbackPanel({ feedback }: { feedback: NarrativeFeedback }) {
  const done = new Set(feedback.doneIds);
  const completed = feedback.items.filter((item) => done.has(item.id)).length;
  return (
    <CollapsiblePanel
      title={feedback.framing ? "Investor Framing" : "Your Feedback"}
      meta={
        feedback.framing
          ? "From Rupert's Analysis & Feedback."
          : `What Rupert recommended on your materials · ${completed} of ${feedback.items.length} done`
      }
    >
      {feedback.framing ? (
        <MarkdownBody content={feedback.framing} emptyLabel="" />
      ) : (
        <ul className="-my-sm divide-y divide-border">
          {feedback.items.map((item) => {
            const checked = done.has(item.id);
            return (
              <li key={item.id} className="flex gap-sm py-sm">
                <span
                  aria-hidden
                  className={`mt-xs inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${
                    checked ? "border-success bg-success text-white" : "border-border"
                  }`}
                >
                  {checked ? "✓" : ""}
                </span>
                <div className="min-w-0">
                  <p className={`text-body-sm text-heading ${checked ? "line-through opacity-60" : ""}`}>
                    {item.title || item.body}
                  </p>
                  <p className="text-label uppercase tracking-label text-muted">
                    {priorityLabel(item)} priority
                    <span className="sr-only">{checked ? ", done" : ", not done"}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href={feedback.href}
        className="mt-md inline-block text-body-sm text-primary hover:text-primary-hover"
      >
        Open Analysis & Feedback
      </Link>
    </CollapsiblePanel>
  );
}

export type NarrativeFeedback = {
  framing: string;
  items: FeedbackItem[];
  doneIds: string[];
  href: string;
};

/**
 * Rupert's Company Materials Feedback, sent with this version of the
 * narrative. For the client to read; it is never confirmed.
 */
function MaterialsFeedbackPanel({ feedback }: { feedback: MaterialsFeedback }) {
  return (
    <CollapsiblePanel
      title="Company Materials Feedback"
      meta="Rupert's notes on your deck and materials, for you to act on as you see fit. Nothing to confirm."
    >
      <div className="grid gap-lg">
        {feedback.summary.trim() ? (
          <section>
            <h3 className="text-label uppercase tracking-label text-muted">
              How Rupert reads your company
            </h3>
            <MarkdownBody content={feedback.summary} emptyLabel="" className="sow-markdown mt-sm max-w-prose" />
          </section>
        ) : null}
        {feedback.improvements.trim() ? (
          <section>
            <h3 className="text-label uppercase tracking-label text-muted">
              What to improve in your materials
            </h3>
            <MarkdownBody content={feedback.improvements} emptyLabel="" className="sow-markdown mt-sm max-w-prose" />
          </section>
        ) : null}
      </div>
    </CollapsiblePanel>
  );
}

/**
 * The Outreach Narrative as the client sees it: the one narrative they
 * confirm (or, on versions written before it existed, the core story, key
 * messages and approach), then Confirm, then the Company Materials Feedback
 * (nothing to confirm), the files and links, and What Happens Next.
 */
export function NarrativeView({
  narrative,
  fileLinks,
  feedback,
  actions,
}: {
  narrative: NarrativePayload;
  /** Signed download links by file path. */
  fileLinks: Record<string, string>;
  /** Feedback the client received as its own step earlier, when there is no Company Materials Feedback. */
  feedback?: NarrativeFeedback | null;
  /** Confirm and the rest, shown right under the narrative, above the feedback. */
  actions?: React.ReactNode;
}) {
  const materialsFeedback = narrative.feedback;
  const showFeedback =
    !materialsFeedback && Boolean(feedback && (feedback.framing || feedback.items.length > 0));

  return (
    <div className="grid min-w-0 gap-md">
      {narrative.summary.trim() ? (
        <section
          aria-labelledby="outreach-narrative-title"
          className="rounded-card border border-border bg-surface px-lg py-lg"
        >
          <h2 id="outreach-narrative-title" className="text-h3 text-heading">
            The Outreach Narrative
          </h2>
          {narrative.statement ? (
            <div className="mt-sm">
              <NarrativeStatementView statement={narrative.statement} />
            </div>
          ) : (
            <MarkdownBody content={narrative.summary} emptyLabel="" className="sow-markdown mt-sm max-w-prose" />
          )}
        </section>
      ) : (
        <>
          <CollapsiblePanel title="Core Story">
            <MarkdownBody content={narrative.core} emptyLabel="Nothing here yet." />
          </CollapsiblePanel>
          <CollapsiblePanel title="Key Messages">
            <MarkdownBody content={narrative.key_messages} emptyLabel="Nothing here yet." />
          </CollapsiblePanel>
          <CollapsiblePanel title="Approach">
            <MarkdownBody content={narrative.approach} emptyLabel="Nothing here yet." />
          </CollapsiblePanel>
        </>
      )}
      {actions}
      {materialsFeedback ? <MaterialsFeedbackPanel feedback={materialsFeedback} /> : null}
      {showFeedback && feedback ? <FeedbackPanel feedback={feedback} /> : null}
      {narrativeHasEarlierDraft(narrative) ? (
        <CollapsiblePanel
          title="Earlier Draft"
          meta="Email and LinkedIn copy from a previous version. The emails for each tier come after the investor list."
        >
          <div className="grid gap-md">
            <MessageCard
              title="First Email"
              detail="From the earlier narrative."
              subject={narrative.email_subject}
              body={narrative.email_body ?? ""}
            />
            <MessageCard
              title="LinkedIn Connection Note"
              detail="From the earlier narrative."
              body={narrative.linkedin_note ?? ""}
            />
            <MessageCard
              title="LinkedIn Message"
              detail="From the earlier narrative."
              body={narrative.linkedin_followup ?? ""}
            />
          </div>
        </CollapsiblePanel>
      ) : null}
      <FilesLinksView
        attachments={narrative.attachments}
        links={narrative.links}
        fileLinks={fileLinks}
      />
      <section
        aria-labelledby="narrative-next-steps"
        className="mt-sm rounded-card border border-primary/30 bg-primary-tint px-lg py-md"
      >
        <h2 id="narrative-next-steps" className="text-h4 text-heading">
          What Happens Next
        </h2>
        <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">{narrative.next_steps}</p>
      </section>
    </div>
  );
}
