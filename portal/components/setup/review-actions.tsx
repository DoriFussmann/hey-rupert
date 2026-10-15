"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { respondToSetupStep } from "@/app/portal/setup/actions";
import { NOTE_MAX } from "@/lib/setup";

const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

/**
 * Confirm / request changes for a review step. Item notes (per fund, per
 * tier) are owned by the page and passed in, so they travel with the answer.
 */
export function ReviewActions({
  step,
  version,
  itemNotes,
  confirmLabel,
  changesLabel = "Request changes",
  notePlaceholder = "Anything Rupert should know, change, or answer",
  intro,
  readOnly,
  stickyFooter = false,
}: {
  step: "framing" | "investor_list" | "email_copy";
  version: number;
  itemNotes?: Record<string, string>;
  confirmLabel: string;
  changesLabel?: string;
  notePlaceholder?: string;
  intro?: string;
  readOnly: boolean;
  /** Pins Confirm to the bottom of the viewport (long lists). */
  stickyFooter?: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<null | "confirmed" | "changes_requested">(null);
  const [error, setError] = useState<string | null>(null);

  const noteCount = Object.values(itemNotes ?? {}).filter((value) => value.trim()).length;

  async function respond(decision: "confirmed" | "changes_requested") {
    if (pending) return;
    if (decision === "changes_requested" && !note.trim() && noteCount === 0) {
      setError("Write what you'd like changed or asked first.");
      return;
    }
    setPending(decision);
    setError(null);
    try {
      const result = await respondToSetupStep({
        step,
        version,
        decision,
        note,
        itemNotes,
      });
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

  const section = (
    <section
      className={
        stickyFooter
          ? "fixed bottom-0 left-0 right-0 z-30 max-h-[45vh] overflow-y-auto border-t border-primary/30 bg-surface shadow-[0_-8px_24px_rgba(0,0,0,0.08)]"
          : "mt-lg rounded-card border border-primary/30 bg-surface"
      }
    >
      <div className="border-b border-border px-lg py-md">
        <p className="text-label uppercase tracking-label text-primary">Your turn</p>
        <p className="mt-xs text-body-sm text-muted">
          {stickyFooter ? `Fund notes: ${noteCount}. ` : ""}
          {intro ??
            "Confirm to move forward, or send Rupert your changes and questions."}
          {!stickyFooter && noteCount > 0
            ? ` Your ${noteCount} note${noteCount === 1 ? "" : "s"} on specific funds will be included.`
            : ""}
        </p>
      </div>
      <div className="px-lg py-md">
        <label className="block text-label uppercase tracking-label text-muted">
          Comment (optional — sent when you confirm)
          <textarea
            className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary"
            rows={stickyFooter ? 2 : 4}
            maxLength={NOTE_MAX}
            value={note}
            disabled={readOnly || pending !== null}
            onChange={(event) => setNote(event.target.value)}
            placeholder={notePlaceholder}
          />
        </label>
        <div className="mt-md flex flex-wrap items-center gap-sm">
          <button
            type="button"
            className={primaryButton}
            disabled={readOnly || pending !== null}
            onClick={() => respond("confirmed")}
          >
            {pending === "confirmed" ? "Confirming…" : confirmLabel}
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={readOnly || pending !== null}
            onClick={() => respond("changes_requested")}
          >
            {pending === "changes_requested" ? "Sending…" : changesLabel}
          </button>
          {readOnly ? (
            <p className="text-body-sm text-muted">Preview only: actions are disabled.</p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mt-sm text-body-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );

  if (!stickyFooter) return section;
  return (
    <>
      <div className="h-64" aria-hidden />
      {section}
    </>
  );
}
