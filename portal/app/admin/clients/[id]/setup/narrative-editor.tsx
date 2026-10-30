"use client";

import Link from "next/link";
import { useState } from "react";
import { saveNarrativeInternalUpdate } from "@/app/admin/setup-actions";
import { DocumentStep, sendStatus } from "@/app/admin/clients/[id]/setup/document-step";
import { FilesLinksEditor } from "@/app/admin/clients/[id]/setup/files-links-editor";
import { MarkdownBody } from "@/components/markdown-body";
import {
  ClientAnswer,
  ClientQuestions,
  StepFrame,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { formatDateAtTime } from "@/lib/format";
import {
  asClientEmail,
  asNarrative,
  internalNarrativeUpdate,
  narrativeHasEarlierDraft,
  narrativeProblem,
  type NarrativePayload,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

const labelClass = "block text-label uppercase tracking-label text-muted";


type Message = { kind: "ok" | "error"; text: string } | null;

/** The narrative as Rupert edits it: the client's questions live on the published version. */
function editable(value: unknown): NarrativePayload {
  return { ...asNarrative(value), questions: undefined };
}

/** The draft in its stored shape, to tell whether there are unsaved edits. */
function snapshot(narrative: unknown) {
  return JSON.stringify(editable(narrative));
}

/**
 * Rupert's one turn after the intake: Analyze writes the Company Materials
 * Feedback, Build narrative writes the narrative from it, and one push sends
 * both. The client confirms the narrative; the feedback is for them to read.
 */
export function NarrativeEditor({
  clientId,
  item,
  row,
  to,
  materialsSubmitted,
  legacyFeedback,
  claudeReady,
  fileLinks,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  /** The client's email address. */
  to: string;
  materialsSubmitted: boolean;
  /** The client received feedback as its own step earlier: the narrative can build from it. */
  legacyFeedback: boolean;
  claudeReady: boolean;
  /** Signed links for files already saved on the draft. */
  fileLinks: Record<string, string>;
}) {
  const initial = editable(row?.draft ?? row?.published);
  const initialEmail = asClientEmail(
    row?.draft && typeof row.draft === "object"
      ? (row.draft as Record<string, unknown>).client_email
      : null,
  );
  const [narrative, setNarrative] = useState<NarrativePayload>(initial);
  const [saved, setSaved] = useState(snapshot(initial));
  const [pending, setPending] = useState<null | "analyze" | "build" | "internal">(null);
  const [message, setMessage] = useState<Message>(null);
  const [internalAt, setInternalAt] = useState(internalNarrativeUpdate(row?.draft)?.at ?? null);

  const changesRequested = row?.status === "changes_requested";
  const confirmed = row?.status === "confirmed";
  const feedback = narrative.feedback;
  const hasText = [narrative.summary, narrative.core, narrative.key_messages, narrative.approach].some(
    (value) => value.trim(),
  );

  function update(patch: Partial<NarrativePayload>) {
    setNarrative((current) => ({ ...current, ...patch }));
  }



  async function onInternalUpdate() {
    if (
      !window.confirm(
        "Save this as an internal update? The email copy will be written from it. The client is not emailed and is not asked to confirm again; their page keeps the version they confirmed.",
      )
    ) {
      return;
    }
    setPending("internal");
    setMessage(null);
    try {
      const result = await saveNarrativeInternalUpdate(clientId, narrative);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setInternalAt(result.at);
      setSaved(snapshot(narrative));
      setMessage({ kind: "ok", text: "Internal update saved. The email copy will be written from it." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setPending(null);
    }
  }

  const finalized = Boolean(narrative.finalized_at);
  const feedbackReady = Boolean(feedback?.improvements.trim()) || legacyFeedback;
  // The narrative and the feedback are written and finalized in the Company Brief; this step sends them.
  const sendProblem = !finalized
    ? "Finalize the Outreach Narrative in the Company Brief (stage 2) first."
    : !feedbackReady
      ? "Confirm the Company Materials Feedback in the Company Brief (stage 3) first."
      : narrativeProblem(narrative);

  return (
    <StepFrame
      item={item}
      action={
        <Link href={`/admin/clients/${clientId}#setup-brief`} className={`${hasText ? secondaryButton : primaryButton} no-underline`}>
          {changesRequested ? "Rewrite in the Company Brief" : "Edit in the Company Brief"}
        </Link>
      }
    >
      <p className="px-lg pt-md text-body-sm text-muted" aria-live="polite">
        {!claudeReady
          ? "Claude is not configured (ANTHROPIC_API_KEY)."
          : !hasText
            ? materialsSubmitted || legacyFeedback
              ? "Stage 4 of the Company Brief: write and finalize the narrative and the feedback there, then draft the email and push here."
              : "The Company Brief opens once the client's intake is in."
            : changesRequested
              ? "The client asked for changes. Unlock the narrative in the Company Brief, Rewrite With Client's Changes, Finalize, then send again here."
              : sendProblem ?? "Ready: draft the email and push."}{" "}
        {sendStatus(row)}
      </p>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`px-lg pt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
        >
          {message.text}
        </p>
      ) : null}
      <ClientAnswer row={row} hideWaiting />
      <ClientQuestions clientId={clientId} step="framing" row={row} />
      {confirmed ? (
        <section className="mx-lg mt-md rounded-md border border-border bg-background px-md py-sm">
          <p className="text-body-sm text-secondary">
            The client confirmed this narrative. To use new facts without asking them again: update the
            Company Brief, Rewrite From Brief, edit, then Save as Internal Update. The email copy is
            written from it; the client&apos;s page keeps the version they confirmed.
            {internalAt ? ` Internal update saved ${formatDateAtTime(internalAt)}.` : ""}
          </p>
          <button
            type="button"
            className={`${secondaryButton} mt-sm`}
            disabled={pending !== null}
            onClick={() => void onInternalUpdate()}
          >
            {pending === "internal" ? "Saving…" : "Save as Internal Update"}
          </button>
        </section>
      ) : null}
      {changesRequested && narrative.change_summary ? (
        <section className="mx-lg mt-md rounded-md border border-primary/30 bg-primary-tint px-md py-sm">
          <p className={labelClass}>What Changed · only you see this</p>
          <MarkdownBody
            content={narrative.change_summary}
            emptyLabel=""
            className="sow-markdown mt-xs text-body-sm"
          />
          <p className="mt-xs text-body-sm text-muted">
            Draft Email uses this list. If you change more by hand, edit the email to match.
          </p>
        </section>
      ) : null}

      <div className="grid gap-lg px-lg py-md">
        {hasText ? (
          <section className="rounded-card border border-border bg-background px-md py-md">
            <p className={labelClass}>The Outreach Narrative · what the client reads and confirms</p>
            <MarkdownBody content={narrative.summary} emptyLabel="Not written yet." className="sow-markdown mt-xs text-body-sm" />
            <details className="mt-sm text-body-sm">
              <summary className="cursor-pointer text-label uppercase tracking-label text-muted">Core story, key messages and approach · stay with you</summary>
              <div className="mt-sm grid gap-md">
                <MarkdownBody content={narrative.core} emptyLabel="" className="sow-markdown" />
                <MarkdownBody content={narrative.key_messages} emptyLabel="" className="sow-markdown" />
                <MarkdownBody content={narrative.approach} emptyLabel="" className="sow-markdown" />
              </div>
            </details>
          </section>
        ) : null}

        {feedback?.improvements.trim() ? (
          <section className="rounded-card border border-border bg-background px-md py-md">
            <p className={labelClass}>Company Materials Feedback · for the client to read</p>
            <MarkdownBody content={feedback.improvements} emptyLabel="" className="sow-markdown mt-xs text-body-sm" />
          </section>
        ) : null}

        {narrative.founder_questions && narrative.founder_questions.length > 0 ? (
          <section className="rounded-card border border-border bg-background px-md py-md">
            <p className={labelClass}>Questions for the founder · answered on their page</p>
            <ul className="mt-sm list-disc space-y-xs pl-md text-body-sm">
              {narrative.founder_questions.map((item) => (
                <li key={item.id}>{item.question}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <div>
          <p className={labelClass}>What happens next</p>
          <p className="mb-sm mt-xs text-body-sm text-muted">
            Shown to the client above Confirm. Edit it for this client if you need to.
          </p>
          <textarea
            aria-label="What happens next"
            className={`${inputClass} min-h-[96px] resize-y`}
            value={narrative.next_steps}
            maxLength={2000}
            onChange={(event) => update({ next_steps: event.target.value })}
          />
        </div>
        {narrativeHasEarlierDraft(narrative) ? (
          <p className="text-body-sm text-muted">
            This narrative also carries email and LinkedIn copy from before Email Copy became its
            own step. It is read only; the client sees it as Earlier draft.
          </p>
        ) : null}
        <FilesLinksEditor
          clientId={clientId}
          attachments={narrative.attachments}
          links={narrative.links}
          fileLinks={fileLinks}
          disabled={pending !== null}
          onChange={(patch) => update(patch)}
        />
      </div>

      <DocumentStep
        clientId={clientId}
        step="framing"
        item={item}
        row={row}
        to={to}
        draft={narrative}
        initialEmail={initialEmail}
        dirty={snapshot(narrative) !== saved}
        onSaved={() => setSaved(snapshot(narrative))}
        problem={sendProblem}
        busy={pending !== null}
        pushSummary="Pushes The Outreach Narrative (and what happens next), the Company Materials Feedback, the questions for the founder, and the files and links above to the client's portal as a new version, and sends them this email. They confirm the narrative there, ask a question or ask for changes, and can comment on the feedback. The core story, key messages and approach stay with you; the emails are written from them."
      />
    </StepFrame>
  );
}
