"use client";

import { useState } from "react";
import { analyzeClientMaterials } from "@/app/admin/agent-actions";
import { DocumentStep, sendStatus } from "@/app/admin/clients/[id]/setup/document-step";
import { FilesLinksEditor } from "@/app/admin/clients/[id]/setup/files-links-editor";
import { MarkdownField } from "@/app/admin/clients/[id]/setup/markdown-field";
import {
  ClientAnswer,
  StepFrame,
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { formatDateAtTime } from "@/lib/format";
import {
  asFeedback,
  asFeedbackPublished,
  feedbackChecks,
  feedbackProblem,
  isSharedWithClient,
  type FeedbackDraft,
  type MaterialsAnalysis,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

type Message = { kind: "ok" | "error"; text: string } | null;

const labelClass = "block text-label uppercase tracking-label text-muted";

const EMPTY_ANALYSIS: MaterialsAnalysis = {
  summary: "",
  framing: "",
  generated_at: "",
  read: [],
  skipped: [],
};

/** The document part of the draft: everything but the email. */
function documentOf(draft: FeedbackDraft) {
  return { analysis: draft.analysis, attachments: draft.attachments, links: draft.links };
}

export function FeedbackWorkspace({
  clientId,
  item,
  row,
  to,
  materialsSubmitted,
  claudeReady,
  fileLinks,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  /** The client's email address. */
  to: string;
  materialsSubmitted: boolean;
  claudeReady: boolean;
  /** Signed links for files already saved on the draft. */
  fileLinks: Record<string, string>;
}) {
  const initial = asFeedback(row?.draft);
  const [doc, setDoc] = useState(documentOf(initial));
  const [saved, setSaved] = useState(JSON.stringify(documentOf(initial)));
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const analysis = doc.analysis;
  const dirty = JSON.stringify(doc) !== saved;
  // Recommendations exist only on feedback sent before the summary and framing were the feedback.
  const published = isSharedWithClient(row) && row ? asFeedbackPublished(row.published) : null;
  const ticked = row && published ? feedbackChecks(row.client_checks, published.items).length : 0;

  function updateAnalysis(patch: Partial<MaterialsAnalysis>) {
    setDoc((current) => ({
      ...current,
      analysis: { ...(current.analysis ?? EMPTY_ANALYSIS), ...patch },
    }));
  }

  async function onAnalyze() {
    if (
      (analysis?.summary.trim() || analysis?.framing.trim()) &&
      !window.confirm(
        "Run the analysis again? It replaces the Company Summary and Investor Framing, including your edits. Files, links and the email are kept.",
      )
    ) {
      return;
    }
    setAnalyzing(true);
    setMessage(null);
    try {
      const result = await analyzeClientMaterials(clientId);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      const next = documentOf(result.draft);
      setDoc(next);
      setSaved(JSON.stringify(next));
      setMessage({
        kind: "ok",
        text: "Analysis ready and saved as a draft. Edit it, then draft the email.",
      });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "The analysis failed.",
      });
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <StepFrame
      item={item}
      action={
        <button
          type="button"
          className={analysis ? secondaryButton : primaryButton}
          disabled={analyzing || !materialsSubmitted || !claudeReady}
          onClick={onAnalyze}
        >
          {analyzing ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze"}
        </button>
      }
    >
      <p className="px-lg pt-md text-body-sm text-muted" aria-live="polite">
        {analyzing
          ? "Reading everything the client shared. This can take 1–3 minutes; keep this page open."
          : !materialsSubmitted
            ? "Analyze is available once the client submits their materials."
            : !claudeReady
              ? "Claude is not configured (ANTHROPIC_API_KEY)."
              : analysis?.generated_at
                ? `Last analyzed ${formatDateAtTime(analysis.generated_at)}.`
                : "Not analyzed yet."}{" "}
        {sendStatus(row)}
        {published && published.items.length > 0
          ? ` Earlier recommendations ticked by the client: ${ticked} of ${published.items.length}.`
          : ""}
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

      <div className="grid gap-lg px-lg py-md">
        <div>
          <p className={labelClass}>Company Summary</p>
          <div className="mt-sm">
            <MarkdownField
              label="Company Summary"
              value={analysis?.summary ?? ""}
              onChange={(value) => updateAnalysis({ summary: value })}
              height={320}
            />
          </div>
        </div>
        <div>
          <p className={labelClass}>Investor Framing</p>
          <div className="mt-sm">
            <MarkdownField
              label="Investor Framing"
              value={analysis?.framing ?? ""}
              onChange={(value) => updateAnalysis({ framing: value })}
              height={320}
            />
          </div>
        </div>
        {analysis && (analysis.read.length > 0 || analysis.skipped.length > 0) ? (
          <details className="text-body-sm">
            <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
              What the AI read ({analysis.read.length})
              {analysis.skipped.length > 0 ? ` · couldn't read ${analysis.skipped.length}` : ""}
            </summary>
            <ul className="mt-sm list-disc space-y-xs pl-md text-body">
              {analysis.read.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
            {analysis.skipped.length > 0 ? (
              <ul className="mt-sm list-disc space-y-xs pl-md text-warning">
                {analysis.skipped.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : null}
          </details>
        ) : null}
        <FilesLinksEditor
          clientId={clientId}
          attachments={doc.attachments}
          links={doc.links}
          fileLinks={fileLinks}
          disabled={analyzing}
          onChange={(patch) => setDoc((current) => ({ ...current, ...patch }))}
        />
      </div>

      <DocumentStep
        clientId={clientId}
        step="deck_review"
        item={item}
        row={row}
        to={to}
        draft={doc}
        initialEmail={initial.client_email}
        dirty={dirty}
        onSaved={() => setSaved(JSON.stringify(doc))}
        problem={feedbackProblem({ ...doc, client_email: initial.client_email })}
        busy={analyzing}
        pushSummary="Pushes the Company Summary, Investor Framing, files and links above to the client's portal as a new version, and sends them this email. They read it there and confirm."
      />
    </StepFrame>
  );
}
