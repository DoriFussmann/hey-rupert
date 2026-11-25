"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { matchNeedsRerun, reanalyzeStep } from "@/app/admin/reanalyze-actions";
import { updateFactsAction } from "@/app/admin/update-facts-actions";
import { primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { formatDateAtTime } from "@/lib/format";
import { matchPath } from "@/lib/match/shared";
import { reanalyzeHeadline, type ReanalyzeState, type StartOverStep } from "@/lib/reanalyze";
import { changeLine } from "@/lib/update-facts";
import type { FactUpdateRecord } from "@/lib/update-facts-server";

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

type Outcome = { failed: string | null; matchRerun: boolean };

// The page reloads after Start Over so every panel shows the new results;
// the run's outcome is kept for that one reload.
const storageKey = (clientId: string) => `rupert:startover:${clientId}`;

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

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Analysis, once the first analysis has run. Two ways to bring it up to date:
 * Update Facts corrects the facts in what is already written from newer files
 * and client notes, and keeps every decision; Start Over clears the analysis
 * and rebuilds it as if nothing had been processed. Neither sends anything to
 * the client.
 */
export function ReanalyzeBanner({
  clientId,
  state,
  startOver,
  lastFactUpdate,
  claudeReady,
}: {
  clientId: string;
  state: ReanalyzeState;
  startOver: StartOverStep[];
  lastFactUpdate: FactUpdateRecord | null;
  claudeReady: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"facts" | "start_over" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"facts" | "start_over" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<FactUpdateRecord | null>(null);
  const [progress, setProgress] = useState<Record<string, StepProgress> | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const stored = takeStoredRun(clientId);
    if (stored) {
      setProgress(stored.progress);
      setOutcome(stored.outcome);
    }
  }, [clientId]);

  if (!state.available) return null;

  const something = state.newFiles + state.newNotes + state.newMessages > 0 || state.behind.length > 0;
  const factsDisabledReason = !claudeReady
    ? "ANTHROPIC_API_KEY is not configured."
    : state.canUpdateFacts
      ? null
      : "Nothing new since the last analysis. Add the new files, or log what the client said under Client feedback, first.";

  async function runFacts() {
    setBusy("facts");
    setError(null);
    try {
      const result = await updateFactsAction(clientId, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMode(null);
      setNote("");
      setShown(result.record);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update Facts failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runStartOver() {
    setMode(null);
    setOutcome(null);
    setBusy("start_over");
    const current: Record<string, StepProgress> = Object.fromEntries(
      startOver.map((step) => [step.id, { status: step.skip ? "skipped" : "waiting", note: step.skip }]),
    );
    setProgress({ ...current });
    const mark = (id: string, value: StepProgress) => {
      current[id] = value;
      setProgress({ ...current });
    };

    let failed: string | null = null;
    for (const step of startOver) {
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
    const result: Outcome = { failed, matchRerun };
    if (storeRun(clientId, { ...current }, result)) {
      window.location.reload();
      return;
    }
    setOutcome(result);
    setBusy(null);
  }

  const headline =
    progress && outcome
      ? outcome.failed
        ? `Start Over stopped at ${outcome.failed}. The steps before it are saved.`
        : "Started over: the analysis is rebuilt. Nothing was sent to the client."
      : something
        ? reanalyzeHeadline(state)
        : "Up to date with the client's materials and notes.";

  return (
    <section className="mb-lg rounded-card border border-primary/40 bg-surface" aria-labelledby="reanalyze-title">
      <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md">
        <div className="min-w-0 flex-1">
          <h2 id="reanalyze-title" className="text-h4 text-heading">
            Analysis
          </h2>
          <p className="mt-xs text-body-sm text-body">{headline}</p>
          {lastFactUpdate ? (
            <p className="mt-xs text-body-sm text-muted">
              Last Update Facts: {formatDateAtTime(lastFactUpdate.createdAt)} · {plural(lastFactUpdate.changes.length, "change")}{" "}
              <button
                type="button"
                className="text-primary hover:text-primary-hover"
                onClick={() => setShown(lastFactUpdate)}
              >
                View
              </button>
            </p>
          ) : null}
        </div>
        {busy === null && mode === null ? (
          <div className="flex flex-wrap gap-sm">
            <button
              type="button"
              className={primaryButton}
              disabled={factsDisabledReason !== null}
              title={factsDisabledReason ?? "Correct the facts from the new files and notes. Keeps the narrative, list, copy and decisions."}
              onClick={() => {
                setError(null);
                setMode("facts");
              }}
            >
              Update Facts
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={!claudeReady}
              title="Clear the analysis and rebuild it from scratch."
              onClick={() => {
                setError(null);
                setMode("start_over");
              }}
            >
              Start Over
            </button>
          </div>
        ) : null}
      </div>

      {mode === "facts" || busy === "facts" ? (
        <div className="border-t border-border px-lg py-md">
          <p className="text-body-sm text-heading">Update Facts reads what&apos;s new and corrects the facts everywhere it appears:</p>
          <ul className="mt-sm list-disc space-y-xs pl-lg text-body-sm text-body">
            {state.newFiles > 0 ? <li>{plural(state.newFiles, "new file")} in Company Materials</li> : null}
            {state.newNotes > 0 ? <li>{plural(state.newNotes, "client note")} logged under Client feedback</li> : null}
            <li>
              It checks the intake brief, company brief, match profile, narrative and email copy. Only facts change: numbers, dates,
              names, statuses and wording the client asked for. Points, order, decisions and the investor list stay as they are.
            </li>
            <li>A narrative the client confirmed is updated internally; their portal keeps what they confirmed. Confirmed email copy is never changed.</li>
          </ul>
          <label className="mt-md block text-body-sm text-heading" htmlFor="facts-note">
            Your note (optional)
          </label>
          <textarea
            id="facts-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            disabled={busy !== null}
            placeholder="Anything to make sure of, e.g. “The ask is now $10M; never state a valuation.”"
            className="mt-xs w-full rounded-md border border-border bg-background p-sm text-body-sm text-body outline-none focus:border-primary"
          />
          {error ? (
            <p role="alert" className="mt-sm text-body-sm text-error">
              {error}
            </p>
          ) : null}
          <div className="mt-md flex flex-wrap items-center gap-sm">
            <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void runFacts()}>
              {busy === "facts" ? "Updating Facts…" : "Update Facts"}
            </button>
            {busy === null ? (
              <button type="button" className={secondaryButton} onClick={() => setMode(null)}>
                Cancel
              </button>
            ) : (
              <span className="text-body-sm text-muted">This takes 1–3 minutes; keep this page open. Nothing is sent to the client.</span>
            )}
          </div>
        </div>
      ) : null}

      {mode === "start_over" ? (
        <div className="border-t border-border px-lg py-md">
          <p className="text-body-sm text-heading">Start Over rebuilds the analysis as if nothing had been processed. In order:</p>
          <ol className="mt-sm list-decimal space-y-xs pl-lg text-body-sm text-body">
            {startOver.map((step) => (
              <li key={step.id}>
                <span className="text-heading">{step.label}</span>
                <span className={step.skip ? "text-muted" : step.id === "reset" ? "text-warning" : "text-muted"}>
                  {" "}— {step.skip ? `skipped: ${step.skip}` : step.note}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-sm text-body-sm text-muted">
            The intake, Company Materials, the investor list, email copy and anything the client has seen stay. It takes a few minutes;
            keep this page open. Nothing is sent to the client.
          </p>
          <div className="mt-md flex flex-wrap gap-sm">
            <button type="button" className={primaryButton} onClick={() => void runStartOver()}>
              Start Over
            </button>
            <button type="button" className={secondaryButton} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {progress ? (
        <ol className="divide-y divide-border border-t border-border" aria-live="polite">
          {startOver.map((step) => {
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

      {outcome && busy === null && outcome.matchRerun ? (
        <p className="border-t border-border px-lg py-md text-body-sm text-warning">
          Match needs re-run: the company profile changed since the last match.{" "}
          <Link href={matchPath(clientId, "tiers")} className="text-primary no-underline hover:text-primary-hover">
            Open Matching
          </Link>
        </p>
      ) : null}

      {shown ? <FactsSummary record={shown} onClose={() => setShown(null)} /> : null}
    </section>
  );
}

/** What Update Facts changed: one line per change, with the reason and the source. */
function FactsSummary({ record, onClose }: { record: FactUpdateRecord; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = new Map<string, FactUpdateRecord["changes"]>();
  for (const change of record.changes) {
    groups.set(change.label, [...(groups.get(change.label) ?? []), change]);
  }
  const from = [
    record.sources.files.length > 0 ? `files: ${record.sources.files.join(", ")}` : "",
    record.sources.notes.length > 0 ? `client notes: ${record.sources.notes.join("; ")}` : "",
    record.sources.adminNote ? "your note" : "",
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-heading/30 p-md sm:p-xl" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="facts-summary-title"
        className="w-full max-w-3xl rounded-card border border-border bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-md border-b border-border px-lg py-md">
          <div>
            <h2 id="facts-summary-title" className="text-h4 text-heading">
              Update Facts · {plural(record.changes.length, "change")}
            </h2>
            <p className="mt-xs text-body-sm text-muted">
              {formatDateAtTime(record.createdAt)}
              {from.length > 0 ? ` · from ${from.join(" · ")}` : ""}. Nothing was sent to the client.
            </p>
          </div>
          <button type="button" className={secondaryButton} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="max-h-[70vh] space-y-lg overflow-y-auto px-lg py-md">
          {record.changes.length === 0 ? (
            <p className="text-body-sm text-body">Nothing needed to change: everything already matches the newer materials and notes.</p>
          ) : (
            Array.from(groups.entries()).map(([label, changes]) => (
              <section key={label}>
                <h3 className="text-label uppercase tracking-label text-muted">{label}</h3>
                <ul className="mt-sm space-y-md">
                  {changes.map((change, index) => {
                    const line = changeLine(change);
                    return (
                      <li key={`${change.path}-${index}`} className="text-body-sm">
                        <p className="text-heading">{change.reason}</p>
                        <p className="mt-xs text-muted">
                          <span className="line-through">{line.before}</span>
                          <span className="px-xs">→</span>
                          <span className="text-body">{line.after}</span>
                        </p>
                        {change.source ? <p className="mt-xs text-muted">Source: {change.source}</p> : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
          {record.untouched.length > 0 ? (
            <section>
              <h3 className="text-label uppercase tracking-label text-muted">Not Changed</h3>
              <ul className="mt-sm list-disc space-y-xs pl-lg text-body-sm text-warning">
                {record.untouched.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {record.skipped.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-body-sm text-muted">
                {plural(record.skipped.length, "suggested edit")} Not Applied
              </summary>
              <ul className="mt-sm space-y-sm text-body-sm text-muted">
                {record.skipped.map((edit, index) => (
                  <li key={`${edit.path}-${index}`}>
                    {edit.reason} — {edit.why}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
