"use client";

import { useMemo, useState } from "react";
import { markReplyRead } from "@/app/portal/setup/actions";
import { formatDateTime } from "@/lib/format";
import type { ClientReply } from "@/lib/outreach/replies-server";

export function InboxView({ replies, readOnly }: { replies: ClientReply[]; readOnly: boolean }) {
  const [items, setItems] = useState(replies);
  const [selectedId, setSelectedId] = useState(replies[0]?.id ?? null);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  function open(id: string) {
    setSelectedId(id);
    const item = items.find((reply) => reply.id === id);
    if (item?.unread) {
      setItems((current) => current.map((reply) => (reply.id === id ? { ...reply, unread: false } : reply)));
      if (!readOnly) void markReplyRead(id);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface px-lg py-xl">
        <h2 className="text-h4">No replies yet</h2>
        <p className="mt-sm text-body-sm text-muted">Investor replies appear here once Rupert passes them on.</p>
      </div>
    );
  }

  return (
    <div className="grid min-h-[32rem] overflow-hidden rounded-card border border-border bg-surface lg:grid-cols-[22rem_minmax(0,1fr)]">
      <ul className="border-b border-border lg:border-b-0 lg:border-r">
        {items.map((item) => {
          const active = item.id === selectedId;
          return (
            <li key={item.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => open(item.id)}
                className={`block w-full px-md py-md text-left ${active ? "bg-primary-tint" : "bg-surface"}`}
              >
                <p className="flex items-center justify-between gap-sm text-body-sm text-heading">
                  <span>
                    {item.investor}
                    {item.fund ? <span className="text-muted"> · {item.fund}</span> : null}
                  </span>
                  {item.unread ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                </p>
                <p className="mt-xs text-body-sm text-heading">{item.subject}</p>
                <p className="mt-xs line-clamp-2 text-body-sm text-muted">{item.preview}</p>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-lg py-lg">
        {selected ? (
          <>
            <p className="text-label uppercase tracking-label text-muted">
              {selected.fund}
              {selected.label ? ` · ${selected.label}` : ""}
            </p>
            <h2 className="mt-sm text-h3">{selected.subject}</h2>
            <p className="mt-xs text-body-sm text-muted">
              {selected.investor} · {selected.email} · {formatDateTime(selected.received_at)}
            </p>
            <p className="mt-lg max-w-prose whitespace-pre-wrap text-body-sm leading-relaxed">{selected.body}</p>
            <p className="mt-xl max-w-prose rounded-md bg-background px-md py-sm text-body-sm text-secondary">
              This reply is in your email too. Answer it there, in the same thread, so the conversation stays between you
              and {selected.investor.split(" ")[0] || "the investor"}.
            </p>
          </>
        ) : (
          <p className="text-body-sm text-muted">Select a reply to read it.</p>
        )}
      </div>
    </div>
  );
}
