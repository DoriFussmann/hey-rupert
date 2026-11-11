import assert from "node:assert/strict";
import test from "node:test";
import {
  VIEWER_COMMENT_MAX,
  cleanViewerComment,
  isViewerCommentStep,
  viewerDisplayName,
} from "./viewer-comments.ts";

test("a comment is trimmed and kept", () => {
  assert.deepEqual(cleanViewerComment("  Lead with the customers.\r\nThen the round.  "), {
    ok: true,
    body: "Lead with the customers.\nThen the round.",
  });
});

test("an empty comment is refused", () => {
  assert.equal(cleanViewerComment("   ").ok, false);
  assert.equal(cleanViewerComment(null).ok, false);
});

test("a comment over the limit is refused, at the limit it is kept", () => {
  assert.equal(cleanViewerComment("a".repeat(VIEWER_COMMENT_MAX)).ok, true);
  assert.equal(cleanViewerComment("a".repeat(VIEWER_COMMENT_MAX + 1)).ok, false);
});

test("only the three review steps take comments", () => {
  assert.equal(isViewerCommentStep("email_copy"), true);
  assert.equal(isViewerCommentStep("framing"), true);
  assert.equal(isViewerCommentStep("investor_list"), true);
  assert.equal(isViewerCommentStep("materials"), false);
  assert.equal(isViewerCommentStep(undefined), false);
});

test("a viewer without a name is still labelled", () => {
  assert.equal(viewerDisplayName("Prathna", "Ramesh"), "Prathna Ramesh");
  assert.equal(viewerDisplayName("", ""), "A viewer");
});
