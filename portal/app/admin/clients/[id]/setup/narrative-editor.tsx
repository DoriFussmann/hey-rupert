"use client";

import { useState } from "react";
import { buildClientNarrative } from "@/app/admin/agent-actions";
import { DocumentStep } from "@/app/admin/clients/[id]/setup/document-step";
import { MarkdownField } from "@/app/admin/clients/[id]/setup/markdown-field";
import {
  StepFrame,
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { NarrativeView } from "@/components/setup/narrative-view";
import {
  asNarrative,
  isSharedWithClient,
  narrativeHasEarlierDraft,
  narrativeProblem,
  type FeedbackItem,
  type NarrativePayload,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

const labelClass = "block text-label uppercase tracking-label text-muted";

/** The parts of the narrative the client reads (Rupert's reply aside). */
function readable(narrative: NarrativePayload) {
  return JSON.stringify([
    narrative.core,
    narrative.key_messages,
    narrative.approach,
    narrative.next_steps,
  ]);
}

export function NarrativeEditor({
  clientId,
  item,
  row,
  hasAnalysis,
  claudeReady,
  feedback,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  hasAnalysis: boolean;
  claudeReady: boolean;
  /** The feedback the client has, shown beside the narrative on their page. */
  feedback: { items: FeedbackItem[]; doneIds: string[] } | null;
}) {
  const initial = asNarrative(row?.draft ?? row?.published);
  const [narrative, setNarrative] = useState<NarrativePayload>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const changesRequested = row?.status === "changes_requested";
  const shared = isSharedWithClient(row);
  const unpushed = shared && readable(narrative) !== readable(asNarrative(row?.published));
  const hasText = [narrative.core, narrative.key_messages, narrative.approach].some((value) =>
    value.trim(),
  );

  function update(patch: Partial<NarrativePayload>) {
    setNarrative((current) => ({ ...current, ...patch }));
  }

  async function onBuild() {
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

  const editor = (
    <div className="grid gap-lg">
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
          className="min-h-[96px] w-full resize-y rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
          value={narrative.next_steps}
          maxLength={2000}
          onChange={(event) => update({ next_steps: event.target.value })}
        />
      </div>

      {narrativeHasEarlierDraft(narrative) ? (
        <p className="text-body-sm text-muted">
          This narrative also carries email and LinkedIn copy from before Email Copy became its own
          step. It is read only, and the client sees it as Earlier draft.
        </p>
      ) : null}
    </div>
  );

  return (
    <StepFrame
      item={item}
      intro="Build the story, the messages and the approach, edit them beside the client's view, push to their portal, then email them. You can push this before the client confirms the feedback."
      action={
        <button
          type="button"
          className={hasText ? secondaryButton : primaryButton}
          disabled={building || !hasAnalysis || !claudeReady}
          onClick={onBuild}
        >
          {building
            ? "Building…"
            : changesRequested
              ? "Rebuild with client's changes"
              : hasText
                ? "Rebuild narrative"
                : "Build narrative"}
        </button>
      }
    >
      <p className="px-lg pt-md text-body-sm text-muted" aria-live="polite">
        {building
          ? "Writing from the analysis, feedback and intake. Usually under a minute."
          : !hasAnalysis
            ? "Run Analyze under Analysis & Feedback first."
            : !claudeReady
              ? "Claude is not configured (ANTHROPIC_API_KEY)."
              : changesRequested
                ? "The client asked for changes. Rebuild, or edit and push with a reply."
                : "Uses the AI Agents → Outreach narrative instructions."}
      </p>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`px-lg pt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
        >
          {message.text}
        </p>
      ) : null}
      <div className="mt-md">
        <DocumentStep
          clientId={clientId}
          step="framing"
          item={item}
          row={row}
          documentLabel="Outreach Narrative"
          draft={narrative}
          hasContent={hasText}
          unpushed={unpushed}
          dirty={JSON.stringify(narrative) !== saved}
          onSaved={() => setSaved(JSON.stringify(narrative))}
          problem={narrativeProblem(narrative)}
          busy={building}
          claudeReady={claudeReady}
          replyEnabled
          editor={editor}
          preview={<NarrativeView narrative={narrative} feedback={feedback} stacked />}
        />
      </div>
    </StepFrame>
  );
}
