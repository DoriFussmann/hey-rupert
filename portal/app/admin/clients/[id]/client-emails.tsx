"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendManualEmail, setClientEmailsPaused } from "@/app/admin/email-actions";
import { formatDateAtTime } from "@/lib/format";
import type { EmailLogEntry, EmailLogKind } from "@/lib/email-log";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm font-sans text-body-sm text-body outline-none focus:border-primary";
const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";

const KIND_LABELS: Record<EmailLogKind, string> = {
  automatic: "Automatic",
  reminder: "Reminder",
  manual: "Sent by you",
};

type Message = { kind: "ok" | "error"; text: string } | null;

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p
      role={message.kind === "error" ? "alert" : "status"}
      className={`text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
    >
      {message.text}
    </p>
  );
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export function ClientEmails({
  clientId,
  address,
  paused,
  signature,
  history,
  historyError,
}: {
  clientId: string;
  address: string;
  paused: boolean;
  signature: string;
  history: EmailLogEntry[];
  historyError: string | null;
}) {
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(paused);
  const [pausePending, setPausePending] = useState(false);
  const [pauseMessage, setPauseMessage] = useState<Message>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copyMe, setCopyMe] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<Message>(null);

  const canSend = Boolean(address && subject.trim() && body.trim()) && !sending;

  async function onTogglePause(next: boolean) {
    setPausePending(true);
    setPauseMessage(null);
    try {
      const result = await setClientEmailsPaused(clientId, next);
      if (!result.ok) {
        setPauseMessage({ kind: "error", text: result.error });
        return;
      }
      setIsPaused(next);
      setPauseMessage({
        kind: "ok",
        text: next
          ? "Automatic emails and reminders paused for this client."
          : "Automatic emails and reminders are back on.",
      });
      router.refresh();
    } catch (err) {
      setPauseMessage({ kind: "error", text: errorText(err, "Unable to update.") });
    } finally {
      setPausePending(false);
    }
  }

  async function onSend() {
    if (!canSend) return;
    if (!window.confirm(`Send this email to ${address}?`)) return;

    setSending(true);
    setSendMessage(null);
    try {
      const result = await sendManualEmail(clientId, {
        subject,
        message: body,
        copyMe,
      });
      if (!result.ok) {
        setSendMessage({ kind: "error", text: `Not sent. ${result.error}` });
        return;
      }
      setSubject("");
      setBody("");
      setSendMessage({
        kind: "ok",
        text: result.copied
          ? `Sent to ${address}. A copy went to you.`
          : `Sent to ${address}.`,
      });
      router.refresh();
    } catch (err) {
      setSendMessage({ kind: "error", text: errorText(err, "Unable to send.") });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-md border-b border-border px-lg py-lg">
        <div>
          <h2 className="text-h4">Emails</h2>
          <p className="mt-xs text-body-sm text-muted">
            Write to {address || "the client"} directly, and see every email
            they were sent.
          </p>
        </div>
        <div className="flex flex-col items-end gap-xs">
          <label className="flex items-center gap-sm text-body-sm text-heading">
            <input
              type="checkbox"
              checked={isPaused}
              disabled={pausePending}
              onChange={(event) => onTogglePause(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Pause automatic emails
          </label>
          <Feedback message={pauseMessage} />
        </div>
      </div>

      {isPaused ? (
        <p
          role="status"
          className="border-b border-border bg-background px-lg py-sm text-body-sm text-warning"
        >
          Paused: this client gets no automatic emails or reminders. Emails you
          send below still go out.
        </p>
      ) : null}

      <div className="space-y-md border-b border-border px-lg py-lg">
        <h3 className="text-h4">Send an email</h3>
        {!address ? (
          <p className="text-body-sm text-error">
            This client has no email address. Add one in the client details.
          </p>
        ) : null}
        <label className="block text-label uppercase tracking-label text-muted">
          Subject
          <input
            type="text"
            className={fieldClass}
            value={subject}
            maxLength={300}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>
        <label className="block text-label uppercase tracking-label text-muted">
          Message
          <textarea
            className={`${fieldClass} min-h-[180px] resize-y`}
            value={body}
            maxLength={10000}
            onChange={(event) => setBody(event.target.value)}
            spellCheck
          />
        </label>
        {subject.trim() || body.trim() ? (
          <div>
            <p className="text-label uppercase tracking-label text-muted">
              Preview · your signature is added
            </p>
            <div className="mt-sm rounded-md border border-border bg-background p-md text-body-sm">
              <p className="text-heading">{subject.trim() || "(no subject)"}</p>
              <p className="mt-sm whitespace-pre-wrap break-words text-body">
                {`${body.trim()}\n\n${signature}`}
              </p>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-md">
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className={primaryButton}
          >
            {sending ? "Sending…" : "Send email"}
          </button>
          <label className="flex items-center gap-sm text-body-sm text-heading">
            <input
              type="checkbox"
              checked={copyMe}
              onChange={(event) => setCopyMe(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Send me a copy
          </label>
          <Feedback message={sendMessage} />
        </div>
      </div>

      <div className="px-lg py-lg">
        <h3 className="text-h4">Email history</h3>
        {historyError ? (
          <p className="mt-sm text-body-sm text-error">{historyError}</p>
        ) : history.length === 0 ? (
          <p className="mt-sm text-body-sm text-muted">
            No emails logged yet. Emails sent from now on appear here.
          </p>
        ) : (
          <ul className="mt-md divide-y divide-border rounded-md border border-border">
            {history.map((entry) => (
              <li key={entry.id}>
                <details>
                  <summary className="grid cursor-pointer grid-cols-[1fr_auto] gap-x-md gap-y-xs px-md py-sm text-body-sm sm:grid-cols-[9rem_7rem_1fr_auto]">
                    <span className="text-muted">
                      {formatDateAtTime(entry.created_at)}
                    </span>
                    <span className="text-muted">
                      {KIND_LABELS[entry.kind]}
                    </span>
                    <span className="col-span-2 break-words text-heading sm:col-span-1">
                      {entry.subject}
                    </span>
                    <span
                      className={`col-span-2 sm:col-span-1 ${
                        entry.status === "sent" ? "text-success" : "text-error"
                      }`}
                    >
                      {entry.status === "sent" ? "Sent" : "Failed"}
                    </span>
                  </summary>
                  <div className="border-t border-border bg-background px-md py-md text-body-sm">
                    <p className="text-muted">To: {entry.recipients.join(", ")}</p>
                    {entry.error ? (
                      <p className="mt-xs text-error">{entry.error}</p>
                    ) : null}
                    <p className="mt-sm whitespace-pre-wrap break-words text-body">
                      {entry.body}
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
