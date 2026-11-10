import assert from "node:assert/strict";
import { test } from "node:test";
import { feedbackPointCount, feedbackPointsText, type FeedbackPoint } from "./feedback-points.ts";

const LABELS = ["First email", "Follow-up"] as const;

test("points become one line each, the group's first, then by email", () => {
  const points: FeedbackPoint[] = [
    { id: "a", about: 1, text: "Drop the second fact" },
    { id: "b", about: 0, text: "Subject is too long" },
    { id: "c", about: "all", text: "Sign as Dana,\nnot D." },
    { id: "d", about: 0, text: "Soften the ARR claim" },
  ];
  assert.equal(
    feedbackPointsText(points, LABELS),
    [
      "- Both emails: Sign as Dana, not D.",
      "- First email: Subject is too long",
      "- First email: Soften the ARR claim",
      "- Follow-up: Drop the second fact",
    ].join("\n"),
  );
  assert.equal(feedbackPointCount(points), 4);
});

test("empty points are left out", () => {
  const points: FeedbackPoint[] = [
    { id: "a", about: 0, text: "  " },
    { id: "b", about: 1, text: "Shorter" },
  ];
  assert.equal(feedbackPointsText(points, LABELS), "- Follow-up: Shorter");
  assert.equal(feedbackPointCount(points), 1);
  assert.equal(feedbackPointsText([], LABELS), "");
});
