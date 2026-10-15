import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { MarkdownBody } from "@/components/markdown-body";
import { TurnBanner } from "@/components/setup/turn-banner";
import { isServiceRoleConfigured } from "@/lib/env";
import { markFeedbackViewed } from "@/lib/feedback-server";
import { formatDateAtTime } from "@/lib/format";
import { isHttpUrl } from "@/lib/material-fields";
import { getPortalSetup } from "@/lib/portal-setup";
import {
  FEEDBACK_AREAS,
  FEEDBACK_PRIORITIES,
  asFeedbackPublished,
  fileExtension,
  formatBytes,
  type FeedbackItem,
} from "@/lib/setup";
import { signFileLinks } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

const PRIORITY_TONE: Record<FeedbackItem["priority"], string> = {
  high: "border-primary/30 bg-primary-tint text-primary",
  medium: "border-border text-secondary",
  low: "border-border text-muted",
};

function areaLabel(value: FeedbackItem["area"]) {
  return FEEDBACK_AREAS.find((area) => area.value === value)?.label ?? value;
}

function priorityLabel(value: FeedbackItem["priority"]) {
  return FEEDBACK_PRIORITIES.find((priority) => priority.value === value)?.label ?? value;
}

export default async function DeckReviewPage() {
  const { item, row, viewAs } = await getPortalSetup("deck_review");
  const published = row?.status === "published";
  const feedback = asFeedbackPublished(row?.published);

  const supabase = published && isServiceRoleConfigured() ? createServiceClient() : null;
  if (supabase && row && !viewAs) await markFeedbackViewed(supabase, row);
  const fileLinks =
    supabase && feedback.attachments.length > 0
      ? await signFileLinks(supabase, feedback.attachments)
      : {};
  const links = feedback.links.filter((link) => isHttpUrl(link.url));

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Analysis & Feedback"
        description="Rupert's feedback on your pitch deck and materials. Apply what's useful: the deck is yours."
      />
      {!published ? (
        <TurnBanner
          owner="rupert"
          title={item?.detail ?? "Rupert is reviewing your materials."}
          detail="We'll email you when the feedback is ready."
        />
      ) : (
        <>
          <TurnBanner
            owner="rupert"
            title="Nothing to sign off here. Rupert is already on the next steps."
            detail="He follows up shortly with your outreach narrative for investors, and is working on your investor matching in parallel. We'll email you when the narrative is ready."
          />
          <div className="grid gap-lg">
            <section className="rounded-card border border-border bg-surface">
              <div className="border-b border-border px-lg py-md">
                <p className="text-label uppercase tracking-label text-muted">From Rupert</p>
                <p className="mt-xs text-body-sm text-muted">
                  {row?.published_at
                    ? `${row.version > 1 ? "Updated" : "Shared"} ${formatDateAtTime(row.published_at)}`
                    : ""}
                </p>
              </div>
              {feedback.intro ? (
                <div className="px-lg py-lg">
                  <MarkdownBody content={feedback.intro} emptyLabel="" />
                </div>
              ) : null}
            </section>

            {feedback.items.length > 0 ? (
              <section className="rounded-card border border-border bg-surface">
                <div className="border-b border-border px-lg py-md">
                  <h2 className="text-h4">Recommendations</h2>
                  <p className="mt-xs text-body-sm text-muted">
                    {feedback.items.length} recommendation
                    {feedback.items.length === 1 ? "" : "s"}, most important first.
                  </p>
                </div>
                <ol className="divide-y divide-border">
                  {feedback.items.map((entry, index) => (
                    <li key={entry.id} className="flex gap-md px-lg py-md">
                      <span className="mt-xs w-6 shrink-0 font-mono text-mono text-muted">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-sm">
                          <span
                            className={`inline-flex rounded-full border px-sm text-label uppercase tracking-label ${PRIORITY_TONE[entry.priority]}`}
                          >
                            {priorityLabel(entry.priority)}
                          </span>
                          <span className="text-label uppercase tracking-label text-muted">
                            {areaLabel(entry.area)}
                            {entry.slide ? ` · Slide ${entry.slide}` : ""}
                          </span>
                        </div>
                        {entry.title ? (
                          <p className="mt-xs text-body-sm text-heading">{entry.title}</p>
                        ) : null}
                        {entry.body ? (
                          <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">
                            {entry.body}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {feedback.attachments.length > 0 || links.length > 0 ? (
              <section className="rounded-card border border-border bg-surface px-lg py-md">
                <h2 className="text-h4">Files & links from Rupert</h2>
                <ul className="mt-sm divide-y divide-border">
                  {feedback.attachments.map((file) => (
                    <li key={file.path} className="flex flex-wrap items-center gap-md py-sm">
                      <span className="rounded-md border border-border px-xs text-label uppercase tracking-label text-muted">
                        {fileExtension(file.name) || "file"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-body-sm text-heading">
                        {file.name}
                      </span>
                      <span className="text-body-sm text-muted">{formatBytes(file.size)}</span>
                      {fileLinks[file.path] ? (
                        <a
                          href={fileLinks[file.path]}
                          className="text-body-sm text-primary hover:text-primary-hover"
                        >
                          Download
                        </a>
                      ) : (
                        <span className="text-body-sm text-muted">Link unavailable</span>
                      )}
                    </li>
                  ))}
                  {links.map((link) => (
                    <li key={link.id} className="py-sm text-body-sm">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-primary hover:text-primary-hover"
                      >
                        {link.label || link.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
