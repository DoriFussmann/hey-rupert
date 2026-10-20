"use client";

import { useState } from "react";
import { buildClientNarrative } from "@/app/admin/agent-actions";
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
import {
  asClientEmail,
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
  to,
  hasAnalysis,
  claudeReady,
  fileLinks,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  /** The client's email address. */
  to: string;
  hasAnalysis: boolean;
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
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const changesRequested = row?.status === "changes_requested";
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
      setBuilding(false);
    }
  }

  return (
    <StepFrame
      item={item}
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
          ? "Writing from the analysis and intake. Usually under a minute."
          : !hasAnalysis
            ? "Run Analyze under Analysis & Feedback first."
            : !claudeReady
              ? "Claude is not configured (ANTHROPIC_API_KEY)."
              : changesRequested
                ? "The client asked for changes. Rebuild, or edit and send again."
                : "You can send this before the client confirms the feedback."}{" "}
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
          disabled={building}
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
        dirty={JSON.stringify(narrative) !== saved}
        onSaved={() => setSaved(JSON.stringify(narrative))}
        problem={narrativeProblem(narrative)}
        busy={building}
        pushSummary="Pushes the core story, key messages, approach, what happens next, files and links above to the client's portal as a new version, and sends them this email. They confirm there or ask for changes."
      />
    </StepFrame>
  );
}
