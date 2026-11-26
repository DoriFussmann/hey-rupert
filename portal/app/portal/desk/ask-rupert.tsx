"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { askRupert, createDeskUpload } from "@/app/portal/desk/actions";
import { AttachmentsEditor } from "@/components/desk/attachments-editor";
import {
  ASK_LABEL,
  ASK_TYPES,
  BODY_MAX,
  DESK_STEPS,
  STEP_LABEL,
  deskItemPath,
  type AskType,
  type DeskAttachment,
  type DeskStep,
} from "@/lib/desk";

const input =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";
const label = "block text-label uppercase tracking-label text-muted";

const PLACEHOLDER: Record<AskType, string> = {
  question: "What would you like to know?",
  request: "What do you need from Rupert?",
  materials: "Anything Rupert should know about these files? (optional)",
};

/**
 * Ask Rupert: one form for a question, a request or files, about a step or
 * General. Greyed when the portal is view-only.
 */
export function AskRupert({ readOnly, defaultStep = "general" }: { readOnly: boolean; defaultStep?: DeskStep }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AskType>("question");
  const [step, setStep] = useState<DeskStep>(defaultStep);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<DeskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setPending(true);
    setError(null);
    try {
      const result = await askRupert({ type, step, body, attachments });
      if (!result.ok) return setError(result.error);
      router.push(deskItemPath(result.itemId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "It could not be sent. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={readOnly}
        title={readOnly ? "Disabled: this portal is view-only for you" : undefined}
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-lg py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
      >
        Ask Rupert
      </button>
    );
  }

  const ready = type === "materials" ? attachments.length > 0 : body.trim().length > 0;

  return (
    <section aria-label="Ask Rupert" className="mb-lg w-full rounded-card border border-border bg-surface px-lg py-md">
      <h2 className="text-h4 text-heading">Ask Rupert</h2>
      <p className="text-body-sm text-muted">It lands on your Desk with today&apos;s date, and Rupert answers there.</p>
      <div className="mt-md flex flex-wrap gap-sm" role="radiogroup" aria-label="What you're sending">
        {ASK_TYPES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={type === value}
            onClick={() => setType(value)}
            className={`rounded-full border px-md py-xs text-body-sm transition-colors duration-hover ${
              type === value ? "border-primary/30 bg-primary-tint text-primary" : "border-border text-secondary hover:text-heading"
            }`}
          >
            {ASK_LABEL[value]}
          </button>
        ))}
      </div>
      <label className={`${label} mt-md`}>
        What is it about
        <select className={`${input} mt-xs max-w-xs normal-case tracking-normal`} value={step} onChange={(event) => setStep(event.target.value as DeskStep)}>
          {DESK_STEPS.map((value) => (
            <option key={value} value={value}>
              {STEP_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <textarea
        className={`${input} mt-md min-h-[140px] resize-y`}
        value={body}
        maxLength={BODY_MAX}
        placeholder={PLACEHOLDER[type]}
        aria-label="Your message"
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="mt-sm">
        <AttachmentsEditor value={attachments} onChange={setAttachments} upload={createDeskUpload} disabled={pending} onBusy={setUploading} />
      </div>
      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button
          type="button"
          disabled={pending || uploading || !ready}
          onClick={() => void send()}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? "Sending…" : "Send to Rupert"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(false)}
          className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
    </section>
  );
}
