"use client";

import { useState } from "react";
import { toggleFeedbackItem } from "@/app/portal/setup/actions";
import {
  FEEDBACK_AREAS,
  FEEDBACK_PRIORITIES,
  type FeedbackItem,
  type FeedbackPriority,
} from "@/lib/setup";

const PRIORITY_NOTE: Record<FeedbackPriority, string> = {
  high: "Worth doing before outreach starts.",
  medium: "Will make the materials noticeably stronger.",
  low: "Polish, when you have time.",
};

const PRIORITY_TONE: Record<FeedbackPriority, string> = {
  high: "border-primary/30",
  medium: "border-border",
  low: "border-border",
};

function areaLabel(value: FeedbackItem["area"]) {
  return FEEDBACK_AREAS.find((area) => area.value === value)?.label ?? value;
}

/**
 * Rupert's recommendations grouped by priority, with a tick per item for the
 * client's own tracking. Ticks are private to the client and Rupert.
 */
export function FeedbackChecklist({
  items,
  initialDone,
  readOnly,
}: {
  items: FeedbackItem[];
  initialDone: string[];
  readOnly: boolean;
}) {
  const [done, setDone] = useState(() => new Set(initialDone));
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string, checked: boolean) {
    setError(null);
    setDone((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    try {
      const result = await toggleFeedbackItem(id, checked);
      if (result.ok) return;
      setError(result.error);
    } catch {
      setError("Your tick could not be saved. Please try again.");
    }
    // Undo the optimistic tick.
    setDone((current) => {
      const next = new Set(current);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const total = items.length;
  const completed = items.filter((item) => done.has(item.id)).length;

  return (
    <div className="grid gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h2 className="text-h4">Recommendations</h2>
        <p className="text-body-sm text-muted">
          {completed} of {total} done{readOnly ? "" : " · tick them off as you go"}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      {FEEDBACK_PRIORITIES.map((priority) => {
        const group = items.filter((item) => item.priority === priority.value);
        if (group.length === 0) return null;
        const groupDone = group.filter((item) => done.has(item.id)).length;
        return (
          <section
            key={priority.value}
            className={`rounded-card border bg-surface ${PRIORITY_TONE[priority.value]}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-sm border-b border-border px-lg py-md">
              <div>
                <h3 className="text-body-sm uppercase tracking-label text-heading">
                  {priority.label} priority
                </h3>
                <p className="mt-xs text-body-sm text-muted">{PRIORITY_NOTE[priority.value]}</p>
              </div>
              <span className="font-mono text-mono text-muted">
                {groupDone}/{group.length}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {group.map((entry) => {
                const checked = done.has(entry.id);
                const inputId = `feedback-${entry.id}`;
                return (
                  <li key={entry.id} className="flex gap-md px-lg py-md">
                    <input
                      id={inputId}
                      type="checkbox"
                      className="mt-xs h-5 w-5 shrink-0 cursor-pointer accent-primary disabled:cursor-default"
                      checked={checked}
                      disabled={readOnly}
                      onChange={(event) => void toggle(entry.id, event.target.checked)}
                    />
                    <div className={`min-w-0 flex-1 ${checked ? "opacity-60" : ""}`}>
                      <p className="text-label uppercase tracking-label text-muted">
                        {areaLabel(entry.area)}
                        {entry.slide ? ` · Slide ${entry.slide}` : ""}
                      </p>
                      {entry.title ? (
                        <label
                          htmlFor={inputId}
                          className={`mt-xs block cursor-pointer text-body-sm text-heading ${
                            checked ? "line-through" : ""
                          }`}
                        >
                          {entry.title}
                        </label>
                      ) : null}
                      {entry.body ? (
                        <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">{entry.body}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
