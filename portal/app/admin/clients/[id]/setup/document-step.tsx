"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  draftSetupEmailWithAi,
  prepareSetupEmail,
  pushSetupDocument,
  saveSetupDraft,
  sendSetupEmail,
} from "@/app/admin/setup-actions";
import {
  ADMIN_BLOCKED,
  ClientAnswer,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { formatDateAtTime } from "@/lib/format";
import {
  isSharedWithClient,
  type ClientEmailDraft,
  type SetupDocumentStep,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

type Pending = null | "save" | "push" | "prepare" | "ai" | "send";
type Message = { kind: "ok" | "error"; text: string } | null;
type Composer = ClientEmailDraft & { to: string; pausedNote: string | null };

const labelClass = "block text-label uppercase tracking-label text-muted";

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

/** Where the step stands, from Rupert's side, for the status row. */
function statusText(row: SetupStepState | null, hasContent: boolean, unpushed: boolean) {
  if (!isSharedWithClient(row)) return hasContent ? "Draft · not pushed" : "Not generated";
  const base =
    row!.status === "with_client"
      ? "With client · awaiting confirmation"
      : row!.status === "changes_requested"
        ? "Client asked for changes"
        : "Confirmed";
  return unpushed ? `${base} · edits not pushed` : base;
}

function answerText(row: SetupStepState, version: number) {
  const entry = row.history.find((item) => item.version === version);
  const response = entry?.response;
  if (response) {
    return `${response.decision === "confirmed" ? "Confirmed" : "Changes requested"} ${formatDateAtTime(response.at)}`;
  }
  if (version !== row.version) return "No answer";
  if (row.status === "published") return "Sent before confirming existed · counts as confirmed";
  return row.status === "with_client" ? "Waiting" : "—";
}

/**
 * The shared frame of the Analysis & Feedback and Outreach Narrative panels,
 * laid out like the SoW and NDA: a status row with Push to Client Portal and
 * Draft Email & Send, the editor beside a live client preview, the email
 * composer and the send log. The panel owns the draft and the editor.
 */
export function DocumentStep({
  clientId,
  step,
  item,
  row,
  documentLabel,
  draft,
  hasContent,
  unpushed,
  dirty,
  onSaved,
  problem,
  busy,
  claudeReady,
  replyEnabled = false,
  editor,
  preview,
}: {
  clientId: string;
  step: SetupDocumentStep;
  item: SetupItem;
  row: SetupStepState | null;
  documentLabel: string;
  draft: unknown;
  /** The draft has something in it (for "Draft" vs "Not generated"). */
  hasContent: boolean;
  /** What the client would see differs from what they have. */
  unpushed: boolean;
  dirty: boolean;
  onSaved: () => void;
  /** Why the draft cannot be pushed yet. */
  problem: string | null;
  /** The panel is busy (analyzing, uploading): actions wait. */
  busy: boolean;
  claudeReady: boolean;
  /** Narrative: Rupert's reply, shown on the client's page above Confirm. */
  replyEnabled?: boolean;
  editor: React.ReactNode;
  preview: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message>(null);
  const [reply, setReply] = useState("");
  const [composer, setComposer] = useState<Composer | null>(null);
  const [pane, setPane] = useState<"edit" | "preview">("edit");

  const shared = isSharedWithClient(row);
  const reachable = item.status !== "open";
  const locked = busy || pending !== null;
  const emailedAt = row?.history.find((entry) => entry.version === row.version)?.emailed_at ?? null;
  const pushLabel = shared && row ? `Push update (v${row.version + 1})` : "Push to Client Portal";

  async function onSave() {
    setPending("save");
    setMessage(null);
    try {
      const result = await saveSetupDraft(clientId, step, draft);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      onSaved();
      setMessage({ kind: "ok", text: "Draft saved. The client does not see drafts." });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to save.") });
    } finally {
      setPending(null);
    }
  }

  async function onPush() {
    if (problem) {
      setMessage({ kind: "error", text: problem });
      return;
    }
    const question =
      row?.status === "confirmed" || row?.status === "published"
        ? "The client already confirmed this. Pushing a new version asks them to confirm again. Continue?"
        : row?.status === "with_client"
          ? "The client has the current version. Replace it with this one?"
          : "Push to the client's portal? It becomes their turn to confirm. No email is sent until you use Draft Email & Send.";
    if (!window.confirm(question)) return;

    setPending("push");
    setMessage(null);
    try {
      const result = await pushSetupDocument(clientId, step, draft, replyEnabled ? reply : "");
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      onSaved();
      setReply("");
      setComposer(null);
      setMessage({
        kind: "ok",
        text: `Version ${result.version} is in the client's portal. No email was sent: use Draft Email & Send to tell them.`,
      });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to push.") });
    } finally {
      setPending(null);
    }
  }

  async function onPrepareEmail() {
    setPending("prepare");
    setMessage(null);
    try {
      const result = await prepareSetupEmail(clientId, step);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setComposer({ ...result.email, to: result.to, pausedNote: result.pausedNote });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to draft the email.") });
    } finally {
      setPending(null);
    }
  }

  async function onDraftWithAi() {
    if (!composer) return;
    if (!window.confirm("Replace the subject and email below with a new AI draft?")) return;
    setPending("ai");
    setMessage(null);
    try {
      const result = await draftSetupEmailWithAi(clientId, step);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setComposer({ ...result.email, to: result.to, pausedNote: result.pausedNote });
      setMessage({ kind: "ok", text: "Email drafted. Read it through and edit it before sending." });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to draft the email.") });
    } finally {
      setPending(null);
    }
  }

  async function onSendEmail() {
    if (!composer || !row) return;
    if (!window.confirm(`Send this email to ${composer.to}?`)) return;
    setPending("send");
    setMessage(null);
    try {
      const result = await sendSetupEmail(clientId, step, row.version, {
        subject: composer.subject,
        body: composer.body,
      });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setComposer(null);
      setMessage({ kind: "ok", text: `Email sent to ${composer.to}.` });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to send the email.") });
    } finally {
      setPending(null);
    }
  }

  const history = [...(row?.history ?? [])].sort((a, b) => b.version - a.version);
  const paneButton = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active
        ? "bg-primary text-white"
        : "border border-border bg-surface text-secondary hover:text-heading"
    }`;

  return (
    <>
      {/* Status row, as on the SoW and NDA */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="px-lg py-sm font-medium">Document</th>
              <th className="px-lg py-sm font-medium">Status</th>
              <th className="px-lg py-sm font-medium">Updated</th>
              <th className="px-lg py-sm font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-lg py-md text-heading">{documentLabel}</td>
              <td className="px-lg py-md">
                {statusText(row, hasContent, unpushed)}
                {shared && row ? (
                  <span className="block text-muted">
                    v{row.version} ·{" "}
                    {emailedAt ? `emailed ${formatDateAtTime(emailedAt)}` : "not emailed"}
                  </span>
                ) : null}
              </td>
              <td className="px-lg py-md text-muted">
                {row?.published_at ? formatDateAtTime(row.published_at) : "—"}
              </td>
              <td className="px-lg py-md">
                <div className="flex flex-wrap justify-end gap-sm">
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={locked || !reachable}
                    title={!reachable ? ADMIN_BLOCKED[step] : undefined}
                    onClick={onPush}
                  >
                    {pending === "push" ? "Pushing…" : pushLabel}
                  </button>
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={locked || !shared}
                    title={!shared ? "Push to the client portal first." : undefined}
                    onClick={onPrepareEmail}
                  >
                    {pending === "prepare"
                      ? "Drafting…"
                      : emailedAt
                        ? "Draft Email & Send again"
                        : "Draft Email & Send"}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {!reachable ? (
        <p className="px-lg pt-md text-body-sm text-muted">
          {ADMIN_BLOCKED[step]}. You can draft now.
        </p>
      ) : null}
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`px-lg pt-md text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
        >
          {message.text}
        </p>
      ) : null}

      <ClientAnswer row={row} />

      {replyEnabled ? (
        <div className="px-lg pt-md">
          <label className={labelClass}>
            Reply to the client (optional, sent with the next push)
            <input
              className={`${inputClass} mt-sm normal-case tracking-normal`}
              value={reply}
              maxLength={1000}
              onChange={(event) => setReply(event.target.value)}
              placeholder={
                row?.status === "changes_requested"
                  ? "For example: tightened the key messages."
                  : "Shown on their page, above Confirm"
              }
            />
          </label>
        </div>
      ) : null}

      {composer ? (
        <section className="mx-lg mt-md rounded-card border border-primary/30 bg-background px-md py-md">
          <div className="flex flex-wrap items-start justify-between gap-sm">
            <div>
              <h4 className="text-h4">Email to the client</h4>
              <p className="mt-xs text-body-sm text-muted">
                To {composer.to} · about version {row?.version}. Edit anything before it goes.
              </p>
            </div>
            {claudeReady ? (
              <button
                type="button"
                className={secondaryButton}
                disabled={locked}
                onClick={onDraftWithAi}
              >
                {pending === "ai" ? "Drafting…" : "Draft with AI"}
              </button>
            ) : null}
          </div>
          {composer.pausedNote ? (
            <p className="mt-sm text-body-sm text-warning">{composer.pausedNote}</p>
          ) : null}
          {unpushed ? (
            <p className="mt-sm text-body-sm text-warning">
              Your latest edits are not pushed. The client sees version {row?.version}.
            </p>
          ) : null}
          <label className={`${labelClass} mt-md`}>
            Subject
            <input
              className={`${inputClass} mt-sm normal-case tracking-normal`}
              value={composer.subject}
              maxLength={300}
              onChange={(event) => setComposer({ ...composer, subject: event.target.value })}
            />
          </label>
          <label className={`${labelClass} mt-md`}>
            Email
            <textarea
              className={`${inputClass} mt-sm min-h-[280px] resize-y normal-case tracking-normal`}
              value={composer.body}
              maxLength={10000}
              onChange={(event) => setComposer({ ...composer, body: event.target.value })}
            />
          </label>
          <div className="mt-md flex flex-wrap items-center gap-sm">
            <button
              type="button"
              className={primaryButton}
              disabled={locked || !composer.subject.trim() || !composer.body.trim()}
              onClick={onSendEmail}
            >
              {pending === "send" ? "Sending…" : "Send email"}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={pending === "send"}
              onClick={() => setComposer(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {/* Editor beside the live client preview */}
      <div className="mt-md border-t border-border px-lg py-md">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div className="flex gap-sm xl:hidden" role="group" aria-label="Show">
            <button
              type="button"
              className={paneButton(pane === "edit")}
              aria-pressed={pane === "edit"}
              onClick={() => setPane("edit")}
            >
              Edit
            </button>
            <button
              type="button"
              className={paneButton(pane === "preview")}
              aria-pressed={pane === "preview"}
              onClick={() => setPane("preview")}
            >
              Client preview
            </button>
          </div>
          <div className="ml-auto flex items-center gap-sm">
            {dirty ? <p className="text-body-sm text-warning">Unsaved changes</p> : null}
            <button type="button" className={secondaryButton} disabled={locked} onClick={onSave}>
              {pending === "save" ? "Saving…" : "Save draft"}
            </button>
          </div>
        </div>
        <div className="mt-md grid gap-lg xl:grid-cols-2 xl:items-start">
          <div className={`min-w-0 ${pane === "preview" ? "hidden xl:block" : ""}`}>{editor}</div>
          <div
            className={`min-w-0 xl:sticky xl:top-md xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto ${
              pane === "edit" ? "hidden xl:block" : ""
            }`}
          >
            <div className="rounded-card border border-dashed border-border bg-background px-md py-md">
              <p className="mb-md text-label uppercase tracking-label text-muted">
                Client view · live preview
              </p>
              {preview}
            </div>
          </div>
        </div>
      </div>

      {/* Send log */}
      <div className="border-t border-border px-lg py-md">
        <h4 className="text-h4">Send log</h4>
        <p className="mt-xs text-body-sm text-muted">
          One row per version pushed to the client.
        </p>
      </div>
      {history.length === 0 || !row ? (
        <p className="px-lg pb-lg text-body-sm text-muted">Nothing pushed yet.</p>
      ) : (
        <div className="overflow-x-auto pb-sm">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="border-t border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">Version</th>
                <th className="px-lg py-sm font-medium">Pushed</th>
                <th className="px-lg py-sm font-medium">Emailed</th>
                <th className="px-lg py-sm font-medium">Opened</th>
                <th className="px-lg py-sm font-medium">Client</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => {
                const current = entry.version === row.version;
                return (
                  <tr key={entry.version} className="border-t border-border align-top">
                    <td className="px-lg py-md text-heading">v{entry.version}</td>
                    <td className="px-lg py-md text-muted">
                      {entry.published_at ? formatDateAtTime(entry.published_at) : "—"}
                    </td>
                    <td className="px-lg py-md text-muted">
                      {entry.emailed_at ? formatDateAtTime(entry.emailed_at) : "—"}
                    </td>
                    <td className="px-lg py-md text-muted">
                      {current && row.client_viewed_at
                        ? formatDateAtTime(row.client_viewed_at)
                        : current
                          ? "Not yet"
                          : "—"}
                    </td>
                    <td className="px-lg py-md">
                      {answerText(row, entry.version)}
                      {entry.response?.note ? (
                        <span className="mt-xs block whitespace-pre-wrap text-muted line-clamp-3">
                          {entry.response.note}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
