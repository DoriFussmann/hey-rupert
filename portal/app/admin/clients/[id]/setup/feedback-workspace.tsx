"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeClientMaterials,
  createFeedbackUpload,
  draftClientFeedbackEmail,
} from "@/app/admin/agent-actions";
import { publishSetupStep, saveSetupDraft } from "@/app/admin/setup-actions";
import { MarkdownField } from "@/app/admin/clients/[id]/setup/markdown-field";
import {
  StepFrame,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
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
  feedbackForClient,
  feedbackProblem,
  fileExtension,
  formatBytes,
  type FeedbackDraft,
  type FeedbackItem,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

type Pending = null | "analyze" | "email" | "save" | "send" | "upload";
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
  // The client's own ticks on the feedback they received.
  const published = row?.status === "published" ? asFeedbackPublished(row.published).items : [];
  const clientDone = new Set(row ? feedbackChecks(row.client_checks, published) : []);
  const visibleCount = feedbackForClient(draft).items.length;
  const sent = Boolean(row && row.version > 0);
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

  async function persist(next: FeedbackDraft, okText: string) {
    const result = await saveSetupDraft(clientId, "deck_review", next);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return false;
    }
    setSaved(JSON.stringify(next));
    setMessage({ kind: "ok", text: okText });
    return true;
  }

  async function onAnalyze() {
    const hasWork = Boolean(draft.analysis) || draft.items.length > 0 || draft.intro.trim();
    if (
      hasWork &&
      !window.confirm(
        "Run the analysis again? It replaces the company summary, investor framing, opening message and recommendations (including your edits to them). Attachments, links and the email draft are kept.",
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
      setMessage({ kind: "ok", text: "Analysis ready and saved as a draft. The client sees nothing until you send it." });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "The analysis failed.") });
    } finally {
      setPending(null);
    }
  }

  async function onDraftEmail() {
    const currentMessage = draft.email.body.trim() || draft.intro.trim();
    if (
      currentMessage &&
      !window.confirm("Replace the current message with a new draft?")
    ) {
      return;
    }
    setPending("email");
    setMessage(null);
    try {
      const result = await draftClientFeedbackEmail(clientId, draft);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setDraft((current) => ({
        ...current,
        intro: result.email.body,
        email: result.email,
      }));
      setMessage({ kind: "ok", text: "Message drafted. Edit it, then save or send." });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to draft the email.") });
    } finally {
      setPending(null);
    }
  }

  async function onSave() {
    setPending("save");
    setMessage(null);
    try {
      await persist(draft, "Draft saved. The client does not see drafts.");
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to save.") });
    } finally {
      setPending(null);
    }
  }

  async function onSend() {
    const problem = feedbackProblem(draft);
    if (problem) {
      setMessage({ kind: "error", text: problem });
      return;
    }
    const question = [
      sent
        ? "Replace the feedback the client has with this version and email them?"
        : "Send the feedback to the client's portal and email them?",
      (draft.email.body.trim() || draft.intro.trim())
        ? ""
        : "No message is written: the default text from Forms → Emails → Feedback ready is used.",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!window.confirm(question)) return;

    setPending("send");
    setMessage(null);
    try {
      const result = await publishSetupStep(clientId, "deck_review", draft, "");
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setSaved(JSON.stringify(draft));
      setMessage(
        result.clientEmail.ok
          ? { kind: "ok", text: "Sent to the portal, and the client was emailed." }
          : {
              kind: "error",
              text: `Sent to the portal, but the client was not emailed. ${result.clientEmail.reason}`,
            },
      );
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to send.") });
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
      if (await persist(next, "File attached and draft saved.")) router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Upload failed.") });
    } finally {
      setPending(null);
    }
  }

  const analysis = draft.analysis;
  const clientMessage = draft.email.body.trim() ? draft.email.body : draft.intro;

  return (
    <StepFrame
      item={item}
      intro="Work top to bottom. The client sees the recommendations you leave visible, the files and links, and the message."
    >
      <section className="border-b border-border px-lg py-md">
        <h3 className="text-h4">Analysis</h3>
        <p className="mt-xs max-w-prose text-body-sm text-muted">
          Internal. Never shown to the client. Analyze reads the deck, files, answers, links and the intake.
        </p>
        <div className="mt-md flex flex-wrap items-center gap-sm">
        <button
          type="button"
          className={analysis ? secondaryButton : primaryButton}
          disabled={busy || !materialsSubmitted || !claudeReady}
          onClick={onAnalyze}
        >
          {pending === "analyze" ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze"}
        </button>
        <p className="text-body-sm text-muted" aria-live="polite">
          {pending === "analyze"
            ? "Reading everything the client shared. This can take 1–3 minutes; keep this page open."
            : !materialsSubmitted
              ? "Available once the client submits their materials."
              : !claudeReady
                ? "Claude is not configured (ANTHROPIC_API_KEY)."
                : analysis?.generated_at
                  ? `Last analyzed ${formatDateAtTime(analysis.generated_at)}.`
                  : "Not analyzed yet."}
        </p>
        </div>
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
      {published.length > 0 ? (
        <p className="border-b border-border px-lg py-sm text-body-sm text-secondary">
          Client progress: {clientDone.size} of {published.length} recommendation
          {published.length === 1 ? "" : "s"} ticked as done.
        </p>
      ) : null}

      <div className="grid gap-lg border-b border-border px-lg py-md">
          <div>
            <h3 className="text-h4">Recommendations</h3>
            <p className="mt-xs text-body-sm text-muted">
              The client sees the ones marked visible. {visibleCount} visible.
            </p>
            {draft.items.length === 0 ? (
              <p className="mt-sm text-body-sm text-muted">
                None yet. Run Analyze, or add your own.
              </p>
            ) : (
              <ol className="mt-sm divide-y divide-border rounded-md border border-border">
                {draft.items.map((entry, index) => (
                  <li
                    key={entry.id}
                    className={`grid gap-sm px-md py-md ${entry.visible ? "" : "bg-background"}`}
                  >
                    <div className="flex flex-wrap items-end gap-sm">
                      <span className="mb-xs w-6 font-mono text-mono text-muted">{index + 1}</span>
                      {clientDone.has(entry.id) ? (
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
                            updateItem(entry.id, {
                              area: event.target.value as FeedbackItem["area"],
                            })
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
                          onChange={(event) =>
                            updateItem(entry.id, { visible: event.target.checked })
                          }
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
          </div>

          {/* Attachments and links */}
          <div>
            <h3 className="text-h4">Files & links for the client</h3>
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
                    onClick={() =>
                      update({ links: draft.links.filter((other) => other.id !== link.id) })
                    }
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
                onClick={() =>
                  update({ links: [...draft.links, { id: newId("l"), label: "", url: "" }] })
                }
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
          </div>
        </div>

      <section className="border-b border-border px-lg py-md">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div>
            <h3 className="text-h4">Message to the client</h3>
            <p className="mt-xs max-w-prose text-body-sm text-muted">
              This is the email and the intro at the top of their feedback page.
              The greeting, portal link and signature are added from Forms → Emails.
            </p>
          </div>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy || !claudeReady}
            onClick={onDraftEmail}
          >
            {pending === "email" ? "Drafting…" : "Draft with AI"}
          </button>
        </div>
        <label className={`${labelClass} mt-md`}>
          Subject
          <input
            className={`${inputClass} mt-sm normal-case tracking-normal`}
            value={draft.email.subject}
            maxLength={300}
            placeholder="Leave empty to use the subject from Forms → Emails"
            onChange={(event) => update({ email: { ...draft.email, subject: event.target.value } })}
          />
        </label>
        <div className="mt-md">
          <p className={labelClass}>Message</p>
          <div className="mt-sm">
            <MarkdownField
              label="Message to the client"
              value={clientMessage}
              height={220}
              onChange={(value) =>
                update({ intro: value, email: { ...draft.email, body: value } })
              }
            />
          </div>
        </div>
      </section>

      <section className="px-lg py-md">
        <h3 className="text-h4">Send to client</h3>
        {sent && row ? (
          <p className="mb-sm text-body-sm text-muted">
            Version {row.version} sent {row.published_at ? formatDateAtTime(row.published_at) : ""}
            {" · "}
            {row.client_viewed_at
              ? `opened by the client ${formatDateAtTime(row.client_viewed_at)}`
              : "not opened yet"}
            .
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            className={primaryButton}
            disabled={busy || !materialsSubmitted}
            onClick={onSend}
          >
            {pending === "send"
              ? "Sending…"
              : sent && row
                ? `Send update to client (v${row.version + 1})`
                : "Send to client"}
          </button>
          <button type="button" className={secondaryButton} disabled={busy} onClick={onSave}>
            {pending === "save" ? "Saving…" : "Save draft"}
          </button>
          {dirty ? <p className="text-body-sm text-warning">Unsaved changes</p> : null}
        </div>
        {message ? (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
          >
            {message.text}
          </p>
        ) : null}
      </section>
    </StepFrame>
  );
}
