"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  finishVerifyBatch,
  getVerifyOverview,
  runVerifyStep,
  startVerification,
} from "@/app/admin/verify-actions";
import {
  cardClass,
  errorText,
  labelClass,
  n,
  primaryButton,
  secondaryButton,
  type Notice,
} from "@/app/admin/clients/[id]/match/ui";
import {
  FinalSummary,
  type ContactUpdate,
} from "@/app/admin/clients/[id]/match/verify/final-summary";
import {
  BatchSummary,
  LiveBatch,
  StatusCounts,
  type BatchRecord,
} from "@/app/admin/clients/[id]/match/verify/verify-parts";
import { formatDateAtTime } from "@/lib/format";
import {
  VERIFY_BATCH_SIZE,
  VERIFY_FRESH_DAYS,
  VERIFY_SCOPES,
  formatDuration,
  formatUsd,
  needsStep,
  type ContactResult,
  type FlaggedChoice,
  type RunState,
  type StepNumber,
  type VerifyContact,
  type VerifyOverview,
  type VerifyScope,
} from "@/lib/match/verify";

type Mode = "setup" | "running" | "paused" | "done";
type Live = { index: number; contacts: VerifyContact[]; step: StepNumber | 4 };

const CHOICES: { value: FlaggedChoice; label: string }[] = [
  { value: "remove", label: "Remove" },
  { value: "keep", label: "Keep" },
  { value: "check", label: "Check again" },
];

function resultMap(run: RunState | null) {
  return new Map((run?.results ?? []).map((result) => [result.contact.id, result]));
}

/** Summaries for batches finished before this page was opened. */
function recordsOf(run: RunState | null, results: Map<string, ContactResult>): BatchRecord[] {
  if (!run) return [];
  return Array.from({ length: Math.min(run.nextBatch, run.batches) }, (_, index) => ({
    index,
    ms: null,
    usd: null,
    results: run.contacts
      .slice(index * run.batchSize, (index + 1) * run.batchSize)
      .map((contact) => results.get(contact.id))
      .filter((result): result is ContactResult => Boolean(result)),
  }));
}

function initialMode(overview: VerifyOverview | null): Mode {
  if (overview?.activeRun) return "paused";
  if (overview?.lastRun) return "done";
  return "setup";
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-md py-sm">
      <p className={labelClass}>{label}</p>
      <p className="mt-xs font-mono text-h4 text-heading">{value}</p>
      {hint ? <p className="text-body-sm text-muted">{hint}</p> : null}
    </div>
  );
}

function SetupPanel({
  overview,
  busy,
  onStart,
}: {
  overview: VerifyOverview;
  busy: boolean;
  onStart: (scope: VerifyScope, choices: { id: string; choice: FlaggedChoice }[]) => void;
}) {
  const [scope, setScope] = useState<VerifyScope>("all");
  const [choices, setChoices] = useState<Record<string, FlaggedChoice>>({});
  const count = overview.scopes[scope];
  const flagged = overview.flagged.filter((item) => item.scopes.includes(scope));
  const choiceOf = (id: string) => choices[id] ?? "remove";
  const checkAgain = flagged.filter((item) => choiceOf(item.contact.id) === "check").length;
  const toCheck = count.toCheck + checkAgain;
  const batches = Math.ceil(toCheck / VERIFY_BATCH_SIZE);
  const { estimate } = overview;
  const canStart = overview.claudeReady && toCheck + count.reused > 0;

  return (
    <section className={`${cardClass} px-lg py-md`}>
      <h2 className="text-h4 text-heading">What to check</h2>
      <div className="mt-sm grid gap-sm md:grid-cols-3" role="radiogroup" aria-label="Contacts to check">
        {VERIFY_SCOPES.map((item) => {
          const active = item.key === scope;
          const scopeCount = overview.scopes[item.key];
          return (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={active}
              className={`rounded-card border px-md py-md text-left transition-colors duration-hover ${
                active ? "border-primary bg-primary-tint" : "border-border bg-surface hover:border-primary/40"
              }`}
              onClick={() => setScope(item.key)}
            >
              <span className="block text-body-sm text-heading">{item.label}</span>
              <span className="block text-body-sm text-muted">{item.description}</span>
              <span className="mt-xs block font-mono text-body-sm text-secondary">{n(scopeCount.total)} contacts</span>
            </button>
          );
        })}
      </div>

      <div className="mt-md grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="To check" value={n(toCheck)} hint={`${n(batches)} batch${batches === 1 ? "" : "es"} of ${VERIFY_BATCH_SIZE}`} />
        <Fact label="Reused" value={n(count.reused)} hint={`Checked in the last ${VERIFY_FRESH_DAYS} days`} />
        <Fact
          label="Estimated time"
          value={batches > 0 ? formatDuration(batches * estimate.msPerBatch) : "—"}
          hint="Keep this tab open"
        />
        <Fact
          label="Estimated cost"
          value={formatUsd(toCheck * estimate.usdPerContact)}
          hint={`${estimate.measured ? "From past checks" : "First-run guess"} · up to ${n(toCheck)} Hunter credits`}
        />
      </div>
      <p className="mt-sm text-body-sm text-muted">
        {n(count.total)} contacts with an email in this scope
        {count.flagged > 0 ? ` · ${n(count.flagged)} removed before (decide below)` : ""}
        {count.noEmail > 0 ? ` · ${n(count.noEmail)} investing contacts have no email and are left out` : ""}.
      </p>

      {!overview.claudeReady ? (
        <p role="alert" className="mt-sm text-body-sm text-error">
          ANTHROPIC_API_KEY is not configured, so steps 1 and 2 can&apos;t run.
        </p>
      ) : null}
      {!overview.hunterReady ? (
        <p className="mt-sm text-body-sm text-warning">
          HUNTER_API_KEY is not configured: step 3 will mark contacts Unknown instead of checking the mailbox.
        </p>
      ) : null}

      {flagged.length > 0 ? (
        <div className="mt-md">
          <h3 className="text-h4 text-heading">Decided before · {n(flagged.length)}</h3>
          <p className="text-body-sm text-muted">
            These people were removed for another client. Decide now and skip the search, or check them again.
          </p>
          <ul className="mt-sm space-y-sm">
            {flagged.map((item) => (
              <li
                key={item.contact.id}
                className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-border bg-background px-md py-sm text-body-sm"
              >
                <span className="min-w-0">
                  <span className="text-heading">{item.contact.name}</span>
                  <span className="text-muted">
                    {" "}
                    · {item.contact.firmName} · {item.contact.email}
                  </span>
                  <span className="block text-secondary">
                    Removed: {item.reason} · {formatDateAtTime(item.flaggedAt)}
                  </span>
                </span>
                <span className="flex gap-xs" role="radiogroup" aria-label={`Decision for ${item.contact.name}`}>
                  {CHOICES.map((choice) => {
                    const active = choiceOf(item.contact.id) === choice.value;
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={
                          active
                            ? "rounded-md bg-primary px-sm py-xs text-body-sm text-white"
                            : "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary hover:text-heading"
                        }
                        onClick={() => setChoices((current) => ({ ...current, [item.contact.id]: choice.value }))}
                      >
                        {choice.label}
                      </button>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-md">
        <button
          type="button"
          className={primaryButton}
          disabled={busy || !canStart}
          onClick={() =>
            onStart(
              scope,
              flagged.map((item) => ({ id: item.contact.id, choice: choiceOf(item.contact.id) })),
            )
          }
        >
          {busy
            ? "Starting…"
            : toCheck > 0
              ? `Start: ${n(toCheck)} contact${toCheck === 1 ? "" : "s"} in ${n(batches)} batch${batches === 1 ? "" : "es"}`
              : "Show results"}
        </button>
      </div>
    </section>
  );
}

export function VerifyWorkspace({
  clientId,
  initialOverview,
  initialError,
}: {
  clientId: string;
  initialOverview: VerifyOverview | null;
  initialError: string | null;
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [run, setRun] = useState<RunState | null>(initialOverview?.activeRun ?? initialOverview?.lastRun ?? null);
  const [results, setResults] = useState(() => resultMap(run));
  const [records, setRecords] = useState<BatchRecord[]>(() => recordsOf(run, results));
  const [mode, setMode] = useState<Mode>(() => initialMode(initialOverview));
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [pauseRequested, setPauseRequested] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(initialError ? { kind: "error", text: initialError } : null);
  const pauseRef = useRef(false);
  const resultsRef = useRef(results);
  resultsRef.current = results;

  // Leaving the page stops the run after the current request; warn first.
  useEffect(() => {
    if (mode !== "running") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [mode]);

  async function execute(start: RunState) {
    pauseRef.current = false;
    setPauseRequested(false);
    setNotice(null);
    setMode("running");
    const merged = new Map(resultsRef.current);
    const publish = () => setResults(new Map(merged));
    let stats = start.stats;

    for (let batch = start.nextBatch; batch < start.batches; batch += 1) {
      if (pauseRef.current) {
        setLive(null);
        setMode("paused");
        return;
      }
      const contacts = start.contacts.slice(batch * start.batchSize, (batch + 1) * start.batchSize);
      const startedAt = Date.now();
      try {
        for (const step of [1, 2, 3] as StepNumber[]) {
          setLive({ index: batch, contacts, step });
          const pending = contacts.filter((contact) => needsStep(merged.get(contact.id)?.steps ?? {}, step));
          if (pending.length === 0) continue;
          const done = await runVerifyStep(clientId, start.id, batch, step);
          if (!done.ok) throw new Error(done.error);
          done.results.forEach((result) => merged.set(result.contact.id, result));
          publish();
        }
        setLive({ index: batch, contacts, step: 4 });
        const ms = Date.now() - startedAt;
        const closed = await finishVerifyBatch(clientId, start.id, batch, ms);
        if (!closed.ok) throw new Error(closed.error);
        closed.batch.results.forEach((result) => merged.set(result.contact.id, result));
        publish();
        const usd = Math.max(0, closed.batch.stats.usd - stats.usd);
        stats = closed.batch.stats;
        setRecords((current) => [
          ...current.filter((record) => record.index !== batch),
          { index: batch, results: closed.batch.results, ms, usd },
        ]);
        setRun((current) =>
          current
            ? { ...current, nextBatch: closed.batch.nextBatch, status: closed.batch.status, stats: closed.batch.stats }
            : current,
        );
        if (closed.batch.status !== "active") break;
      } catch (err) {
        setLive(null);
        setMode("paused");
        setNotice({
          kind: "error",
          text: `Batch ${n(batch + 1)} stopped: ${errorText(err, "a step failed")}. Resume to try it again; finished steps are kept.`,
        });
        return;
      }
    }
    setLive(null);
    setMode("done");
  }

  async function start(scope: VerifyScope, choices: { id: string; choice: FlaggedChoice }[]) {
    if (
      overview?.activeRun &&
      !window.confirm("This cancels the unfinished run. Its finished checks are kept and reused. Start a new run?")
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const started = await startVerification(clientId, scope, choices);
      if (!started.ok) {
        setNotice({ kind: "error", text: started.error });
        return;
      }
      const next = started.run;
      const map = resultMap(next);
      resultsRef.current = map;
      setRun(next);
      setResults(map);
      setRecords([]);
      setOverview((current) => (current ? { ...current, activeRun: next.status === "active" ? next : null } : current));
      if (next.status === "active") void execute(next);
      else setMode("done");
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "The verification could not start.") });
    } finally {
      setBusy(false);
    }
  }

  async function newRun() {
    setBusy(true);
    setNotice(null);
    try {
      const loaded = await getVerifyOverview(clientId);
      if (!loaded.ok) {
        setNotice({ kind: "error", text: loaded.error });
        return;
      }
      setOverview(loaded.overview);
      setMode("setup");
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "The verification could not be loaded.") });
    } finally {
      setBusy(false);
    }
  }

  function applyUpdates(updates: ContactUpdate[]) {
    setResults((current) => {
      const next = new Map(current);
      for (const update of updates) {
        const result = next.get(update.id);
        if (result) {
          next.set(update.id, {
            ...result,
            decision: update.decision ?? result.decision,
            corrected: result.corrected || update.corrected,
          });
        }
      }
      return next;
    });
  }

  const allResults = useMemo(() => Array.from(results.values()), [results]);
  const checked = allResults.filter((result) => result.status && !result.reused).length;
  const toCheckTotal = run?.contacts.length ?? 0;
  const progress = toCheckTotal > 0 ? Math.round((Math.min(run?.nextBatch ?? 0, run?.batches ?? 0) / (run?.batches || 1)) * 100) : 100;

  return (
    <div className="space-y-lg">
      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-card border bg-surface px-lg py-md text-body-sm ${
            notice.kind === "error" ? "border-error/40 text-error" : "border-success/40 text-success"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {!overview && !run ? (
        <p className={`${cardClass} px-lg py-md text-body-sm text-muted`}>
          Verification is not available until the match can run.{" "}
          <Link href={`/admin/clients/${clientId}/match`} className="text-primary hover:text-primary-hover">
            Open Rupert Match
          </Link>
        </p>
      ) : null}

      {mode === "setup" && overview ? <SetupPanel overview={overview} busy={busy} onStart={(scope, choices) => void start(scope, choices)} /> : null}

      {run && (mode === "running" || mode === "paused") ? (
        <section className={`${cardClass} px-lg py-md`}>
          <div className="flex flex-wrap items-start justify-between gap-md">
            <div>
              <p className={labelClass}>{mode === "running" ? "Verifying" : "Paused"}</p>
              <p className="mt-xs text-h4 text-heading">
                {mode === "running"
                  ? `Batch ${n(Math.min(run.nextBatch + 1, run.batches))} of ${n(run.batches)}`
                  : `${n(run.nextBatch)} of ${n(run.batches)} batches done`}{" "}
                · {n(checked)} of {n(toCheckTotal)} contacts checked
              </p>
              <p className="font-mono text-body-sm text-muted">
                {formatUsd(run.stats.usd)} · {n(run.stats.searches)} searches · {n(run.stats.hunter)} Hunter credits · started{" "}
                {formatDateAtTime(run.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-sm">
              {mode === "running" ? (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={pauseRequested}
                  onClick={() => {
                    pauseRef.current = true;
                    setPauseRequested(true);
                  }}
                >
                  {pauseRequested ? "Pausing after this batch…" : "Pause"}
                </button>
              ) : (
                <>
                  <button type="button" className={primaryButton} onClick={() => void execute(run)}>
                    Resume
                  </button>
                  <button type="button" className={secondaryButton} disabled={busy} onClick={() => void newRun()}>
                    Start over
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="mt-md h-1.5 rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-sm">
            <StatusCounts results={allResults.filter((result) => result.status)} />
          </div>
          {mode === "paused" ? (
            <p className="mt-sm text-body-sm text-muted">Finished batches and steps are saved. Resume continues with the next one.</p>
          ) : null}
        </section>
      ) : null}

      {live && mode === "running" && run ? (
        <LiveBatch index={live.index} batches={run.batches} contacts={live.contacts} results={results} step={live.step} />
      ) : null}

      {mode === "done" && run ? (
        <>
          <FinalSummary
            key={run.id}
            clientId={clientId}
            title={`Summary · run of ${formatDateAtTime(run.createdAt)}`}
            results={allResults}
            stats={run.stats}
            onUpdated={applyUpdates}
          />
          <div className="flex flex-wrap gap-sm">
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => void newRun()}>
              {busy ? "Loading…" : "Start a new run"}
            </button>
            <Link href={`/admin/clients/${clientId}/match`} className={`${secondaryButton} no-underline`}>
              Back to the match
            </Link>
          </div>
        </>
      ) : null}

      {records.length > 0 && mode !== "setup" ? (
        mode === "done" ? (
          <details className={`${cardClass} px-lg py-md`}>
            <summary className="cursor-pointer text-label uppercase tracking-label text-secondary">
              Batch summaries ({n(records.length)})
            </summary>
            <div className="mt-md space-y-sm">
              {records.map((record) => (
                <BatchSummary key={record.index} record={record} batches={run?.batches ?? records.length} />
              ))}
            </div>
          </details>
        ) : (
          <div className="space-y-sm">
            {records.map((record) => (
              <BatchSummary key={record.index} record={record} batches={run?.batches ?? records.length} />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
