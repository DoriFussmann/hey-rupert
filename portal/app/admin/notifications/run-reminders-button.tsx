"use client";

import { useState } from "react";
import { runRemindersNow } from "@/app/admin/setup-actions";

export function RunRemindersButton() {
  const [pending, setPending] = useState(false);
  const [lines, setLines] = useState<{ kind: "ok" | "error"; text: string }[]>(
    [],
  );

  async function onClick() {
    setPending(true);
    setLines([]);
    try {
      const result = await runRemindersNow();
      if (!result.ok) {
        setLines([{ kind: "error", text: result.error }]);
        return;
      }
      const next: { kind: "ok" | "error"; text: string }[] = [];
      next.push({
        kind: "ok",
        text:
          result.emailed.length === 0 && result.stalled.length === 0
            ? `Checked ${result.checked} client${result.checked === 1 ? "" : "s"} with a turn waiting. No reminders due.`
            : `Checked ${result.checked}. Reminded ${result.emailed.length}, stalled alerts ${result.stalled.length}.`,
      });
      result.emailed.forEach((text) => next.push({ kind: "ok", text: `Reminded ${text}` }));
      result.stalled.forEach((text) => next.push({ kind: "ok", text: `Stalled: ${text}` }));
      result.errors.forEach((text) => next.push({ kind: "error", text }));
      setLines(next);
    } catch (err) {
      setLines([
        { kind: "error", text: err instanceof Error ? err.message : "Unable to run." },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-md flex-col items-end gap-sm">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title="Emails clients whose turn has been waiting 24h or more (max 3 reminders per step), then alerts you."
        className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
      >
        {pending ? "Checking…" : "Send due reminders"}
      </button>
      {lines.map((line, index) => (
        <p
          key={index}
          role={line.kind === "error" ? "alert" : "status"}
          className={`text-right text-body-sm ${
            line.kind === "ok" ? "text-success" : "text-error"
          }`}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}
