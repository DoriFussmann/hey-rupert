"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { askSetupQuestion, respondToSetupStep } from "@/app/portal/setup/actions";
import { NOTE_MAX, QUESTION_MAX } from "@/lib/setup";

const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

type Mode = "question" | "changes";

const MODE_TEXT: Record<Mode, { title: string; detail: string; label: string; send: string }> = {
  question: {
    title: "Ask a Question",
    detail: "Rupert answers here and by email. You can still confirm meanwhile.",
    label: "Your question",
    send: "Send Question",
  },
  changes: {
    title: "Request Changes",
    detail: "Rupert updates it and sends you a new version to confirm.",
    label: "What should change",
    send: "Send Request",
  },
};

/**
 * Confirm, Ask a Question, or Request Changes on a review step. The bar stays
 * in view while the page scrolls. A question never changes the turn; a
 * change request waits for Rupert's next version. Item notes (per tier, or
 * on the narrative's feedback) are owned by the page and travel with the
 * answer.
 */
export function ReviewActions({
  step,
  version,
  itemNotes,
  confirmLabel,
  intro = "Confirm to move forward, ask Rupert a question, or request changes.",
  readOnly,
  itemNotesLabel = "on specific funds",
}: {
  step: "framing" | "investor_list" | "email_copy";
  version: number;
  itemNotes?: Record<string, string>;
  confirmLabel: string;
  intro?: string;
  readOnly: boolean;
  /** How the item notes are named in "Your 2 notes … will be included". */
  itemNotesLabel?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<null | "confirm" | Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const noteCount = Object.values(itemNotes ?? {}).filter((value) => value.trim()).length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (mode && !dialog.open) dialog.showModal();
    if (!mode && dialog.open) dialog.close();
  }, [mode]);

  function open(next: Mode) {
    setError(null);
    setSent(null);
    setText("");
    setMode(next);
  }

  async function confirm() {
    if (pending) return;
    setPending("confirm");
    setError(null);
    try {
      const result = await respondToSetupStep({ step, version, decision: "confirmed", note: "", itemNotes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  }

  async function send() {
    if (!mode || pending) return;
    if (!text.trim() && (mode === "question" || noteCount === 0)) {
      setError(mode === "question" ? "Write your question first." : "Write what should change first.");
      return;
    }
    setPending(mode);
    setError(null);
    try {
      const result =
        mode === "question"
          ? await askSetupQuestion({ step, version, question: text })
          : await respondToSetupStep({ step, version, decision: "changes_requested", note: text, itemNotes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (mode === "question") setSent("Question sent. Rupert will answer here and by email.");
      setMode(null);
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  }

  const current = mode ? MODE_TEXT[mode] : null;

  return (
    <>
      <section
        aria-label="Your answer"
        className="sticky bottom-md z-20 mt-lg rounded-card border border-primary/30 bg-surface px-lg py-md shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
      >
        <p className="text-body-sm text-muted">
          {intro}
          {noteCount > 0
            ? ` Your ${noteCount} note${noteCount === 1 ? "" : "s"} ${itemNotesLabel} will be included.`
            : ""}
        </p>
        <div className="mt-sm flex flex-wrap items-center gap-sm">
          <button type="button" className={primaryButton} disabled={readOnly || pending !== null} onClick={() => void confirm()}>
            {pending === "confirm" ? "Confirming…" : confirmLabel}
          </button>
          <button type="button" className={secondaryButton} disabled={readOnly || pending !== null} onClick={() => open("question")}>
            Ask a Question
          </button>
          <button type="button" className={secondaryButton} disabled={readOnly || pending !== null} onClick={() => open("changes")}>
            Request Changes
          </button>
          {readOnly ? <p className="text-body-sm text-muted">Preview only: actions are disabled.</p> : null}
        </div>
        {sent ? (
          <p role="status" className="mt-sm text-body-sm text-success">
            {sent}
          </p>
        ) : null}
        {error && !mode ? (
          <p role="alert" className="mt-sm text-body-sm text-error">
            {error}
          </p>
        ) : null}
      </section>

      <dialog
        ref={dialogRef}
        aria-labelledby="review-dialog-title"
        className="w-full max-w-lg rounded-card border border-border bg-surface p-0 backdrop:bg-heading/20"
        onClose={() => setMode(null)}
      >
        {current ? (
          <div className="px-lg py-lg">
            <h2 id="review-dialog-title" className="text-h3 text-heading">
              {current.title}
            </h2>
            <p className="mt-xs text-body-sm text-muted">{current.detail}</p>
            <label className="mt-md block text-label uppercase tracking-label text-muted">
              {current.label}
              <textarea
                className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary"
                rows={5}
                maxLength={mode === "question" ? QUESTION_MAX : NOTE_MAX}
                value={text}
                disabled={pending !== null}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            {error ? (
              <p role="alert" className="mt-sm text-body-sm text-error">
                {error}
              </p>
            ) : null}
            <div className="mt-md flex flex-wrap gap-sm">
              <button type="button" className={primaryButton} disabled={pending !== null} onClick={() => void send()}>
                {pending === mode ? "Sending…" : current.send}
              </button>
              <button type="button" className={secondaryButton} disabled={pending !== null} onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
