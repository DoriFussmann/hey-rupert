// Viewer comments: notes a view-only viewer leaves on a review step. The
// rules live here (no server code) so they can be tested and shared.

export const VIEWER_COMMENT_MAX = 2000;
/** The most comments one viewer can leave in a day. */
export const VIEWER_COMMENTS_PER_DAY = 30;

export const VIEWER_COMMENT_STEPS = ["framing", "investor_list", "email_copy"] as const;
export type ViewerCommentStep = (typeof VIEWER_COMMENT_STEPS)[number];

export const VIEWER_COMMENT_STEP_LABEL: Record<ViewerCommentStep, string> = {
  framing: "Outreach Narrative",
  investor_list: "Investor Matching",
  email_copy: "Email Copy",
};

export const VIEWER_COMMENT_STEP_PATH: Record<ViewerCommentStep, string> = {
  framing: "/portal/setup/framing",
  investor_list: "/portal/setup/investor-list",
  email_copy: "/portal/setup/email-copy",
};

export type ViewerComment = {
  id: string;
  step: ViewerCommentStep;
  version: number;
  viewerName: string;
  body: string;
  createdAt: string;
};

export function isViewerCommentStep(value: unknown): value is ViewerCommentStep {
  return (VIEWER_COMMENT_STEPS as readonly unknown[]).includes(value);
}

/** The comment as it is saved, or why it can't be. */
export function cleanViewerComment(
  value: unknown,
): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return { ok: false, error: "Write a comment first." };
  if (body.length > VIEWER_COMMENT_MAX) {
    return {
      ok: false,
      error: `That's ${body.length.toLocaleString("en-US")} characters. The limit is ${VIEWER_COMMENT_MAX.toLocaleString("en-US")}.`,
    };
  }
  return { ok: true, body };
}

/** "Prathna Ramesh", or "A viewer" when there is no name. */
export function viewerDisplayName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim() || "A viewer";
}
