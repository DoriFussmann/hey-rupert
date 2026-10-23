"use client";

import { useState } from "react";
import { ReviewActions } from "@/components/setup/review-actions";
import { MATERIALS_FEEDBACK_NOTE_KEY, NOTE_MAX } from "@/lib/setup";

/**
 * Confirm or request changes on the narrative. When the version carries the
 * Company Materials Feedback, an optional comment on it travels with the
 * answer; it never blocks confirming.
 */
export function NarrativeReview({
  version,
  hasFeedback,
  readOnly,
}: {
  version: number;
  hasFeedback: boolean;
  readOnly: boolean;
}) {
  const [comment, setComment] = useState("");

  return (
    <>
      {hasFeedback ? (
        <section className="mt-lg rounded-card border border-border bg-surface px-lg py-md">
          <label
            htmlFor="feedback-comment"
            className="block text-label uppercase tracking-label text-muted"
          >
            Comments on the feedback (optional)
          </label>
          <p className="mt-xs text-body-sm text-muted">
            Anything you&apos;d like Rupert to know about his notes on your materials. Sent with your
            answer below.
          </p>
          <textarea
            id="feedback-comment"
            className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
            rows={3}
            maxLength={NOTE_MAX}
            value={comment}
            disabled={readOnly}
            onChange={(event) => setComment(event.target.value)}
            placeholder="e.g. We're updating the traction slide this week."
          />
        </section>
      ) : null}
      <ReviewActions
        step="framing"
        version={version}
        confirmLabel="Confirm narrative"
        itemNotes={hasFeedback ? { [MATERIALS_FEEDBACK_NOTE_KEY]: comment } : undefined}
        itemNotesLabel="on the feedback"
        intro="Confirm the narrative to move forward, or send Rupert your changes and questions."
        readOnly={readOnly}
      />
    </>
  );
}
