"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { decideReplyAction, labelReplyAction } from "@/app/admin/outreach-live-actions";
import { REPLY_LABELS, replyLabelText, suggestsRelease, type ReplyVisibility } from "@/lib/outreach/live";
import type { AdminReply } from "@/lib/outreach/replies-server";
import { formatDateTime } from "@/lib/format";

const button =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const primary =
  "rounded-md bg-primary px-sm py-xs text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";

const VISIBILITY_TEXT: Record<ReplyVisibility, string> = {
  pending: "Waiting for you",
  released: "Released to the client",
  withheld: "Withheld",
};

function ReplyCard({ reply, onChange }: { reply: AdminReply; onChange: (next: AdminReply) => void }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(reply.withheld_reason);
  const [error, setError] = useState<string | null>(null);

  async function decide(visibility: ReplyVisibility) {
    setBusy(true);
    setError(null);
    try {
      const result = await decideReplyAction(reply.id, { visibility, reason });
      if (!result.ok) setError(result.error);
      else onChange({ ...reply, visibility, withheld_reason: visibility === "withheld" ? reason : "" });
    } finally {
      setBusy(false);
    }
  }

  async function relabel(label: string) {
    setBusy(true);
    try {
      const result = await decideReplyAction(reply.id, { label });
      if (!result.ok) setError(result.error);
      else onChange({ ...reply, label: label as AdminReply["label"] });
    } finally {
      setBusy(false);
    }
  }

  const suggested = reply.label ? (suggestsRelease(reply.label) ? "Suggest: release" : "Suggest: withhold") : "";

  return (
    <li className="rounded-card border border-border bg-surface px-lg py-md">
      <div className="flex flex-wrap items-baseline gap-sm">
        <span className="text-body-sm text-heading">{reply.fund_name || reply.lead_email}</span>
        <span className="text-body-sm text-muted">
          {reply.person_name ? `${reply.person_name} · ` : ""}
          {reply.client_name ? (
            <Link href={`/admin/clients/${reply.client_id}`} className="text-primary hover:text-primary-hover">
              {reply.client_name}
            </Link>
          ) : null}{" "}
          · {formatDateTime(reply.received_at)}
        </span>
        <span className="ml-auto text-body-sm text-secondary">{VISIBILITY_TEXT[reply.visibility]}</span>
      </div>
      <p className="mt-xs text-body-sm text-heading">{reply.subject || "(no subject)"}</p>
      <div className="mt-sm whitespace-pre-wrap rounded-md bg-background px-md py-sm text-body-sm text-body">{reply.body || "(empty)"}</div>
      <div className="mt-sm flex flex-wrap items-center gap-sm text-body-sm">
        <select
          className="rounded-md border border-border bg-background px-sm py-xs"
          value={reply.label ?? ""}
          disabled={busy}
          onChange={(event) => relabel(event.target.value)}
          aria-label="Label"
        >
          <option value="" disabled>
            {replyLabelText(null)}
          </option>
          {REPLY_LABELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        {reply.summary ? <span className="text-secondary">{reply.summary}</span> : null}
        {suggested ? <span className="text-muted">· {suggested}</span> : null}
        {reply.unibox_url ? (
          <a href={reply.unibox_url} target="_blank" rel="noreferrer" className="ml-auto text-primary hover:text-primary-hover">
            Open in Instantly
          </a>
        ) : null}
      </div>
      <div className="mt-sm flex flex-wrap items-center gap-sm">
        <button type="button" className={primary} disabled={busy || reply.visibility === "released"} onClick={() => decide("released")}>
          Release to client
        </button>
        <input
          className="min-w-[14rem] flex-1 rounded-md border border-border bg-background px-sm py-xs text-body-sm"
          placeholder="Reason to withhold (for you only)"
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
        <button type="button" className={button} disabled={busy || reply.visibility === "withheld"} onClick={() => decide("withheld")}>
          Withhold
        </button>
        {reply.visibility !== "pending" ? (
          <button type="button" className={button} disabled={busy} onClick={() => decide("pending")}>
            Undo
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-xs text-body-sm text-error">{error}</p> : null}
    </li>
  );
}

export function ReplyTriage({ replies, claudeReady }: { replies: AdminReply[]; claudeReady: boolean }) {
  const [items, setItems] = useState(replies);
  const [labelling, setLabelling] = useState(0);
  const started = useRef(false);

  // Labels new replies with Claude, one at a time.
  useEffect(() => {
    if (started.current || !claudeReady) return;
    started.current = true;
    const todo = replies.filter((reply) => !reply.label);
    if (todo.length === 0) return;
    void (async () => {
      for (let index = 0; index < todo.length; index += 1) {
        const reply = todo[index];
        setLabelling(todo.length - index);
        const result = await labelReplyAction(reply.id);
        if (result.ok) {
          setItems((current) => current.map((item) => (item.id === reply.id ? { ...item, label: result.label, summary: result.summary } : item)));
        }
      }
      setLabelling(0);
    })();
  }, [replies, claudeReady]);

  if (items.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface px-lg py-xl">
        <h2 className="text-h4">Nothing waiting</h2>
        <p className="mt-sm text-body-sm text-muted">New investor replies land here as they arrive.</p>
      </div>
    );
  }

  return (
    <>
      {labelling ? <p className="mb-sm text-body-sm text-muted">Labelling {labelling} new repl{labelling === 1 ? "y" : "ies"}…</p> : null}
      <ul className="grid gap-md">
        {items.map((reply) => (
          <ReplyCard key={reply.id} reply={reply} onChange={(next) => setItems((current) => current.map((item) => (item.id === next.id ? next : item)))} />
        ))}
      </ul>
    </>
  );
}
