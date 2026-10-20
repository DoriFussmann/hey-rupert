"use client";

import { cardClass, labelClass, n } from "@/app/admin/clients/[id]/match/ui";
import {
  STEP_LABEL,
  VERIFY_LABEL,
  VERIFY_STEPS,
  VERIFY_STATUSES,
  VERIFY_TONE,
  formatDuration,
  formatUsd,
  needsStep,
  type CheckSteps,
  type ContactResult,
  type Evidence,
  type StepNumber,
  type VerifyContact,
  type VerifyState,
  type VerifyStatus,
} from "@/lib/match/verify";

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-xs text-primary">
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function StatusBadge({ state }: { state: VerifyState }) {
  return <span className={`whitespace-nowrap text-body-sm ${VERIFY_TONE[state]}`}>{VERIFY_LABEL[state]}</span>;
}

export function EvidenceLinks({ items }: { items: Evidence[] }) {
  if (items.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-sm">
      {items.map((item, index) => (
        <a
          key={`${item.url}-${index}`}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary-hover"
          title={item.note || item.url}
        >
          Source {index + 1} ↗
        </a>
      ))}
    </span>
  );
}

/** Every evidence link across the steps, step 1 first. */
export function evidenceOf(steps: CheckSteps): Evidence[] {
  return [...(steps.role?.evidence ?? []), ...(steps.public?.evidence ?? [])].slice(0, 4);
}

/** The one sentence that explains a result best. */
export function reasonOf(result: ContactResult) {
  const { steps } = result;
  if (result.suggestion?.why && result.status !== "clean") return result.suggestion.why;
  if (steps.public?.result === "found") return steps.public.summary;
  if (steps.mailbox?.summary) return steps.mailbox.summary;
  return steps.role?.summary ?? "";
}

type CellTone = "ok" | "warn" | "bad" | "muted";

const TONE_CLASS: Record<CellTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-error",
  muted: "text-muted",
};

function stepOutcome(steps: CheckSteps, step: StepNumber): { text: string; tone: CellTone } | null {
  if (step === 1 && steps.role) {
    const map = {
      confirmed: { text: "At the firm", tone: "ok" },
      role_changed: { text: "Other role", tone: "warn" },
      left_firm: { text: "Left the firm", tone: "bad" },
      not_found: { text: "Not found", tone: "warn" },
      error: { text: "Error", tone: "bad" },
    } as const;
    return map[steps.role.result];
  }
  if (step === 2 && steps.public) {
    const map = {
      found: { text: "Public match", tone: "ok" },
      not_found: { text: "Not public", tone: "muted" },
      error: { text: "Error", tone: "bad" },
    } as const;
    return map[steps.public.result];
  }
  if (step === 3 && steps.mailbox) {
    const map = {
      valid: { text: "Valid", tone: "ok" },
      invalid: { text: "Invalid", tone: "bad" },
      accept_all: { text: "Accepts all", tone: "warn" },
      webmail: { text: "Webmail", tone: "warn" },
      disposable: { text: "Disposable", tone: "bad" },
      unknown: { text: "Unknown", tone: "warn" },
      error: { text: "Error", tone: "bad" },
    } as const;
    return map[steps.mailbox.result];
  }
  return null;
}

export type StepPhase = "waiting" | "running" | "done";

/** A step that will not run: the person left, or an older check found the email public. */
function isSkipped(steps: CheckSteps, step: StepNumber) {
  if (step === 1) return false;
  if (steps.role?.result === "left_firm") return true;
  return step === 3 && steps.public?.result === "found";
}

function StepCell({ steps, step, phase }: { steps: CheckSteps; step: StepNumber; phase: StepPhase }) {
  const outcome = stepOutcome(steps, step);
  if (outcome) {
    const detail =
      step === 1 ? steps.role?.summary : step === 2 ? steps.public?.summary : steps.mailbox?.summary;
    return (
      <span className={TONE_CLASS[outcome.tone]} title={detail || undefined}>
        {outcome.text}
      </span>
    );
  }
  if (isSkipped(steps, step)) return <span className="text-muted">Skipped</span>;
  if (phase === "running" && needsStep(steps, step)) return <Spinner label={`${STEP_LABEL[step]} running`} />;
  if (phase === "waiting") return <span className="text-muted">Waiting</span>;
  return <span className="text-muted">—</span>;
}

/** The batch being checked: one row per contact, one column per step. */
export function LiveBatch({
  index,
  batches,
  contacts,
  results,
  step,
}: {
  index: number;
  batches: number;
  contacts: VerifyContact[];
  results: Map<string, ContactResult>;
  /** The step running now; 4 while the batch is being closed. */
  step: StepNumber | 4;
}) {
  const phaseOf = (target: StepNumber): StepPhase =>
    step > target ? "done" : step === target ? "running" : "waiting";
  return (
    <section className={`${cardClass} border-primary/40`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-sm border-b border-border px-lg py-md">
        <h2 className="text-h4 text-heading">
          Batch {n(index + 1)} of {n(batches)}
        </h2>
        <span className="flex items-center gap-sm text-body-sm text-primary">
          <Spinner label="Checking" />
          {step === 4 ? "Saving the batch…" : `Step ${VERIFY_STEPS.indexOf(step) + 1}: ${STEP_LABEL[step]}`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-body-sm">
          <thead className="bg-background">
            <tr className="text-label uppercase tracking-label text-muted">
              <th className="px-lg py-sm font-medium">Contact</th>
              {VERIFY_STEPS.map((item, position) => (
                <th key={item} className="px-md py-sm font-medium">
                  {position + 1}. {STEP_LABEL[item]}
                </th>
              ))}
              <th className="px-md py-sm font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => {
              const result = results.get(contact.id);
              const steps = result?.steps ?? {};
              return (
                <tr key={contact.id} className="border-t border-border align-top">
                  <td className="px-lg py-sm">
                    <p className="text-heading">{contact.name}</p>
                    <p className="text-muted">
                      {contact.firmName} · {contact.email}
                    </p>
                  </td>
                  {VERIFY_STEPS.map((item) => (
                    <td key={item} className="px-md py-sm">
                      <StepCell steps={steps} step={item} phase={phaseOf(item)} />
                    </td>
                  ))}
                  <td className="px-md py-sm">
                    {result?.status ? <StatusBadge state={result.status} /> : <span className="text-muted">…</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function countStatuses(results: ContactResult[]) {
  const counts = new Map<VerifyStatus | "unchecked", number>();
  for (const result of results) {
    const key = result.status ?? "unchecked";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function StatusCounts({ results }: { results: ContactResult[] }) {
  const counts = countStatuses(results);
  return (
    <span className="flex flex-wrap gap-x-md gap-y-xs text-body-sm">
      {VERIFY_STATUSES.filter((status) => counts.get(status)).map((status) => (
        <span key={status} className={VERIFY_TONE[status]}>
          {n(counts.get(status) ?? 0)} {VERIFY_LABEL[status]}
        </span>
      ))}
      {counts.get("unchecked") ? (
        <span className="text-error">{n(counts.get("unchecked") ?? 0)} not checked</span>
      ) : null}
    </span>
  );
}

export type BatchRecord = {
  index: number;
  results: ContactResult[];
  /** Known only for batches run in this browser session. */
  ms: number | null;
  usd: number | null;
};

/** The small window shown after each batch. */
export function BatchSummary({ record, batches }: { record: BatchRecord; batches: number }) {
  return (
    <section className={`${cardClass} px-lg py-md`}>
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <p className={labelClass}>
          Batch {n(record.index + 1)} of {n(batches)}
        </p>
        {record.ms != null && record.usd != null ? (
          <p className="font-mono text-body-sm text-muted">
            {formatDuration(record.ms)} · {formatUsd(record.usd)}
          </p>
        ) : null}
      </div>
      <div className="mt-xs">
        <StatusCounts results={record.results} />
      </div>
      <ul className="mt-sm space-y-xs text-body-sm">
        {record.results.map((result) => (
          <li key={result.contact.id} className="grid gap-x-sm sm:grid-cols-[minmax(0,14rem)_7rem_1fr]">
            <span className="truncate text-heading" title={`${result.contact.name} · ${result.contact.firmName}`}>
              {result.contact.name} <span className="text-muted">· {result.contact.firmName}</span>
            </span>
            {result.status ? <StatusBadge state={result.status} /> : <span className="text-error">Not checked</span>}
            <span className="min-w-0 text-secondary">
              {reasonOf(result)} <EvidenceLinks items={evidenceOf(result.steps)} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
