"use client";

import { useState } from "react";
import type { ReviewStatus } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";

export function ReviewPanel({
  kicker,
  title,
  updatedLabel,
  initialStatus = "pending",
  children,
}: {
  kicker: string;
  title: string;
  updatedLabel: string;
  initialStatus?: ReviewStatus;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<ReviewStatus>(initialStatus);
  const [note, setNote] = useState("");

  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-md border-b border-border px-lg py-lg">
        <div>
          <p className="text-label uppercase tracking-label text-muted">
            {kicker}
          </p>
          <h2 className="mt-sm text-h3">{title}</h2>
          <p className="mt-xs text-body-sm text-muted">{updatedLabel}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="max-w-prose px-lg py-lg text-body-sm leading-relaxed text-body">
        {children}
      </div>

      <div className="border-t border-border px-lg py-lg">
        <label className="block text-label uppercase tracking-label text-muted">
          Request a change
          <textarea
            className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note for Rupert"
          />
        </label>
        <div className="mt-md flex flex-wrap gap-sm">
          <button
            type="button"
            onClick={() => setStatus("acknowledged")}
            className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover"
          >
            Acknowledge
          </button>
          <button
            type="button"
            onClick={() => setStatus("changes_requested")}
            className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
          >
            Request changes
          </button>
        </div>
      </div>
    </section>
  );
}
