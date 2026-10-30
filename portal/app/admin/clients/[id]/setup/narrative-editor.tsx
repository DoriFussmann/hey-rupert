"use client";

import Link from "next/link";
import { useState } from "react";
import { writeNarrativeFromBriefAction } from "@/app/admin/brief-actions";
import { saveNarrativeInternalUpdate } from "@/app/admin/setup-actions";
import { DocumentStep, sendStatus } from "@/app/admin/clients/[id]/setup/document-step";
import { FilesLinksEditor } from "@/app/admin/clients/[id]/setup/files-links-editor";
import { MarkdownField } from "@/app/admin/clients/[id]/setup/markdown-field";
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
  type MaterialsFeedback,
  type NarrativePayload,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

const labelClass = "block text-label uppercase tracking-label text-muted";

const EMPTY_FEEDBACK: MaterialsFeedback = {
  summary: "",
  improvements: "",
  generated_at: "",
  read: [],
  skipped: [],
};

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
  const hasFeedback = Boolean(feedback);
  const hasText = [narrative.summary, narrative.core, narrative.key_messages, narrative.approach].some(
    (value) => value.trim(),
  );

  function update(patch: Partial<NarrativePayload>) {
    setNarrative((current) => ({ ...current, ...patch }));
  }

  function updateFeedback(patch: Partial<MaterialsFeedback>) {
    setNarrative((current) => ({
      ...current,
      feedback: { ...(current.feedback ?? EMPTY_FEEDBACK), ...patch },
    }));
  }

  async function onRebuild() {
    if (
      hasText &&
      !window.confirm(
        changesRequested
          ? "Rewrite the narrative from the brief with the client's requested changes? It replaces the current narrative."
          : "Rewrite the narrative from the brief? It replaces the current narrative, deck feedback and questions.",
      )
    ) {
      return;
    }
    setPending("build");
    setMessage(null);
    try {
      const result = await writeNarrativeFromBriefAction(
        clientId,
        (narrative.founder_questions ?? []).map((item) => item.question),
      );
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setNarrative(result.narrative);
      setSaved(snapshot(result.narrative));
      setMessage({ kind: "ok", text: "Narrative rewritten from the brief and saved as a draft. Edit it, then draft the email." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to write the narrative." });
    } finally {
      setPending(null);
    }
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

  const canBuild = claudeReady && pending === null;

  return (
    <StepFrame
      item={item}
      action={
        <div className="flex flex-wrap gap-sm">
          <Link
            href={`/admin/clients/${clientId}#setup-brief`}
            className={`${hasText ? secondaryButton : primaryButton} no-underline`}
          >
            Company Brief
          </Link>
          {hasText ? (
            <button type="button" className={changesRequested ? primaryButton : secondaryButton} disabled={!canBuild} onClick={() => void onRebuild()}>
              {pending === "build" ? "Writing…" : changesRequested ? "Rewrite With Client's Changes" : "Rewrite From Brief"}
            </button>
          ) : null}
        </div>
      }
    >
      <p className="px-lg pt-md text-body-sm text-muted" aria-live="polite">
        {pending === "build"
          ? "Writing from the brief. Usually under a minute."
          : !claudeReady
            ? "Claude is not configured (ANTHROPIC_API_KEY)."
            : !hasText
              ? materialsSubmitted || legacyFeedback
                ? "Start with the Company Brief above: build it, score the selling points, then write the narrative from it."
                : "The Company Brief opens once the client's intake is in."
              : changesRequested
                ? "The client asked for changes. Rewrite with their changes, or edit and send again."
                : ""}{" "}
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
        <section className="grid gap-lg rounded-card border border-border bg-background px-md py-md">
          <div>
            <h4 className="text-body text-heading">Deck feedback</h4>
            <p className="mt-xs text-body-sm text-muted">
              Sent with the narrative for the client to read: the three topics from the Company Brief.
              They can comment on it; there is nothing to confirm.
              {legacyFeedback && !hasFeedback
                ? " This client already received Analysis & Feedback as its own step; leave this empty to send the narrative alone."
                : ""}
            </p>
          </div>
          {feedback?.summary.trim() ? (
          <div>
            <p className={labelClass}>How Rupert reads the company</p>
            <div className="mt-sm">
              <MarkdownField
                label="How Rupert reads the company"
                value={feedback?.summary ?? ""}
                onChange={(value) => updateFeedback({ summary: value })}
                height={260}
              />
            </div>
          </div>
          ) : null}
          <div>
            <p className={labelClass}>What to improve in your deck</p>
            <div className="mt-sm">
              <MarkdownField
                label="What to improve in your materials"
                value={feedback?.improvements ?? ""}
                onChange={(value) => updateFeedback({ improvements: value })}
                height={260}
              />
            </div>
          </div>
          {feedback && (feedback.read.length > 0 || feedback.skipped.length > 0) ? (
            <details className="text-body-sm">
              <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
                What the AI read ({feedback.read.length})
                {feedback.skipped.length > 0 ? ` · couldn't read ${feedback.skipped.length}` : ""}
              </summary>
              <ul className="mt-sm list-disc space-y-xs pl-md text-body">
                {feedback.read.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
              {feedback.skipped.length > 0 ? (
                <ul className="mt-sm list-disc space-y-xs pl-md text-warning">
                  {feedback.skipped.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              ) : null}
            </details>
          ) : null}
        </section>

        {narrative.founder_questions && narrative.founder_questions.length > 0 ? (
          <section className="rounded-card border border-border bg-background px-md py-md">
            <h4 className="text-body text-heading">Questions for the founder</h4>
            <p className="mt-xs text-body-sm text-muted">
              Shown with the narrative; the founder answers on the page. Choose them in the Company Brief.
            </p>
            <ul className="mt-sm list-disc space-y-xs pl-md text-body-sm">
              {narrative.founder_questions.map((item) => (
                <li key={item.id}>{item.question}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <div>
          <p className={labelClass}>The Outreach Narrative · what the client reads and confirms</p>
          <p className="mb-sm mt-xs text-body-sm text-muted">
            150 to 250 words, light and clear, written from the Company Brief.
          </p>
          <MarkdownField
            label="The Outreach Narrative"
            value={narrative.summary}
            onChange={(value) => update({ summary: value })}
            height={280}
          />
        </div>
        <div>
          <p className={labelClass}>Core story · for Rupert and the emails</p>
          <div className="mt-sm">
            <MarkdownField
              label="Core story"
              value={narrative.core}
              onChange={(value) => update({ core: value })}
              height={320}
            />
          </div>
        </div>
        <div>
          <p className={labelClass}>Key messages</p>
          <p className="mb-sm mt-xs text-body-sm text-muted">
            3 to 6 messages Rupert will carry into outreach.
          </p>
          <MarkdownField
            label="Key messages"
            value={narrative.key_messages}
            onChange={(value) => update({ key_messages: value })}
            height={240}
          />
        </div>
        <div>
          <p className={labelClass}>Approach</p>
          <p className="mb-sm mt-xs text-body-sm text-muted">
            Positioning by investor type, tone, what leads, and what to hold back.
          </p>
          <MarkdownField
            label="Approach"
            value={narrative.approach}
            onChange={(value) => update({ approach: value })}
            height={240}
          />
        </div>
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
        problem={narrativeProblem(narrative)}
        busy={pending !== null}
        pushSummary="Pushes The Outreach Narrative (and what happens next), the deck feedback, the questions for the founder, and the files and links above to the client's portal as a new version, and sends them this email. They confirm the narrative there, ask a question or ask for changes, and can comment on the feedback. The core story, key messages and approach stay with you; the emails are written from them."
      />
    </StepFrame>
  );
}
