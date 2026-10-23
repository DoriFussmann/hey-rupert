"use client";

import { useState } from "react";
import { analyzeClientMaterials, buildClientNarrative } from "@/app/admin/agent-actions";
import { DocumentStep, sendStatus } from "@/app/admin/clients/[id]/setup/document-step";
import { FilesLinksEditor } from "@/app/admin/clients/[id]/setup/files-links-editor";
import { MarkdownField } from "@/app/admin/clients/[id]/setup/markdown-field";
import { MarkdownBody } from "@/components/markdown-body";
import {
  ClientAnswer,
  StepFrame,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { formatDateAtTime } from "@/lib/format";
import {
  asClientEmail,
  asNarrative,
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

/** The draft in its stored shape, to tell whether there are unsaved edits. */
function snapshot(narrative: unknown) {
  return JSON.stringify(asNarrative(narrative));
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
  const initial = asNarrative(row?.draft ?? row?.published);
  const initialEmail = asClientEmail(
    row?.draft && typeof row.draft === "object"
      ? (row.draft as Record<string, unknown>).client_email
      : null,
  );
  const [narrative, setNarrative] = useState<NarrativePayload>(initial);
  const [saved, setSaved] = useState(snapshot(initial));
  const [pending, setPending] = useState<null | "analyze" | "build">(null);
  const [message, setMessage] = useState<Message>(null);

  const changesRequested = row?.status === "changes_requested";
  const feedback = narrative.feedback;
  const hasFeedback = Boolean(feedback);
  const hasText = [narrative.core, narrative.key_messages, narrative.approach].some((value) =>
    value.trim(),
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

  /** What is now stored, after a server action replaced one part of the draft. */
  function markStored(patch: Partial<NarrativePayload>) {
    setSaved((current) => snapshot({ ...(JSON.parse(current) as NarrativePayload), ...patch }));
  }

  async function onAnalyze() {
    if (
      (feedback?.summary.trim() || feedback?.improvements.trim()) &&
      !window.confirm(
        "Run Analyze again? It replaces the Company Materials Feedback, including your edits. The narrative, files, links and the email are kept.",
      )
    ) {
      return;
    }
    setPending("analyze");
    setMessage(null);
    try {
      const result = await analyzeClientMaterials(clientId);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      // Unsaved narrative edits stay; only the feedback is replaced.
      update({ feedback: result.feedback });
      markStored({ feedback: result.feedback });
      setMessage({
        kind: "ok",
        text: hasText
          ? "Feedback ready and saved. Edit it; rebuild the narrative if it should change too."
          : "Feedback ready and saved. Edit it, then build the narrative.",
      });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "The analysis failed." });
    } finally {
      setPending(null);
    }
  }

  async function onBuild() {
    if (
      hasText &&
      !window.confirm(
        changesRequested
          ? "Rebuild the narrative with the client's requested changes? It replaces the current narrative. The feedback is kept."
          : "Build a new narrative? It replaces the current narrative. The feedback is kept.",
      )
    ) {
      return;
    }
    setPending("build");
    setMessage(null);
    try {
      const result = await buildClientNarrative(clientId);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      // Unsaved feedback edits stay; the narrative sections are replaced.
      setNarrative({ ...result.narrative, feedback: narrative.feedback });
      setSaved(snapshot(result.narrative));
      setMessage({
        kind: "ok",
        text: [
          "Narrative ready and saved as a draft. Edit it, then draft the email.",
          result.kept.length > 0
            ? `Claude did not rewrite ${result.kept.join(", ")}: kept from the version the client reviewed.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to build the narrative.",
      });
    } finally {
      setPending(null);
    }
  }

  const canAnalyze = materialsSubmitted && claudeReady && pending === null;
  const canBuild = (hasFeedback || legacyFeedback) && claudeReady && pending === null;

  return (
    <StepFrame
      item={item}
      action={
        <div className="flex flex-wrap gap-sm">
          <button
            type="button"
            className={hasFeedback ? secondaryButton : primaryButton}
            disabled={!canAnalyze}
            onClick={onAnalyze}
          >
            {pending === "analyze" ? "Analyzing…" : hasFeedback ? "Re-analyze" : "Analyze"}
          </button>
          <button
            type="button"
            className={hasFeedback && !hasText ? primaryButton : secondaryButton}
            disabled={!canBuild}
            onClick={onBuild}
          >
            {pending === "build"
              ? "Building…"
              : changesRequested
                ? "Rebuild with client's changes"
                : hasText
                  ? "Rebuild narrative"
                  : "Build narrative"}
          </button>
        </div>
      }
    >
      <p className="px-lg pt-md text-body-sm text-muted" aria-live="polite">
        {pending === "analyze"
          ? "Reading everything the client shared. This can take 1–3 minutes; keep this page open."
          : pending === "build"
            ? "Writing from the feedback and intake. Usually under a minute."
            : !claudeReady
              ? "Claude is not configured (ANTHROPIC_API_KEY)."
              : !materialsSubmitted && !hasFeedback
                ? "Analyze is available once the client's intake and materials are in."
                : !hasFeedback && !legacyFeedback
                  ? "Run Analyze first: the narrative is built from the feedback."
                  : changesRequested
                    ? "The client asked for changes. Rebuild, or edit and send again."
                    : feedback?.generated_at
                      ? `Last analyzed ${formatDateAtTime(feedback.generated_at)}.`
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
            <h4 className="text-body text-heading">Company Materials Feedback</h4>
            <p className="mt-xs text-body-sm text-muted">
              Sent with the narrative for the client to read. They can comment on it; there is
              nothing to confirm.
              {legacyFeedback && !hasFeedback
                ? " This client already received Analysis & Feedback as its own step; leave this empty to send the narrative alone."
                : ""}
            </p>
          </div>
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
          <div>
            <p className={labelClass}>What to improve in your materials</p>
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

        <div>
          <p className={labelClass}>Core story</p>
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
        pushSummary="Pushes the narrative (core story, key messages, approach, what happens next), the Company Materials Feedback, and the files and links above to the client's portal as a new version, and sends them this email. They confirm the narrative there or ask for changes, and can comment on the feedback."
      />
    </StepFrame>
  );
}
