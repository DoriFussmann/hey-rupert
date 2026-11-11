import { getPortalView } from "@/lib/data";
import { formatDateAtTime } from "@/lib/format";
import { REPLY_STATUS_LABEL, type ReplyStatus } from "@/lib/feedback-points";
import { listReplyRows } from "@/lib/feedback-points-server";
import type { ViewerCommentStep } from "@/lib/viewer-comments";

const STATUS_TONE: Record<ReplyStatus, string> = {
  open: "text-muted",
  changed: "text-success",
  not_changing: "text-secondary",
  needs_input: "text-primary",
};

/**
 * Rupert's replies to the feedback on a review step, as the client and their
 * viewers see them: each point as it was written, who wrote it, and the reply.
 * Only replies Rupert has sent ("Respond") are shown.
 */
export async function FeedbackReplies({ step }: { step: ViewerCommentStep }) {
  const { client } = await getPortalView();
  if (!client?.id) return null;
  const rows = (await listReplyRows(client.id, step)).filter((row) => row.publishedAt);
  if (rows.length === 0) return null;

  return (
    <section className="mt-lg rounded-card border border-border bg-surface px-lg py-md">
      <h2 className="text-h4">Rupert&apos;s Replies to Your Feedback</h2>
      <p className="mt-xs text-body-sm text-muted">
        One reply per point. To answer back, add it to your feedback on the current version.
      </p>
      <ol className="mt-md space-y-md">
        {rows.map((row) => {
          const status = row.publishedStatus ?? "open";
          return (
            <li key={row.pointId} className="rounded-md border border-border bg-background px-md py-md text-body-sm">
              <p className="text-secondary">
                <span className="font-medium text-heading">{row.author}</span>
                {row.source === "viewer" ? " · viewer" : ""} · {row.label} · version {row.version}
              </p>
              <p className="mt-xs whitespace-pre-wrap text-body">{row.point}</p>
              <div className="mt-sm border-l-2 border-primary/40 pl-md">
                <p className="text-label uppercase tracking-label">
                  <span className="text-muted">Rupert</span>
                  {status !== "open" ? (
                    <span className={STATUS_TONE[status]}> · {REPLY_STATUS_LABEL[status]}</span>
                  ) : null}
                  {row.publishedAt ? <span className="text-muted"> · {formatDateAtTime(row.publishedAt)}</span> : null}
                </p>
                {row.publishedReply ? (
                  <p className="mt-xs whitespace-pre-wrap text-body">{row.publishedReply}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
