"use client";

import { useState } from "react";
import { buildClientNarrative } from "@/app/admin/agent-actions";
import { MarkdownField } from "@/app/admin/clients/[id]/setup/markdown-field";
import {
  ClientAnswer,
  EarlierRounds,
  PublishBar,
  StepFrame,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import {
  asNarrative,
  narrativeHasEarlierDraft,
  narrativeProblem,
  type NarrativePayload,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

const labelClass = "block text-label uppercase tracking-label text-muted";

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
    const hasText = [narrative.core, narrative.key_messages, narrative.approach].some(
      (value) => value.trim(),
    );
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
      intro="The story, the messages Rupert will carry, and how he'll approach investors. The client confirms this before any email copy is written."
    >
      <ClientAnswer row={row} />
      {changesRequested ? (
        <p className="px-lg pt-md text-body-sm text-secondary">
          The narrative does not need to change. Write a reply when you push if you want.
          The client sees that reply above Confirm.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-sm border-b border-border px-lg py-md">
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
            className="min-h-[96px] w-full resize-y rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
            value={narrative.next_steps}
            maxLength={2000}
            onChange={(event) => update({ next_steps: event.target.value })}
          />
        </div>

        {narrativeHasEarlierDraft(narrative) ? (
          <div className="rounded-md border border-border bg-background px-md py-md">
            <p className={labelClass}>Earlier draft</p>
            <p className="mt-xs text-body-sm text-muted">
              Email and LinkedIn copy from before this step changed. Read only. It now lives in Email Copy.
            </p>
            {narrative.email_subject || narrative.email_body ? (
              <div className="mt-md">
                <p className="text-body-sm text-heading">First email</p>
                {narrative.email_subject ? (
                  <p className="mt-xs text-body-sm text-body">Subject: {narrative.email_subject}</p>
                ) : null}
                {narrative.email_body ? (
                  <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">
                    {narrative.email_body}
                  </p>
                ) : null}
              </div>
            ) : null}
            {narrative.linkedin_note ? (
              <div className="mt-md">
                <p className="text-body-sm text-heading">LinkedIn connection note</p>
                <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">
                  {narrative.linkedin_note}
                </p>
              </div>
            ) : null}
            {narrative.linkedin_followup ? (
              <div className="mt-md">
                <p className="text-body-sm text-heading">LinkedIn follow-up</p>
                <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">
                  {narrative.linkedin_followup}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <EarlierRounds row={row} />
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
        notePlaceholder="For example: tightened the key messages."
        noteOnPage
      />
    </StepFrame>
  );
}
