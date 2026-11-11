import { ViewerCommentItem } from "@/components/setup/viewer-comments";
import { VIEWER_COMMENT_STEP_LABEL, type ViewerComment, type ViewerCommentStep } from "@/lib/viewer-comments";

/**
 * What the client's viewers wrote on a step, above Rupert's panel for it.
 * Viewers can't confirm or change anything, so this is separate from the
 * client's own answer. The client sees the same comments in their portal.
 */
export function ViewerCommentsBlock({
  step,
  comments,
}: {
  step: ViewerCommentStep;
  comments: ViewerComment[];
}) {
  const mine = comments.filter((comment) => comment.step === step);
  if (mine.length === 0) return null;
  return (
    <section className="mt-lg rounded-card border border-warning/40 bg-surface px-lg py-md">
      <p className="text-label uppercase tracking-label text-warning">
        Viewer comments · {VIEWER_COMMENT_STEP_LABEL[step]} · {mine.length}
      </p>
      <p className="mt-xs text-body-sm text-muted">
        From a viewer, not the client. The client sees these in their portal too.
      </p>
      <ol className="mt-md space-y-md">
        {mine.map((comment) => (
          <ViewerCommentItem key={comment.id} comment={comment} />
        ))}
      </ol>
    </section>
  );
}
