import { ViewerCommentForm } from "@/components/setup/viewer-comment-form";
import { getPortalView } from "@/lib/data";
import { formatDateAtTime } from "@/lib/format";
import { listViewerComments } from "@/lib/viewer-comments-server";
import type { ViewerComment, ViewerCommentStep } from "@/lib/viewer-comments";

/** One viewer comment: who wrote it, on which version, when, and the text. */
export function ViewerCommentItem({ comment }: { comment: ViewerComment }) {
  return (
    <li className="text-body-sm">
      <p className="text-secondary">
        <span className="font-medium text-heading">{comment.viewerName}</span> · viewer · version{" "}
        {comment.version}
        {comment.createdAt ? ` · ${formatDateAtTime(comment.createdAt)}` : ""}
      </p>
      <p className="mt-xs whitespace-pre-wrap text-body">{comment.body}</p>
    </li>
  );
}

/**
 * Viewer comments on a portal review page. The client and the viewers all see
 * the same list, each comment under the viewer's name; only a viewer gets the
 * box to add one. Shows nothing when there are no comments and no one to add.
 */
export async function ViewerComments({ step }: { step: ViewerCommentStep }) {
  const { client, viewer } = await getPortalView();
  if (!client?.id) return null;
  const comments = await listViewerComments(client.id, step);
  if (!viewer && comments.length === 0) return null;
  const company = client.company_name?.trim() || "the team";

  return (
    <section className="mt-lg rounded-card border border-border bg-surface px-lg py-md">
      <h2 className="text-h4">Comments from Viewers</h2>
      <p className="mt-xs text-body-sm text-muted">
        {viewer
          ? `Your comments go to Rupert and are shown to ${company} on this page, under your name. They don't confirm or change anything.`
          : "Left by the people you asked us to add as viewers. Rupert sees them too."}
      </p>
      {comments.length > 0 ? (
        <ol className="mt-md space-y-md">
          {comments.map((comment) => (
            <ViewerCommentItem key={comment.id} comment={comment} />
          ))}
        </ol>
      ) : null}
      {viewer ? <ViewerCommentForm step={step} /> : null}
    </section>
  );
}
