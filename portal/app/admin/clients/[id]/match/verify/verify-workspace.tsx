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
import { matchPath } from "@/lib/match/shared";
import {
  ESTIMATE_MIN_CHECKS,
  VERIFY_BATCH_SIZE,
  VERIFY_FRESH_DAYS,
  VERIFY_MODES,
  VERIFY_MODE_LABEL,
  VERIFY_STEPS,
  contactsForFunds,
  countTier,
  scopeLabel,
  formatDuration,
  formatUsd,
  needsStep,
  parseTierLimit,
  type ContactResult,
  type FlaggedChoice,
  type RunState,
  type StepNumber,
  type TierLimits,
  type VerifyContact,
  type VerifyMode,
  type VerifyOverview,
} from "@/lib/match/verify";

type Mode = "setup" | "running" | "paused" | "done";

const MODE_HINT: Record<VerifyMode, string> = {
  all: "(everyone with an email)",
  sequence: "(the two people outreach goes to)",
  primary: "(the first person outreach goes to)",
};
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

/** The tier boxes to start from: every tier in full, or only the tier asked for. */
function initialBoxes(overview: VerifyOverview, onlyTier: string | null) {
  if (!onlyTier || !overview.tiers.some((tier) => tier.key === onlyTier)) return {};
  return Object.fromEntries(overview.tiers.map(({ key }) => [key, key === onlyTier ? "" : "0"]));
}

function SetupPanel({
  overview,
  busy,
  onlyTier,
  onStart,
}: {
  overview: VerifyOverview;
  busy: boolean;
  /** Opened from a tier's "Verify these funds": only that tier is filled in. */
  onlyTier: string | null;
  onStart: (mode: VerifyMode, limits: TierLimits, choices: { id: string; choice: FlaggedChoice }[]) => void;
}) {
  const [mode, setMode] = useState<VerifyMode>("sequence");
  // Blank boxes: every fund of the tier.
  const [boxes, setBoxes] = useState<Record<string, string>>(() => initialBoxes(overview, onlyTier));
  const [choices, setChoices] = useState<Record<string, FlaggedChoice>>({});

  const parsed = overview.tiers.map(({ key }) => ({ tier: key, limit: parseTierLimit(boxes[key] ?? "") }));
  const invalid = parsed.filter((item) => item.limit === "invalid").map((item) => item.tier);
  const limits = Object.fromEntries(
    parsed.map((item) => [item.tier, item.limit === "invalid" ? 0 : item.limit]),
  ) as TierLimits;
  const empty = { total: 0, fundEnds: [], order: "", noEmail: 0 };
  const perTier = overview.tiers.map(({ key, label }) => ({
    tier: key,
    label,
    count: overview.counts[mode][key] ?? empty,
    counted: countTier(overview.counts[mode][key] ?? empty, limits[key] ?? null),
  }));
  const counted = perTier.reduce(
    (sum, item) => ({
      contacts: sum.contacts + item.counted.contacts,
      toCheck: sum.toCheck + item.counted.toCheck,
      reused: sum.reused + item.counted.reused,
    }),
    { contacts: 0, toCheck: 0, reused: 0 },
  );
  const noEmail = perTier.reduce((sum, item) => sum + item.count.noEmail, 0);

  const flagged = overview.flagged.filter((item) => {
    const position = item.positions[mode];
    const count = overview.counts[mode][item.contact.tier] ?? empty;
    const limit = contactsForFunds(count.fundEnds, limits[item.contact.tier] ?? null);
    return position !== undefined && (limit === null || position < limit);
  });
  const choiceOf = (id: string) => choices[id] ?? "remove";
  const checkAgain = flagged.filter((item) => choiceOf(item.contact.id) === "check").length;
  const toCheck = counted.toCheck + checkAgain;
  const batches = Math.ceil(toCheck / VERIFY_BATCH_SIZE);
  const { estimate } = overview;
  const canStart = overview.claudeReady && invalid.length === 0 && toCheck + counted.reused > 0;

  return (
    <section className={`${cardClass} px-lg py-md`}>
      <h2 className="text-h4 text-heading">What to Check</h2>
      <p className="mt-xs text-body-sm text-muted">
        How many funds per tier, best fit first. Leave a box blank for every fund in the tier, or put 0 to skip it.
      </p>

      <fieldset className="mt-md">
        <legend className={labelClass}>Contacts at each fund</legend>
        <div className="mt-sm flex flex-wrap gap-md text-body-sm text-heading">
          {VERIFY_MODES.map((value) => (
            <label key={value} className="flex items-center gap-xs">
              <input
                type="radio"
                name="verify-mode"
                className="h-4 w-4 accent-primary"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {VERIFY_MODE_LABEL[value]}
              <span className="text-muted">{MODE_HINT[value]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={`mt-md grid gap-sm ${perTier.length === 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}`}>
        {perTier.map(({ tier, label, count, counted: tierCount }) => {
          const bad = invalid.includes(tier);
          return (
            <label key={tier} className="rounded-card border border-border bg-background px-md py-md">
              <span className={labelClass}>{label}</span>
              <input
                inputMode="numeric"
                className={`mt-sm w-full rounded-md border bg-surface px-sm py-sm font-mono text-body text-body outline-none focus:border-primary ${
                  bad ? "border-error" : "border-border"
                }`}
                placeholder={`All (${n(count.fundEnds.length)} funds)`}
                value={boxes[tier] ?? ""}
                aria-invalid={bad}
                aria-label={`${label}: how many funds to check`}
                onChange={(event) => setBoxes((current) => ({ ...current, [tier]: event.target.value }))}
              />
              <span className={`mt-xs block text-body-sm ${bad ? "text-error" : "text-muted"}`}>
                {bad
                  ? "A whole number, or blank for all."
                  : `${n(tierCount.funds)} funds · ${n(tierCount.contacts)} contacts · ${n(tierCount.toCheck)} to check · ${n(tierCount.reused)} reused`}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-md grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="To check" value={n(toCheck)} hint={`${n(batches)} batch${batches === 1 ? "" : "es"} of ${VERIFY_BATCH_SIZE}`} />
        <Fact label="Reused" value={n(counted.reused)} hint={`Checked in the last ${VERIFY_FRESH_DAYS} days, no cost`} />
        <Fact
          label="Estimated cost"
          value={formatUsd(toCheck * estimate.usdPerContact)}
          hint={
            estimate.measured
              ? `${formatUsd(estimate.usdPerContact)} per contact, average of ${n(estimate.sample)} recent checks`
              : `${formatUsd(estimate.usdPerContact)} per contact, a starting estimate until ${ESTIMATE_MIN_CHECKS} checks are measured`
          }
        />
        <Fact
          label="Hunter credits"
          value={`~${n(toCheck)}`}
          hint="From your Hunter plan: 1 per contact, 2 when a replacement email is looked up"
        />
      </div>
      <p className="mt-sm text-body-sm text-muted">
        Estimated time {batches > 0 ? formatDuration(batches * estimate.msPerBatch) : "—"}; keep this tab open while it
        runs.
        {flagged.length > 0 ? ` ${n(flagged.length)} removed before: decide below.` : ""}
        {mode === "all" && noEmail > 0 ? ` ${n(noEmail)} investing contacts have no email and are left out.` : ""}
      </p>

      {!overview.claudeReady ? (
        <p role="alert" className="mt-sm text-body-sm text-error">
          ANTHROPIC_API_KEY is not configured, so step 1 can&apos;t run.
        </p>
      ) : null}
      {!overview.hunterReady ? (
        <p className="mt-sm text-body-sm text-warning">
          HUNTER_API_KEY is not configured: the mailbox check will mark contacts Unknown.
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
              mode,
              limits,
              flagged.map((item) => ({ id: item.contact.id, choice: choiceOf(item.contact.id) })),
            )
          }
        >
          {busy
            ? "Starting…"
            : toCheck > 0
              ? `Run: ${n(toCheck)} contact${toCheck === 1 ? "" : "s"}, about ${formatUsd(toCheck * estimate.usdPerContact)}`
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
  onlyTier = null,
}: {
  clientId: string;
  initialOverview: VerifyOverview | null;
  initialError: string | null;
  /** Start with only this tier filled in (from a tier's "Verify these funds"). */
  onlyTier?: string | null;
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
        for (const step of VERIFY_STEPS) {
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

  async function start(mode: VerifyMode, limits: TierLimits, choices: { id: string; choice: FlaggedChoice }[]) {
    if (
      overview?.activeRun &&
      !window.confirm("This cancels the unfinished run. Its finished checks are kept and reused. Start a new run?")
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const started = await startVerification(clientId, mode, limits, choices);
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
          <Link href={matchPath(clientId)} className="text-primary hover:text-primary-hover">
            Open Matching
          </Link>
        </p>
      ) : null}

      {mode === "setup" && overview ? <SetupPanel overview={overview} busy={busy} onlyTier={onlyTier} onStart={(mode, limits, choices) => void start(mode, limits, choices)} /> : null}

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
                {scopeLabel(run.scope)} · {formatUsd(run.stats.usd)} · {n(run.stats.searches)} searches · {n(run.stats.hunter)} Hunter
                credits · started {formatDateAtTime(run.createdAt)}
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
            <p className="mt-sm text-body-sm text-muted">
              Finished batches and steps are saved. Act on the contacts below now, or leave and Resume later.
            </p>
          ) : null}
        </section>
      ) : null}

      {mode === "paused" && run ? (
        <FinalSummary
          key={`paused-${run.id}`}
          clientId={clientId}
          title="Needs action so far · run paused"
          results={allResults.filter((result) => result.status)}
          stats={run.stats}
          onUpdated={applyUpdates}
        />
      ) : null}

      {live && mode === "running" && run ? (
        <LiveBatch index={live.index} batches={run.batches} contacts={live.contacts} results={results} step={live.step} />
      ) : null}

      {mode === "done" && run ? (
        <>
          <FinalSummary
            key={run.id}
            clientId={clientId}
            title={`Summary · run of ${formatDateAtTime(run.createdAt)} · ${scopeLabel(run.scope)}`}
            results={allResults}
            stats={run.stats}
            onUpdated={applyUpdates}
          />
          <div className="flex flex-wrap gap-sm">
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => void newRun()}>
              {busy ? "Loading…" : "Start a new run"}
            </button>
            <Link href={matchPath(clientId, "tiers")} className={`${secondaryButton} no-underline`}>
              Back to the Tiers
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
