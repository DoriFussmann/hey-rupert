"use client";

import { useState } from "react";
import { DropSummary } from "@/components/drop-summary";
import { useRouter } from "next/navigation";
import { settleReadyNudgeAction } from "@/app/admin/nudge-actions";
import { daysLabel } from "@/lib/nudge";
import type { ReadyNudge } from "@/lib/reminders";

const primary =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";

function daysSince(at: string) {
  const ms = Date.now() - Date.parse(at);
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Reminders the schedule says are due, written and ready. Nothing goes out
 * until Rupert clicks Send.
 */
export function ReadyNudges({ nudges, errors }: { nudges: ReadyNudge[]; errors: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<Record<string, string>>({});

  async function settle(clientId: string, decision: "send" | "skip") {
    setBusy(clientId);
    setError((current) => ({ ...current, [clientId]: "" }));
    try {
      const result = await settleReadyNudgeAction(clientId, decision);
      if (!result.ok) setError((current) => ({ ...current, [clientId]: result.error }));
      else {
        setDone((current) => ({ ...current, [clientId]: decision === "send" ? "Sent." : "Skipped." }));
        router.refresh();
      }
    } catch (err) {
      setError((current) => ({ ...current, [clientId]: err instanceof Error ? err.message : "Something went wrong." }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-md">
        <h2 className="text-h4">
          Ready to send <span className="text-muted">({nudges.length})</span>
        </h2>
        <p className="mt-xs max-w-prose text-body-sm text-muted">
          Reminders the schedule says are due today (Forms → Emails sets when and how many). Nothing goes out until you
          click Send. Skip counts it as done; the next one follows on schedule.
        </p>
        {errors.length > 0 ? <p className="mt-xs text-body-sm text-warning">{errors.join(" ")}</p> : null}
      </div>
      {nudges.length === 0 ? (
        <p className="px-lg py-md text-body-sm text-muted">Nothing due right now.</p>
      ) : (
        <ul>
          {nudges.map((nudge) => (
            <li key={nudge.clientId} className="border-b border-border px-lg py-md last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-md">
                <div className="min-w-0">
                  <p className="text-heading">
                    {nudge.name}
                    {nudge.company && nudge.company !== nudge.name ? <span className="text-muted"> · {nudge.company}</span> : null}
                  </p>
                  <ul className="mt-xs text-body-sm text-secondary">
                    {nudge.steps.map((step) => (
                      <li key={step.label}>
                        {step.label}: waiting {daysLabel(daysSince(step.since))} · reminder {step.reminder} of {step.max}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-sm">
                  {done[nudge.clientId] ? (
                    <span className="text-body-sm text-success">{done[nudge.clientId]}</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="text-body-sm text-muted hover:text-heading disabled:opacity-40"
                        disabled={busy !== null}
                        onClick={() => void settle(nudge.clientId, "skip")}
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        className={primary}
                        disabled={busy !== null || !nudge.email}
                        onClick={() => void settle(nudge.clientId, "send")}
                      >
                        {busy === nudge.clientId ? "Sending…" : "Send"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {nudge.email ? (
                <details className="group/drop mt-sm text-body-sm">
                  <DropSummary>Preview: {nudge.email.subject}</DropSummary>
                  <div className="mt-sm rounded-md border border-border bg-background px-md py-sm">
                    <p className="text-muted">To: {nudge.email.to}</p>
                    <p className="mt-xs text-heading">{nudge.email.subject}</p>
                    <p className="mt-sm whitespace-pre-wrap text-body">{nudge.email.body}</p>
                  </div>
                </details>
              ) : (
                <p className="mt-sm text-body-sm text-error">{nudge.problem}</p>
              )}
              {error[nudge.clientId] ? <p role="alert" className="mt-xs text-body-sm text-error">{error[nudge.clientId]}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
