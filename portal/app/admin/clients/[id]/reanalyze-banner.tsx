"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { matchNeedsRerun, reanalyzeStep } from "@/app/admin/reanalyze-actions";
import { primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { matchPath } from "@/lib/match/shared";
import { reanalyzeHeadline, type ReanalyzeState, type ReanalyzeStepId } from "@/lib/reanalyze";

type StepStatus = "waiting" | "running" | "done" | "failed" | "skipped";
type StepProgress = { status: StepStatus; note: string | null };

const STATUS_LABEL: Record<StepStatus, string> = {
  waiting: "Waiting",
  running: "Running…",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_TONE: Record<StepStatus, string> = {
  waiting: "text-muted",
  running: "text-primary",
  done: "text-success",
  failed: "text-error",
  skipped: "text-muted",
};

type Outcome = { failed: string | null; matchRerun: boolean; narrative: boolean };

// The page reloads after a run so every panel shows the new results; the
// run's outcome is kept for that one reload.
const storageKey = (clientId: string) => `rupert:reanalyze:${clientId}`;

function takeStoredRun(clientId: string): { progress: Record<string, StepProgress>; outcome: Outcome } | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(clientId));
    if (!raw) return null;
    window.sessionStorage.removeItem(storageKey(clientId));
    const parsed = JSON.parse(raw) as { progress?: unknown; outcome?: unknown };
    if (!parsed.progress || typeof parsed.progress !== "object" || !parsed.outcome || typeof parsed.outcome !== "object") {
      return null;
    }
    return { progress: parsed.progress as Record<string, StepProgress>, outcome: parsed.outcome as Outcome };
  } catch {
    return null;
  }
}

function storeRun(clientId: string, progress: Record<string, StepProgress>, outcome: Outcome) {
  try {
    window.sessionStorage.setItem(storageKey(clientId), JSON.stringify({ progress, outcome }));
    return true;
  } catch {
    return false;
  }
}

/**
 * One button for everything the AI writes about the company: shown when the
 * founder added files or messages after the last analysis (or nothing has
 * been analyzed yet). Lists what it will replace, then runs the steps in
 * order, one request each, and never sends anything to the client.
 */
export function ReanalyzeBanner({
  clientId,
  state,
  claudeReady,
}: {
  clientId: string;
  state: ReanalyzeState;
  claudeReady: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<Record<string, StepProgress> | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const stored = takeStoredRun(clientId);
    if (stored) {
      setProgress(stored.progress);
      setOutcome(stored.outcome);
    }
  }, [clientId]);

  if (!state.available || (!state.show && !progress)) return null;

  const action = state.firstRun ? "Analyze all" : "Re-analyze all";

  async function run() {
    setConfirming(false);
    setOutcome(null);
    setRunning(true);
    const current: Record<string, StepProgress> = Object.fromEntries(
      state.steps.map((step) => [step.id, { status: step.skip ? "skipped" : "waiting", note: step.skip }]),
    );
    setProgress({ ...current });
    const mark = (id: ReanalyzeStepId, value: StepProgress) => {
      current[id] = value;
      setProgress({ ...current });
    };

    let failed: string | null = null;
    for (const step of state.steps) {
      if (step.skip) continue;
      mark(step.id, { status: "running", note: null });
      try {
        const result = await reanalyzeStep(clientId, step.id);
        if (result.ok) {
          mark(step.id, { status: "done", note: result.note });
          continue;
        }
        mark(step.id, { status: "failed", note: result.error });
      } catch (err) {
        mark(step.id, { status: "failed", note: err instanceof Error ? err.message : "The step failed." });
      }
      failed = step.label;
      break;
    }

    let matchRerun = false;
    if (current.profile?.status === "done") {
      try {
        const check = await matchNeedsRerun(clientId);
        matchRerun = check.ok && check.needed;
      } catch {
        matchRerun = false;
      }
    }
    const result: Outcome = { failed, matchRerun, narrative: current.narrative?.status === "done" };
    // Reload so every panel on the page shows what the run wrote. Without
    // session storage the outcome stays on screen instead.
    if (storeRun(clientId, { ...current }, result)) {
      window.location.reload();
      return;
    }
    setOutcome(result);
    setRunning(false);
  }

  return (
    <section
      className="mb-lg rounded-card border border-primary/40 bg-surface"
      aria-labelledby="reanalyze-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md">
        <div className="min-w-0 flex-1">
          <h2 id="reanalyze-title" className="text-h4 text-heading">
            Analysis
          </h2>
          <p className="mt-xs text-body-sm text-body">
            {progress && !running && outcome
              ? outcome.failed
                ? `Stopped at ${outcome.failed}. The steps before it are saved.`
                : "Analysis complete. Nothing was sent to the client."
              : reanalyzeHeadline(state)}
          </p>
        </div>
        {!running && !confirming ? (
          <button
            type="button"
            className={primaryButton}
            disabled={!claudeReady}
            title={claudeReady ? undefined : "ANTHROPIC_API_KEY is not configured."}
            onClick={() => setConfirming(true)}
          >
            {outcome?.failed ? "Try again" : action}
          </button>
        ) : null}
      </div>

      {confirming ? (
        <div className="border-t border-border px-lg py-md">
          <p className="text-body-sm text-heading">This runs, in order:</p>
          <ol className="mt-sm list-decimal space-y-xs pl-lg text-body-sm text-body">
            {state.steps.map((step) => (
              <li key={step.id}>
                <span className="text-heading">{step.label}</span>
                {step.skip ? (
                  <span className="text-muted"> — skipped: {step.skip}</span>
                ) : step.replaces ? (
                  <span className={step.replaces.startsWith("Your edits") ? "text-warning" : "text-muted"}>
                    {" "}— {step.replaces}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="mt-sm text-body-sm text-muted">
            It takes a few minutes; keep this page open. Nothing is sent to the client.
          </p>
          <div className="mt-md flex flex-wrap gap-sm">
            <button type="button" className={primaryButton} onClick={() => void run()}>
              Run {state.steps.filter((step) => !step.skip).length} steps
            </button>
            <button type="button" className={secondaryButton} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {progress ? (
        <ol className="divide-y divide-border border-t border-border" aria-live="polite">
          {state.steps.map((step) => {
            const item = progress[step.id] ?? { status: "waiting" as const, note: null };
            return (
              <li key={step.id} className="flex flex-wrap items-baseline justify-between gap-sm px-lg py-sm text-body-sm">
                <span className="text-heading">{step.label}</span>
                <span className={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</span>
                {item.note ? <p className="w-full text-muted">{item.note}</p> : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {outcome && !running ? (
        <div className="space-y-xs border-t border-border px-lg py-md text-body-sm">
          {outcome.narrative ? (
            <p className="text-body">New narrative draft ready, not sent. Review it under Setup.</p>
          ) : null}
          {outcome.matchRerun ? (
            <p className="text-warning">
              Match needs re-run: the company profile changed since the last match.{" "}
              <Link href={matchPath(clientId, "tiers")} className="text-primary no-underline hover:text-primary-hover">
                Open Matching
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
