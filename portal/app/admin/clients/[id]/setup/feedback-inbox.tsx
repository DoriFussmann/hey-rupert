"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveFeedbackReplies, sendFeedbackReplies, type ReplyEdit } from "@/app/admin/feedback-reply-actions";
import { formatDateAtTime } from "@/lib/format";
import {
  REPLY_MAX,
  REPLY_STATUSES,
  REPLY_STATUS_LABEL,
  isUnsent,
  type InboxItem,
  type ReplyStatus,
} from "@/lib/feedback-points";
import { VIEWER_COMMENT_STEP_LABEL, type ViewerCommentStep } from "@/lib/viewer-comments";

type Edit = { reply: string; status: ReplyStatus };

const STATUS_TONE: Record<ReplyStatus, string> = {
  open: "text-warning",
  changed: "text-success",
  not_changing: "text-secondary",
  needs_input: "text-primary",
};

/**
 * Rupert's inbox for one step: every point of the client's feedback and every
 * viewer comment, one by one. Each takes a reply and a status. Nothing reaches
 * the client until "Respond", which sends all new replies together.
 */
export function FeedbackInbox({
  clientId,
  step,
  items,
}: {
  clientId: string;
  step: ViewerCommentStep;
  items: InboxItem[];
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const current = (item: InboxItem): Edit => edits[item.id] ?? { reply: item.reply, status: item.status };
  const dirty = useMemo(
    () =>
      items.filter((item) => {
        const edit = edits[item.id];
        return edit && (edit.reply.trim() !== item.reply.trim() || edit.status !== item.status);
      }),
    [edits, items],
  );
  const toSend = items.filter((item) => isUnsent({ ...item, ...current(item) }));
  const open = items.filter((item) => current(item).status === "open").length;
  const latest = items.length > 0 ? Math.max(...items.map((item) => item.version)) : 0;
  const now = items.filter((item) => item.version === latest);
  const older = items.filter((item) => item.version !== latest);

  if (items.length === 0) return null;

  function change(item: InboxItem, patch: Partial<Edit>) {
    setNotice(null);
    setEdits((all) => ({ ...all, [item.id]: { ...current(item), ...patch } }));
  }

  function payload(): ReplyEdit[] {
    return dirty.map((item) => ({ pointId: item.id, ...current(item) }));
  }

  async function run(kind: "save" | "send") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const result =
        kind === "save"
          ? await saveFeedbackReplies(clientId, step, payload())
          : await sendFeedbackReplies(clientId, step, payload());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEdits({});
      setNotice(
        kind === "save"
          ? "Saved. The client hasn't seen these yet."
          : `Sent ${result.sent} ${result.sent === 1 ? "reply" : "replies"}. ${
              result.emailed ? "They are in the portal and in an email." : "They are in the portal, but the email did not go out."
            }`,
      );
      router.refresh();
    } catch {
      setError("That did not go through. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const row = (item: InboxItem) => {
    const edit = current(item);
    const unsent = isUnsent({ ...item, ...edit });
    return (
      <li key={item.id} className="rounded-md border border-border bg-background px-md py-md">
        <p className="text-body-sm text-secondary">
          <span className="font-medium text-heading">{item.author}</span>
          {item.source === "viewer" ? " · viewer" : ""} · {item.label} · version {item.version}
          {item.at ? ` · ${formatDateAtTime(item.at)}` : ""}
        </p>
        <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">{item.text}</p>
        <div className="mt-sm flex flex-wrap items-start gap-sm">
          <select
            aria-label={`Status of the point from ${item.author}`}
            className={`rounded-md border border-border bg-surface px-sm py-sm text-body-sm ${STATUS_TONE[edit.status]}`}
            value={edit.status}
            disabled={busy !== null}
            onChange={(event) => change(item, { status: event.target.value as ReplyStatus })}
          >
            {REPLY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {REPLY_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
          <textarea
            aria-label={`Reply to the point from ${item.author}`}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
            rows={2}
            maxLength={REPLY_MAX}
            placeholder="Your reply"
            value={edit.reply}
            disabled={busy !== null}
            onChange={(event) => change(item, { reply: event.target.value })}
          />
        </div>
        <p className="mt-xs text-label uppercase tracking-label text-muted">
          {unsent
            ? item.publishedAt
              ? "Changed since it was sent"
              : "Not sent yet"
            : item.publishedAt
              ? `Sent ${formatDateAtTime(item.publishedAt)}`
              : "No reply yet"}
        </p>
      </li>
    );
  };

  return (
    <section className="mt-lg rounded-card border border-warning/40 bg-surface px-lg py-md">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h3 className="text-h4">Feedback · {VIEWER_COMMENT_STEP_LABEL[step]}</h3>
          <p className="mt-xs text-body-sm text-muted">
            {items.length} {items.length === 1 ? "point" : "points"} · {open} open · {toSend.length} to send. Reply to
            each, then Respond: the client and their viewers see every reply in the portal and get one email.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
            disabled={busy !== null || dirty.length === 0}
            onClick={() => void run("save")}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
            disabled={busy !== null || toSend.length === 0}
            onClick={() => void run("send")}
          >
            {busy === "send"
              ? "Sending…"
              : toSend.length > 0
                ? `Respond: Send ${toSend.length} ${toSend.length === 1 ? "Reply" : "Replies"}`
                : "Respond"}
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-sm text-body-sm text-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-sm text-body-sm text-success">
          {notice}
        </p>
      ) : null}
      <ol className="mt-md space-y-sm">{now.map(row)}</ol>
      {older.length > 0 ? (
        <details className="mt-md">
          <summary className="cursor-pointer text-body-sm text-secondary">
            Earlier versions · {older.length} {older.length === 1 ? "point" : "points"}
          </summary>
          <ol className="mt-sm space-y-sm">{older.map(row)}</ol>
        </details>
      ) : null}
    </section>
  );
}
