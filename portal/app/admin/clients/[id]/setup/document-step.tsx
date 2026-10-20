"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  draftSetupEmail,
  saveSetupDraft,
  sendSetupDocument,
} from "@/app/admin/setup-actions";
import {
  ADMIN_BLOCKED,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { formatDateAtTime } from "@/lib/format";
import {
  EMAIL_BODY_MAX,
  EMAIL_SUBJECT_MAX,
  clientEmailProblem,
  isSharedWithClient,
  type ClientEmailDraft,
  type SetupDocumentStep,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

type Pending = null | "save" | "draft" | "send";
type Message = { kind: "ok" | "error"; text: string } | null;

const labelClass = "block text-label uppercase tracking-label text-muted";

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

/** One line on where the step stands, for under the panel title. */
export function sendStatus(row: SetupStepState | null) {
  if (!row || !isSharedWithClient(row)) return "Not sent yet.";
  const entry = row.history.find((item) => item.version === row.version);
  const parts = [
    `Version ${row.version} sent${row.published_at ? ` ${formatDateAtTime(row.published_at)}` : ""}`,
    entry?.emailed_at ? "emailed" : "not emailed",
    row.client_viewed_at ? `opened ${formatDateAtTime(row.client_viewed_at)}` : "not opened yet",
    row.status === "with_client"
      ? "waiting for the client to confirm"
      : row.status === "changes_requested"
        ? "the client asked for changes"
        : "confirmed",
  ];
  return `${parts.join(" · ")}.`;
}

function answerText(row: SetupStepState, version: number) {
  const response = row.history.find((item) => item.version === version)?.response;
  if (response) {
    return `${response.decision === "confirmed" ? "Confirmed" : "Changes requested"} ${formatDateAtTime(response.at)}`;
  }
  if (version !== row.version) return "No answer";
  if (row.status === "published") return "Sent before confirming existed · counts as confirmed";
  return row.status === "with_client" ? "Waiting" : "—";
}

/**
 * The bottom of the Analysis & Feedback, Outreach Narrative and Investor
 * Matching panels: the email (drafted by AI, editable), Save draft, Push to
 * Client Portal & Send, an optional preview, and the send log. The panel owns
 * the document; the email is saved with it.
 */
export function DocumentStep({
  clientId,
  step,
  item,
  row,
  to,
  draft,
  initialEmail,
  dirty,
  onSaved,
  problem,
  busy,
  pushSummary,
  clientPreview,
}: {
  clientId: string;
  step: SetupDocumentStep;
  item: SetupItem;
  row: SetupStepState | null;
  /** The client's email address. */
  to: string;
  /** The document as edited (without the email). */
  draft: object;
  initialEmail: ClientEmailDraft;
  /** The document has unsaved edits. */
  dirty: boolean;
  onSaved: () => void;
  /** Why the document cannot be sent yet. */
  problem: string | null;
  /** The panel is busy (analyzing, building): actions wait. */
  busy: boolean;
  /** What Push to Client Portal & Send puts in the portal. */
  pushSummary: string;
  /** The client's page as it will look after the push. Adds Preview as client. */
  clientPreview?: React.ReactNode;
}) {
  const router = useRouter();
  const [email, setEmail] = useState<ClientEmailDraft>(initialEmail);
  const [savedEmail, setSavedEmail] = useState(JSON.stringify(initialEmail));
  const [pausedNote, setPausedNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message>(null);
  const [previewing, setPreviewing] = useState(false);

  const reachable = item.status !== "open";
  const locked = busy || pending !== null;
  const unsaved = dirty || JSON.stringify(email) !== savedEmail;
  const nextVersion = (row?.version ?? 0) + 1;
  const fullDraft = { ...draft, client_email: email };

  function markSaved() {
    onSaved();
    setSavedEmail(JSON.stringify(email));
  }

  async function onSave() {
    setPending("save");
    setMessage(null);
    try {
      const result = await saveSetupDraft(clientId, step, fullDraft);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      markSaved();
      setMessage({ kind: "ok", text: "Draft saved. The client sees nothing until you send." });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to save.") });
    } finally {
      setPending(null);
    }
  }

  async function onDraftEmail() {
    if (
      (email.subject.trim() || email.body.trim()) &&
      !window.confirm("Replace the subject and email with a new draft?")
    ) {
      return;
    }
    setPending("draft");
    setMessage(null);
    try {
      const result = await draftSetupEmail(clientId, step, fullDraft);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setEmail(result.email);
      setPausedNote(result.pausedNote);
      setMessage({ kind: "ok", text: "Email drafted. Read it through, edit it, then save or send." });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to draft the email.") });
    } finally {
      setPending(null);
    }
  }

  async function onSend() {
    const blocker = problem ?? clientEmailProblem(email);
    if (blocker) {
      setMessage({ kind: "error", text: blocker });
      return;
    }
    const question = [
      `Push version ${nextVersion} to the client's portal and email ${to || "the client"}?`,
      row?.status === "confirmed" || row?.status === "published"
        ? "They already confirmed the current version: they will be asked to confirm again."
        : row?.status === "with_client"
          ? "This replaces the version they have now."
          : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!window.confirm(question)) return;

    setPending("send");
    setMessage(null);
    try {
      const result = await sendSetupDocument(clientId, step, fullDraft);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      markSaved();
      setMessage(
        result.clientEmail.ok
          ? { kind: "ok", text: `Version ${result.version} is in the client's portal, and the email was sent.` }
          : {
              kind: "error",
              text: `Version ${result.version} is in the client's portal, but the email was not sent: ${result.clientEmail.reason}`,
            },
      );
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to send.") });
    } finally {
      setPending(null);
    }
  }

  const history = [...(row?.history ?? [])].sort((a, b) => b.version - a.version);

  return (
    <>
      <section className="border-t border-border px-lg py-md">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div>
            <h4 className="text-h4">Email to the client</h4>
            <p className="mt-xs text-body-sm text-muted">
              {to ? `To ${to}. ` : ""}Goes out when you push. Edit anything before it goes.
            </p>
          </div>
          <button type="button" className={secondaryButton} disabled={locked} onClick={onDraftEmail}>
            {pending === "draft" ? "Drafting…" : "Draft Email"}
          </button>
        </div>
        {pausedNote ? <p className="mt-sm text-body-sm text-warning">{pausedNote}</p> : null}
        <label className={`${labelClass} mt-md`}>
          Subject
          <input
            className={`${inputClass} mt-sm normal-case tracking-normal`}
            value={email.subject}
            maxLength={EMAIL_SUBJECT_MAX}
            onChange={(event) => setEmail({ ...email, subject: event.target.value })}
          />
        </label>
        <label className={`${labelClass} mt-md`}>
          Email
          <textarea
            className={`${inputClass} mt-sm min-h-[260px] resize-y normal-case tracking-normal`}
            value={email.body}
            maxLength={EMAIL_BODY_MAX}
            placeholder="Click Draft Email to write it from everything above and the company information."
            onChange={(event) => setEmail({ ...email, body: event.target.value })}
          />
        </label>
      </section>

      <section className="border-t border-border bg-background px-lg py-md">
        <p className="max-w-prose text-body-sm text-secondary">{pushSummary}</p>
        <div className="mt-md flex flex-wrap items-center gap-sm">
          <button
            type="button"
            className={primaryButton}
            disabled={locked || !reachable}
            title={!reachable ? ADMIN_BLOCKED[step] : undefined}
            onClick={onSend}
          >
            {pending === "send"
              ? "Sending…"
              : nextVersion > 1
                ? `Push to Client Portal & Send (v${nextVersion})`
                : "Push to Client Portal & Send"}
          </button>
          <button type="button" className={secondaryButton} disabled={locked} onClick={onSave}>
            {pending === "save" ? "Saving…" : "Save draft"}
          </button>
          {clientPreview ? (
            <button
              type="button"
              className={secondaryButton}
              aria-expanded={previewing}
              aria-controls={`${step}-client-preview`}
              onClick={() => setPreviewing((current) => !current)}
            >
              {previewing ? "Close preview" : "Preview as client"}
            </button>
          ) : null}
          {unsaved ? <p className="text-body-sm text-warning">Unsaved changes</p> : null}
        </div>
        {!reachable ? (
          <p className="mt-sm text-body-sm text-muted">{ADMIN_BLOCKED[step]}. You can draft now.</p>
        ) : null}
        {message ? (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
          >
            {message.text}
          </p>
        ) : null}
      </section>

      {clientPreview && previewing ? (
        <section
          id={`${step}-client-preview`}
          aria-label="Preview as client"
          className="border-t border-border bg-background px-lg py-md"
        >
          <p className={labelClass}>Preview · nothing is saved or sent</p>
          <div className="mt-md rounded-card border border-border bg-surface px-lg py-md">
            <p className="text-body-sm text-muted">Their portal, after you push version {nextVersion}</p>
            <div className="mt-md">{clientPreview}</div>
          </div>
          <div className="mt-md rounded-card border border-border bg-surface px-lg py-md">
            <p className="text-body-sm text-muted">The email{to ? ` to ${to}` : ""}</p>
            {email.subject.trim() || email.body.trim() ? (
              <>
                <p className="mt-sm text-body text-heading">{email.subject.trim() || "(no subject)"}</p>
                <p className="mt-sm whitespace-pre-wrap text-body-sm text-body">{email.body}</p>
              </>
            ) : (
              <p className="mt-sm text-body-sm text-muted">No email yet. Click Draft Email above.</p>
            )}
          </div>
        </section>
      ) : null}

      {row && history.length > 0 ? (
        <details className="border-t border-border px-lg py-md">
          <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
            Send log ({history.length})
          </summary>
          <div className="mt-sm overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="text-label uppercase tracking-label text-muted">
                  <th className="py-sm pr-lg font-medium">Version</th>
                  <th className="py-sm pr-lg font-medium">Sent</th>
                  <th className="py-sm pr-lg font-medium">Emailed</th>
                  <th className="py-sm pr-lg font-medium">Opened</th>
                  <th className="py-sm font-medium">Client</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => {
                  const current = entry.version === row.version;
                  return (
                    <tr key={entry.version} className="border-t border-border align-top">
                      <td className="py-sm pr-lg text-heading">v{entry.version}</td>
                      <td className="py-sm pr-lg text-muted">
                        {entry.published_at ? formatDateAtTime(entry.published_at) : "—"}
                      </td>
                      <td className="py-sm pr-lg text-muted">
                        {entry.emailed_at ? formatDateAtTime(entry.emailed_at) : "—"}
                      </td>
                      <td className="py-sm pr-lg text-muted">
                        {current && row.client_viewed_at
                          ? formatDateAtTime(row.client_viewed_at)
                          : current
                            ? "Not yet"
                            : "—"}
                      </td>
                      <td className="py-sm">
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
        </details>
      ) : null}
    </>
  );
}
