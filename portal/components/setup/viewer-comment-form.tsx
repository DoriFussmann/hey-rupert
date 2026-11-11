"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addViewerComment } from "@/app/portal/setup/viewer-comment-actions";
import { VIEWER_COMMENT_MAX, type ViewerCommentStep } from "@/lib/viewer-comments";

/** The viewer's own box for a comment on this step. */
export function ViewerCommentForm({ step }: { step: ViewerCommentStep }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (sending || !text.trim()) return;
    setSending(true);
    setError(null);
    setSent(false);
    try {
      const result = await addViewerComment(step, text);
      if (result.ok) {
        setText("");
        setSent(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError("The comment could not be sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-md">
      <label htmlFor={`viewer-comment-${step}`} className="text-body-sm text-heading">
        Add a comment
      </label>
      <textarea
        id={`viewer-comment-${step}`}
        className="mt-xs w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
        rows={4}
        maxLength={VIEWER_COMMENT_MAX}
        value={text}
        disabled={sending}
        onChange={(event) => {
          setText(event.target.value);
          setSent(false);
        }}
      />
      <div className="mt-sm flex flex-wrap items-center gap-md">
        <button
          type="button"
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
          disabled={sending || !text.trim()}
          onClick={send}
        >
          {sending ? "Sending…" : "Send Comment"}
        </button>
        {sent ? <p className="text-body-sm text-success">Sent. It appears above under your name.</p> : null}
        {error ? (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
