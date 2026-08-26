"use client";

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import type { InvestorReply } from "@/lib/types";

export function InboxView({ replies }: { replies: InvestorReply[] }) {
  const [items, setItems] = useState(replies);
  const [selectedId, setSelectedId] = useState(replies[0]?.id ?? null);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  if (items.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface px-lg py-xl">
        <h2 className="text-h4">No replies yet</h2>
        <p className="mt-sm text-body-sm text-muted">
          Investor replies will appear here as they arrive.
        </p>
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
                onClick={() => {
                  setSelectedId(item.id);
                  setItems((current) =>
                    current.map((reply) =>
                      reply.id === item.id ? { ...reply, unread: false } : reply,
                    ),
                  );
                }}
                className={`block w-full px-md py-md text-left ${
                  active ? "bg-primary-tint" : "bg-surface"
                }`}
              >
                <p className="flex items-center justify-between gap-sm text-body-sm text-heading">
                  <span>
                    {item.investor}
                    <span className="text-muted"> · {item.fund}</span>
                  </span>
                  {item.unread ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  ) : null}
                </p>
                <p className="mt-xs text-body-sm text-heading">{item.subject}</p>
                <p className="mt-xs line-clamp-2 text-body-sm text-muted">
                  {item.preview}
                </p>
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
            </p>
            <h2 className="mt-sm text-h3">{selected.subject}</h2>
            <p className="mt-xs text-body-sm text-muted">
              {selected.investor} · {formatDateTime(selected.received_at)}
            </p>
            <p className="mt-lg max-w-prose whitespace-pre-wrap text-body-sm leading-relaxed">
              {selected.body}
            </p>
          </>
        ) : (
          <p className="text-body-sm text-muted">
            Select a lead to view the conversation
          </p>
        )}
      </div>
    </div>
  );
}
