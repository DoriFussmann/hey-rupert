"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeClientMaterials, createFeedbackUpload } from "@/app/admin/agent-actions";
import { saveSetupDraft } from "@/app/admin/setup-actions";
import { DocumentStep } from "@/app/admin/clients/[id]/setup/document-step";
import { MarkdownField } from "@/app/admin/clients/[id]/setup/markdown-field";
import {
  StepFrame,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { FeedbackView } from "@/components/setup/feedback-view";
import { formatDateAtTime } from "@/lib/format";
import { isHttpUrl } from "@/lib/material-fields";
import { createClient } from "@/lib/supabase/client";
import {
  FEEDBACK_AREAS,
  FEEDBACK_ITEMS_MAX,
  FEEDBACK_LINKS_MAX,
  FEEDBACK_PRIORITIES,
  MATERIALS_BUCKET,
  MATERIAL_EXTENSIONS,
  asFeedback,
  asFeedbackPublished,
  feedbackChecks,
  feedbackProblem,
  fileExtension,
  formatBytes,
  isSharedWithClient,
  type FeedbackDraft,
  type FeedbackItem,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

type Pending = null | "analyze" | "upload";
type Message = { kind: "ok" | "error"; text: string } | null;

const labelClass = "block text-label uppercase tracking-label text-muted";
const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const ACCEPT = MATERIAL_EXTENSIONS.map((extension) => `.${extension}`).join(",");

function newId(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export function FeedbackWorkspace({
  clientId,
  item,
  row,
  materialsSubmitted,
  claudeReady,
  attachmentLinks,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  materialsSubmitted: boolean;
  claudeReady: boolean;
  attachmentLinks: Record<string, string>;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const initial = asFeedback(row?.draft ?? row?.published);
  const [draft, setDraft] = useState<FeedbackDraft>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message>(null);

  const dirty = JSON.stringify(draft) !== saved;
  const shared = isSharedWithClient(row);
  // What the client would see if this draft were pushed now (links are
  // cleaned the same way on the server).
  const clientView = asFeedbackPublished({
    ...draft,
    intro: draft.intro.trim(),
    links: draft.links.filter((link) => isHttpUrl(link.url)),
  });
  const published = shared && row ? asFeedbackPublished(row.published) : null;
  const unpushed = Boolean(published) && JSON.stringify(clientView) !== JSON.stringify(published);
  // The client's own ticks on the feedback they received.
  const clientDone = row && published ? feedbackChecks(row.client_checks, published.items) : [];
  const clientDoneSet = new Set(clientDone);
  const busy = pending !== null;

  function update(patch: Partial<FeedbackDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateItem(id: string, patch: Partial<FeedbackItem>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }));
  }

  function moveItem(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.items.length) return current;
      const items = [...current.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...current, items };
    });
  }

  async function onAnalyze() {
    const hasWork = Boolean(draft.analysis) || draft.items.length > 0 || draft.intro.trim();
    if (
      hasWork &&
      !window.confirm(
        "Run the analysis again? It replaces the company summary, investor framing, opening message and recommendations (including your edits to them). Attachments and links are kept.",
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
      setDraft(result.draft);
      setSaved(JSON.stringify(result.draft));
      setMessage({
        kind: "ok",
        text: "Analysis ready and saved as a draft. The client sees nothing until you push it.",
      });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "The analysis failed.") });
    } finally {
      setPending(null);
    }
  }

  async function onUpload(file: File) {
    setPending("upload");
    setMessage(null);
    try {
      const ticket = await createFeedbackUpload(clientId, { name: file.name, size: file.size });
      if (!ticket.ok) {
        setMessage({ kind: "error", text: ticket.error });
        return;
      }
      const { error } = await createClient()
        .storage.from(MATERIALS_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: file.type || undefined,
        });
      if (error) {
        setMessage({ kind: "error", text: `Upload failed: ${error.message}` });
        return;
      }
      const next: FeedbackDraft = {
        ...draft,
        attachments: [
          ...draft.attachments,
          {
            path: ticket.path,
            name: file.name.slice(0, 255),
            size: file.size,
            type: file.type.slice(0, 120),
            uploaded_at: new Date().toISOString(),
          },
        ],
      };
      setDraft(next);
      const result = await saveSetupDraft(clientId, "deck_review", next);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setSaved(JSON.stringify(next));
      setMessage({ kind: "ok", text: "File attached and draft saved." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Upload failed.") });
    } finally {
      setPending(null);
    }
  }

  const analysis = draft.analysis;

  const editor = (
    <div className="grid gap-lg">
      <section className="rounded-card border border-border bg-surface px-md py-md">
        <h4 className="text-h4">Analysis</h4>
        <p className="mt-xs text-body-sm text-muted">
          Internal. Never shown to the client. Analyze reads the deck, files, answers, links and
          the intake.
        </p>
        <div className="mt-md grid gap-md">
          <div>
            <p className={labelClass}>Company summary</p>
            {analysis ? (
              <div className="mt-sm">
                <MarkdownField
                  label="Company summary"
                  value={analysis.summary}
                  onChange={(value) => update({ analysis: { ...analysis, summary: value } })}
                  height={280}
                />
              </div>
            ) : (
              <p className="mt-sm text-body-sm text-muted">Run Analyze to write this.</p>
            )}
          </div>
          <div>
            <p className={labelClass}>Investor framing</p>
            {analysis ? (
              <div className="mt-sm">
                <MarkdownField
                  label="Investor framing"
                  value={analysis.framing}
                  onChange={(value) => update({ analysis: { ...analysis, framing: value } })}
                  height={280}
                />
              </div>
            ) : (
              <p className="mt-sm text-body-sm text-muted">Run Analyze to write this.</p>
            )}
          </div>
        </div>
        {analysis && (analysis.read.length > 0 || analysis.skipped.length > 0) ? (
          <details className="mt-md text-body-sm">
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
      </section>

      <section>
        <h4 className="text-h4">Message on their feedback page</h4>
        <p className="mt-xs text-body-sm text-muted">
          Shown at the top, under From Rupert. The email is written separately, in Draft Email &
          Send.
        </p>
        <div className="mt-sm">
          <MarkdownField
            label="Message on the client's feedback page"
            value={draft.intro}
            height={220}
            onChange={(value) => update({ intro: value })}
          />
        </div>
      </section>

      <section>
        <h4 className="text-h4">Recommendations</h4>
        <p className="mt-xs text-body-sm text-muted">
          The client sees the ones marked visible. {clientView.items.length} visible.
        </p>
        {draft.items.length === 0 ? (
          <p className="mt-sm text-body-sm text-muted">None yet. Run Analyze, or add your own.</p>
        ) : (
          <ol className="mt-sm divide-y divide-border rounded-md border border-border">
            {draft.items.map((entry, index) => (
              <li
                key={entry.id}
                className={`grid gap-sm px-md py-md ${entry.visible ? "" : "bg-background"}`}
              >
                <div className="flex flex-wrap items-end gap-sm">
                  <span className="mb-xs w-6 font-mono text-mono text-muted">{index + 1}</span>
                  {clientDoneSet.has(entry.id) ? (
                    <span className="mb-xs rounded-full border border-success/40 px-sm py-px text-label uppercase tracking-label text-success">
                      Done by client
                    </span>
                  ) : null}
                  <label className={labelClass}>
                    Area
                    <select
                      className={`${inputClass} mt-xs normal-case tracking-normal`}
                      value={entry.area}
                      onChange={(event) =>
                        updateItem(entry.id, { area: event.target.value as FeedbackItem["area"] })
                      }
                    >
                      {FEEDBACK_AREAS.map((area) => (
                        <option key={area.value} value={area.value}>
                          {area.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    Priority
                    <select
                      className={`${inputClass} mt-xs normal-case tracking-normal`}
                      value={entry.priority}
                      onChange={(event) =>
                        updateItem(entry.id, {
                          priority: event.target.value as FeedbackItem["priority"],
                        })
                      }
                    >
                      {FEEDBACK_PRIORITIES.map((priority) => (
                        <option key={priority.value} value={priority.value}>
                          {priority.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={`${labelClass} w-24`}>
                    Slide
                    <input
                      className={`${inputClass} mt-xs normal-case tracking-normal`}
                      value={entry.slide}
                      maxLength={40}
                      onChange={(event) => updateItem(entry.id, { slide: event.target.value })}
                    />
                  </label>
                  <label className="mb-xs inline-flex items-center gap-xs text-body-sm text-secondary">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={entry.visible}
                      onChange={(event) => updateItem(entry.id, { visible: event.target.checked })}
                    />
                    Client sees this
                  </label>
                  <span className="ml-auto flex gap-xs">
                    <button
                      type="button"
                      className={smallButton}
                      onClick={() => moveItem(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move recommendation ${index + 1} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={smallButton}
                      onClick={() => moveItem(index, 1)}
                      disabled={index === draft.items.length - 1}
                      aria-label={`Move recommendation ${index + 1} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={smallButton}
                      onClick={() =>
                        update({ items: draft.items.filter((other) => other.id !== entry.id) })
                      }
                      aria-label={`Remove recommendation ${index + 1}`}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <input
                  className={inputClass}
                  value={entry.title}
                  maxLength={200}
                  placeholder="Short title"
                  aria-label={`Recommendation ${index + 1} title`}
                  onChange={(event) => updateItem(entry.id, { title: event.target.value })}
                />
                <textarea
                  className={`${inputClass} min-h-[72px] resize-y`}
                  value={entry.body}
                  maxLength={5000}
                  placeholder="What to change and why it matters to an investor"
                  aria-label={`Recommendation ${index + 1} detail`}
                  onChange={(event) => updateItem(entry.id, { body: event.target.value })}
                />
              </li>
            ))}
          </ol>
        )}
        <button
          type="button"
          className={`${smallButton} mt-sm`}
          disabled={draft.items.length >= FEEDBACK_ITEMS_MAX}
          onClick={() =>
            update({
              items: [
                ...draft.items,
                {
                  id: newId("f"),
                  area: "deck",
                  priority: "medium",
                  slide: "",
                  title: "",
                  body: "",
                  visible: true,
                },
              ],
            })
          }
        >
          Add recommendation
        </button>
      </section>

      <section>
        <h4 className="text-h4">Files & links for the client</h4>
        <ul className="mt-sm divide-y divide-border">
          {draft.attachments.map((file) => (
            <li key={file.path} className="flex flex-wrap items-center gap-md py-sm">
              <span className="rounded-md border border-border px-xs text-label uppercase tracking-label text-muted">
                {fileExtension(file.name) || "file"}
              </span>
              <span className="min-w-0 flex-1 truncate text-body-sm text-heading">
                {attachmentLinks[file.path] ? (
                  <a href={attachmentLinks[file.path]} className="text-heading hover:text-primary">
                    {file.name}
                  </a>
                ) : (
                  file.name
                )}
              </span>
              <span className="text-body-sm text-muted">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="text-body-sm text-muted hover:text-error"
                onClick={() =>
                  update({
                    attachments: draft.attachments.filter((other) => other.path !== file.path),
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
          {draft.links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center gap-sm py-sm">
              <input
                className={`${inputClass} sm:w-56`}
                value={link.label}
                maxLength={200}
                placeholder="Label (optional)"
                aria-label="Link label"
                onChange={(event) =>
                  update({
                    links: draft.links.map((other) =>
                      other.id === link.id ? { ...other, label: event.target.value } : other,
                    ),
                  })
                }
              />
              <input
                className={`${inputClass} min-w-0 flex-1`}
                value={link.url}
                maxLength={2000}
                type="url"
                placeholder="https://"
                aria-label="Link URL"
                aria-invalid={Boolean(link.url) && !isHttpUrl(link.url)}
                onChange={(event) =>
                  update({
                    links: draft.links.map((other) =>
                      other.id === link.id ? { ...other, url: event.target.value } : other,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="text-body-sm text-muted hover:text-error"
                onClick={() => update({ links: draft.links.filter((other) => other.id !== link.id) })}
              >
                Remove
              </button>
              {link.url && !isHttpUrl(link.url) ? (
                <p className="w-full text-body-sm text-error">
                  Use a full link starting with https://. Invalid links are not saved.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-sm flex flex-wrap gap-sm">
          <button
            type="button"
            className={smallButton}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {pending === "upload" ? "Uploading…" : "Attach file"}
          </button>
          <button
            type="button"
            className={smallButton}
            disabled={draft.links.length >= FEEDBACK_LINKS_MAX}
            onClick={() => update({ links: [...draft.links, { id: newId("l"), label: "", url: "" }] })}
          >
            Add link
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onUpload(file);
            }}
          />
        </div>
      </section>
    </div>
  );

  const preview = (
    <FeedbackView
      feedback={clientView}
      fileLinks={attachmentLinks}
      doneIds={clientDone}
      readOnly
      meta={
        published && !unpushed && row?.published_at
          ? `${row.version > 1 ? "Updated" : "Shared"} ${formatDateAtTime(row.published_at)}`
          : "Shared when you push"
      }
    />
  );

  return (
    <StepFrame
      item={item}
      intro="Analyze, edit the feedback beside the client's view, push it to their portal, then email them. The client confirms to pass the turn back."
      action={
        <button
          type="button"
          className={analysis ? secondaryButton : primaryButton}
          disabled={busy || !materialsSubmitted || !claudeReady}
          onClick={onAnalyze}
        >
          {pending === "analyze" ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze"}
        </button>
      }
    >
      <p className="px-lg pt-md text-body-sm text-muted" aria-live="polite">
        {pending === "analyze"
          ? "Reading everything the client shared. This can take 1–3 minutes; keep this page open."
          : !materialsSubmitted
            ? "Analyze is available once the client submits their materials."
            : !claudeReady
              ? "Claude is not configured (ANTHROPIC_API_KEY)."
              : analysis?.generated_at
                ? `Last analyzed ${formatDateAtTime(analysis.generated_at)}.`
                : "Not analyzed yet."}
        {published && published.items.length > 0
          ? ` Client progress: ${clientDone.length} of ${published.items.length} recommendation${
              published.items.length === 1 ? "" : "s"
            } ticked as done.`
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
      <div className="mt-md">
        <DocumentStep
          clientId={clientId}
          step="deck_review"
          item={item}
          row={row}
          documentLabel="Analysis & Feedback"
          draft={draft}
          hasContent={clientView.items.length > 0 || Boolean(clientView.intro)}
          unpushed={unpushed}
          dirty={dirty}
          onSaved={() => setSaved(JSON.stringify(draft))}
          problem={feedbackProblem(draft)}
          busy={busy}
          claudeReady={claudeReady}
          editor={editor}
          preview={preview}
        />
      </div>
    </StepFrame>
  );
}
