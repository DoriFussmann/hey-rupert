import Link from "next/link";
import { MarkdownBody } from "@/components/markdown-body";
import {
  FEEDBACK_PRIORITIES,
  narrativeHasEarlierDraft,
  type FeedbackItem,
  type NarrativePayload,
} from "@/lib/setup";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-md">
        <h2 className="text-h4">{title}</h2>
      </div>
      <div className="px-lg py-lg">{children}</div>
    </section>
  );
}

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

/** The client's feedback, read-only, beside the narrative it shaped. */
function FeedbackAside({
  items,
  doneIds,
  href,
}: {
  items: FeedbackItem[];
  doneIds: string[];
  href?: string;
}) {
  const done = new Set(doneIds);
  const completed = items.filter((item) => done.has(item.id)).length;
  return (
    <aside className="rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-md">
        <h2 className="text-h4">Your feedback</h2>
        <p className="mt-xs text-body-sm text-muted">
          What Rupert recommended on your materials · {completed} of {items.length} done
        </p>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const checked = done.has(item.id);
          return (
            <li key={item.id} className="flex gap-sm px-lg py-sm">
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
      {href ? (
        <div className="border-t border-border px-lg py-sm">
          <Link href={href} className="text-body-sm text-primary hover:text-primary-hover">
            Open Analysis & Feedback
          </Link>
        </div>
      ) : null}
    </aside>
  );
}

/**
 * The Outreach Narrative as the client sees it, with their feedback beside
 * it on wide screens. Used by the client's page and by the live preview in
 * the admin. `stacked` puts the feedback under the narrative (the narrow
 * admin preview column).
 */
export function NarrativeView({
  narrative,
  feedback,
  stacked = false,
}: {
  narrative: NarrativePayload;
  /** The feedback the client received, when it has been shared. */
  feedback?: { items: FeedbackItem[]; doneIds: string[]; href?: string } | null;
  stacked?: boolean;
}) {
  const content = (
    <div className="grid min-w-0 gap-lg">
      <Section title="Core story">
        <MarkdownBody content={narrative.core} emptyLabel="Nothing here yet." />
      </Section>
      <Section title="Key messages">
        <MarkdownBody content={narrative.key_messages} emptyLabel="Nothing here yet." />
      </Section>
      <Section title="Approach">
        <MarkdownBody content={narrative.approach} emptyLabel="Nothing here yet." />
      </Section>
      {narrativeHasEarlierDraft(narrative) ? (
        <section className="rounded-card border border-border bg-surface">
          <div className="border-b border-border px-lg py-md">
            <h2 className="text-h4">Earlier draft</h2>
            <p className="mt-xs text-body-sm text-muted">
              Email and LinkedIn copy from a previous version. The emails for each tier come after the investor list.
            </p>
          </div>
          <div className="grid gap-md px-lg py-md">
            <MessageCard
              title="First email"
              detail="From the earlier narrative."
              subject={narrative.email_subject}
              body={narrative.email_body ?? ""}
            />
            <MessageCard
              title="LinkedIn connection note"
              detail="From the earlier narrative."
              body={narrative.linkedin_note ?? ""}
            />
            <MessageCard
              title="LinkedIn message"
              detail="From the earlier narrative."
              body={narrative.linkedin_followup ?? ""}
            />
          </div>
        </section>
      ) : null}
      <Section title="What happens next">
        <p className="whitespace-pre-wrap text-body-sm text-body">{narrative.next_steps}</p>
      </Section>
    </div>
  );

  if (!feedback || feedback.items.length === 0) return content;

  return (
    <div
      className={
        stacked
          ? "grid gap-lg"
          : "grid gap-lg lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
      }
    >
      {content}
      <div className={stacked ? "" : "lg:sticky lg:top-lg"}>
        <FeedbackAside items={feedback.items} doneIds={feedback.doneIds} href={feedback.href} />
      </div>
    </div>
  );
}
