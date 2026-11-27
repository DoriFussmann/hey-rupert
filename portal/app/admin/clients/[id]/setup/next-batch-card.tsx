"use client";

import { useState } from "react";
import { checkNextBatchAction, type BatchCheckSummary } from "@/app/admin/outreach-live-actions";
import { secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import type { LiveState } from "@/lib/outreach/live-server";
import { formatDateTime } from "@/lib/format";
import { spareFor } from "@/lib/outreach/presend";

const dayText = (day: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-[14px] w-[14px] animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]"
    />
  );
}

/**
 * The next send day's batch: how many investors it takes (warm-up or full pace), how many passed the
 * pre-send email check, and the button that checks it (web search, then Hunter), with progress and a
 * summary. Short after a check: load more contacts from the list and check them.
 */
export function NextBatchCard({
  clientId,
  state,
  disabled,
  onState,
}: {
  clientId: string;
  state: LiveState;
  disabled: boolean;
  onState: (state: LiveState) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [summary, setSummary] = useState<BatchCheckSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const batch = state.nextBatch;
  const complete = batch.ready >= batch.room;
  const short = batch.room > 0 && !complete;
  const checkedOnce = Boolean(summary || state.presend.lastAt);

  async function check() {
    setChecking(true);
    setError(null);
    try {
      const result = await checkNextBatchAction(clientId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onState(result.state);
      setSummary((result as { summary?: BatchCheckSummary }).summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The check stopped. Try again.");
    } finally {
      setChecking(false);
    }
  }

  const label = checking
    ? "Checking…"
    : !checkedOnce || batch.ready === 0
      ? "Check Next Batch"
      : short && batch.unchecked > 0
        ? "Load More Leads and Check"
        : "Check Again";

  return (
    <div className="mt-md rounded-card border border-border bg-surface px-md py-md text-body-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <div>
          <p className="text-label uppercase tracking-label text-muted">Next Batch</p>
          <p className="mt-xs text-body text-heading">
            {dayText(batch.day)} · {batch.warmup ? `Warm-up, week ${batch.week}` : "Full pace"} · {batch.room} new investor{batch.room === 1 ? "" : "s"}
          </p>
          <p className="text-muted">
            Up to {batch.cap} emails that day, follow-ups first. Only contacts that pass the check (web search, then Hunter) are added.
          </p>
        </div>
        <p className={`font-mono text-h3 ${complete ? "text-success" : "text-heading"}`}>
          {batch.ready} / {batch.room}
          <span className="ml-xs text-body-sm font-sans text-muted">ready</span>
        </p>
      </div>

      <div className="mt-sm flex flex-wrap items-center gap-sm">
        <button type="button" className={secondaryButton} disabled={disabled || checking || (complete && checkedOnce)} onClick={() => void check()}>
          {checking ? <Spinner /> : null} {label}
        </button>
        <span className="text-muted">
          {checking
            ? `Checking about ${batch.room + spareFor(batch.room)} contacts (the batch plus spares). A few minutes; keep this page open.`
            : complete
              ? "The batch is full."
              : batch.unchecked === 0 && batch.ready > 0
                ? `The list has no more contacts to check for this day: Add Leads adds the ${batch.ready} ready.`
                : `${batch.unchecked} more in line, not checked yet.`}
          {!checking && state.presend.lastAt ? ` Last check ${formatDateTime(state.presend.lastAt)}.` : ""}
        </span>
      </div>

      {error ? (
        <p role="alert" className="mt-sm text-error">
          {error}
        </p>
      ) : null}

      {summary && !checking ? (
        <div className="mt-sm rounded-md border border-border px-md py-sm">
          <p className="text-heading">
            {summary.ready} of {summary.room} ready. Passed by web search: {summary.byWeb} · by Hunter: {summary.byHunter}
            {summary.reused ? ` · already proven: ${summary.reused}` : ""} · didn&apos;t pass: {summary.failed.length}
            {summary.usd ? ` · cost $${summary.usd.toFixed(2)}` : ""}.
          </p>
          {summary.failed.length ? (
            <ul className="mt-xs list-disc pl-lg text-secondary">
              {summary.failed.slice(0, 12).map((f, i) => (
                <li key={`${f.person}-${i}`}>
                  {f.person}, {f.fund}
                  {f.replacement ? " (replacement)" : ""}: {f.reason}
                  {f.replacedBy ? ` Replaced by ${f.replacedBy}.` : ""}
                </li>
              ))}
              {summary.failed.length > 12 ? <li>…and {summary.failed.length - 12} more (in the summary email).</li> : null}
            </ul>
          ) : null}
          {summary.replacements.length ? (
            <p className="mt-xs text-secondary">
              Replacements at the same fund: {summary.replacements.map((r) => `${r.person} (${r.fund})`).join(", ")}.
            </p>
          ) : null}
          {summary.outOfTime ? <p className="mt-xs text-warning">Ran out of time: click again to check the rest.</p> : null}
          {summary.errors.length ? <p className="mt-xs text-warning">Errors: {summary.errors.join(" · ")}</p> : null}
          {summary.ready < summary.room && !summary.outOfTime ? (
            <p className="mt-xs text-warning">
              Short by {summary.room - summary.ready}.{" "}
              {batch.unchecked > 0 ? "Click Load More Leads and Check to take the next contacts on the list." : "The list has nothing more to check for this day."}
            </p>
          ) : null}
          <p className="mt-xs text-muted">The full summary was emailed to you.</p>
        </div>
      ) : null}
    </div>
  );
}
