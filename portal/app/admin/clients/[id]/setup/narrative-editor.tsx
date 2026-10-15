"use client";

import { useState } from "react";
import { buildClientNarrative } from "@/app/admin/agent-actions";
import { MarkdownField } from "@/app/admin/clients/[id]/setup/markdown-field";
import {
  ClientAnswer,
  EarlierRounds,
  PublishBar,
  StepFrame,
  inputClass,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import {
  LINKEDIN_NOTE_MAX,
  asNarrative,
  narrativeProblem,
  type NarrativePayload,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

const labelClass = "block text-label uppercase tracking-label text-muted";
const LINKEDIN_FOLLOWUP_TARGET = 600;

function Counter({ length, max, hard }: { length: number; max: number; hard: boolean }) {
  const over = length > max;
  return (
    <span
      className={`font-mono text-mono normal-case tracking-normal ${
        over ? (hard ? "text-error" : "text-warning") : "text-muted"
      }`}
    >
      {length}/{max}
    </span>
  );
}

export function NarrativeEditor({
  clientId,
  item,
  row,
  hasAnalysis,
  claudeReady,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  hasAnalysis: boolean;
  claudeReady: boolean;
}) {
  const initial = asNarrative(row?.draft ?? row?.published);
  const [narrative, setNarrative] = useState<NarrativePayload>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const changesRequested = row?.status === "changes_requested";

  function update(patch: Partial<NarrativePayload>) {
    setNarrative((current) => ({ ...current, ...patch }));
  }

  async function onBuild() {
    // `admin_note` is optional (undefined), so only the text fields are checked.
    const hasText = [
      narrative.core,
      narrative.email_subject,
      narrative.email_body,
      narrative.linkedin_note,
      narrative.linkedin_followup,
    ].some((value) => value.trim());
    if (
      hasText &&
      !window.confirm(
        changesRequested
          ? "Rebuild the narrative with the client's requested changes? It replaces the current draft."
          : "Build a new narrative? It replaces the current draft.",
      )
    ) {
      return;
    }
    setBuilding(true);
    setMessage(null);
    try {
      const result = await buildClientNarrative(clientId);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setNarrative(result.narrative);
      setSaved(JSON.stringify(result.narrative));
      setMessage({ kind: "ok", text: "Narrative ready and saved as a draft." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to build the narrative.",
      });
    } finally {
      setBuilding(false);
    }
  }

  return (
    <StepFrame
      item={item}
      intro="The story the outreach is built on, the first cold email and the LinkedIn messages. The client confirms or asks for changes."
    >
      <ClientAnswer row={row} />
      {changesRequested ? (
        <p className="px-lg pt-md text-body-sm text-secondary">
          The narrative does not need to change. Write a reply below if you want, then push it.
          The client sees that reply above Confirm.
        </p>
      ) : null}
      <PublishBar
        clientId={clientId}
        step="framing"
        item={item}
        row={row}
        draft={narrative}
        dirty={JSON.stringify(narrative) !== saved}
        onSaved={() => setSaved(JSON.stringify(narrative))}
        pushLabel="Push narrative for confirmation"
        problem={narrativeProblem(narrative)}
        noteLabel="Reply (optional). Shown on their page, above Confirm, and in the email."
        notePlaceholder="For example: left the story, tightened the email."
        noteOnPage
      />
      <div className="flex flex-wrap items-center gap-sm px-lg pt-md">
        <button
          type="button"
          className={secondaryButton}
          disabled={building || !hasAnalysis || !claudeReady}
          onClick={onBuild}
        >
          {building
            ? "Building…"
            : changesRequested
              ? "Rebuild with client's changes"
              : narrative.core.trim()
                ? "Rebuild narrative"
                : "Build narrative"}
        </button>
        <p className="text-body-sm text-muted" aria-live="polite">
          {building
            ? "Writing from the analysis, feedback and intake. Usually under a minute."
            : !hasAnalysis
              ? "Run Analyze under Analysis & Feedback first."
              : !claudeReady
                ? "Claude is not configured (ANTHROPIC_API_KEY)."
                : "Uses the AI Agents → Outreach narrative instructions."}
        </p>
      </div>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`px-lg pt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="grid gap-lg px-lg py-md">
        <div>
          <p className={labelClass}>Core narrative</p>
          <div className="mt-sm">
            <MarkdownField
              label="Core narrative"
              value={narrative.core}
              onChange={(value) => update({ core: value })}
              height={360}
            />
          </div>
        </div>

        <div className="grid gap-sm">
          <p className={labelClass}>First cold email</p>
          <input
            className={inputClass}
            value={narrative.email_subject}
            maxLength={300}
            placeholder="Subject"
            aria-label="Email subject"
            onChange={(event) => update({ email_subject: event.target.value })}
          />
          <textarea
            className={`${inputClass} min-h-[200px] resize-y`}
            value={narrative.email_body}
            maxLength={10000}
            placeholder="Email body"
            aria-label="Email body"
            onChange={(event) => update({ email_body: event.target.value })}
          />
        </div>

        <label className={labelClass}>
          <span className="flex items-center justify-between gap-sm">
            LinkedIn connection note
            <Counter length={narrative.linkedin_note.length} max={LINKEDIN_NOTE_MAX} hard />
          </span>
          <textarea
            className={`${inputClass} mt-sm min-h-[88px] resize-y normal-case tracking-normal`}
            value={narrative.linkedin_note}
            maxLength={2000}
            onChange={(event) => update({ linkedin_note: event.target.value })}
          />
        </label>

        <label className={labelClass}>
          <span className="flex items-center justify-between gap-sm">
            LinkedIn message after they accept
            <Counter
              length={narrative.linkedin_followup.length}
              max={LINKEDIN_FOLLOWUP_TARGET}
              hard={false}
            />
          </span>
          <textarea
            className={`${inputClass} mt-sm min-h-[140px] resize-y normal-case tracking-normal`}
            value={narrative.linkedin_followup}
            maxLength={5000}
            onChange={(event) => update({ linkedin_followup: event.target.value })}
          />
        </label>
      </div>

      <EarlierRounds row={row} />
    </StepFrame>
  );
}
