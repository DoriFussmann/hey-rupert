"use client";

import { useState } from "react";
import {
  updateChecklistStatus,
  updateOnboardingTimestamp,
} from "@/app/admin/actions";
import {
  CHECKLIST_STATUS_VALUES,
  LIVE_ITEMS,
  ONBOARDING_TOGGLES,
  SETUP_ITEMS,
  parseChecklistStatus,
  type ChecklistStatus,
  type ChecklistStatusColumn,
  type ChecklistStatuses,
  type OnboardingTimestampColumn,
} from "@/lib/checklists";

const statusLabel: Record<ChecklistStatus, string> = {
  open: "Open",
  wip: "WIP",
  done: "Done",
};

function UpdatedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="text-body-sm text-success">Updated.</p>;
}

function StatusControl({
  clientId,
  column,
  value,
}: {
  clientId: string;
  column: ChecklistStatusColumn;
  value: string | null | undefined;
}) {
  const [status, setStatus] = useState<ChecklistStatus>(
    parseChecklistStatus(value),
  );
  const [pending, setPending] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSelect(next: ChecklistStatus) {
    if (next === status || pending) return;
    const previous = status;
    setStatus(next);
    setPending(true);
    setUpdated(false);
    setError(null);

    try {
      const result = await updateChecklistStatus(clientId, column, next);
      if (!result?.ok) {
        setStatus(previous);
        setError(result?.error ?? "Unable to update.");
        return;
      }
      setUpdated(true);
    } catch (err) {
      setStatus(previous);
      setError(err instanceof Error ? err.message : "Unable to update.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-sm">
      <div className="inline-flex overflow-hidden rounded-md border border-border">
        {CHECKLIST_STATUS_VALUES.map((option) => {
          const active = status === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onSelect(option)}
              disabled={pending}
              className={`px-sm py-xs text-label uppercase tracking-label transition-colors duration-hover disabled:opacity-40 ${
                active
                  ? "bg-primary-tint text-primary"
                  : "bg-surface text-muted hover:text-heading"
              }`}
            >
              {statusLabel[option]}
            </button>
          );
        })}
      </div>
      <UpdatedNote show={updated && !error} />
      {error ? <p className="text-body-sm text-error">{error}</p> : null}
    </div>
  );
}

function DoneToggle({
  clientId,
  column,
  done,
}: {
  clientId: string;
  column: OnboardingTimestampColumn;
  done: boolean;
}) {
  const [checked, setChecked] = useState(done);
  const [pending, setPending] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.checked;
    const previous = checked;
    setChecked(next);
    setPending(true);
    setUpdated(false);
    setError(null);

    try {
      const result = await updateOnboardingTimestamp(clientId, column, next);
      if (!result?.ok) {
        setChecked(previous);
        setError(result?.error ?? "Unable to update.");
        return;
      }
      setUpdated(true);
    } catch (err) {
      setChecked(previous);
      setError(err instanceof Error ? err.message : "Unable to update.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-sm">
      <label className="inline-flex items-center gap-sm text-body-sm text-secondary">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={pending}
          className="h-4 w-4 accent-primary"
        />
        Done
      </label>
      <UpdatedNote show={updated && !error} />
      {error ? <p className="text-body-sm text-error">{error}</p> : null}
    </div>
  );
}

export function EngagementProgress({
  clientId,
  timestamps,
  statuses,
}: {
  clientId: string;
  timestamps: {
    nda_signed_at?: string | null;
    intake_completed_at?: string | null;
    payment_received_at?: string | null;
  };
  statuses: ChecklistStatuses;
}) {
  return (
    <section className="mt-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-lg">
        <h2 className="text-h4">Engagement Progress</h2>
        <p className="mt-xs text-body-sm text-muted">
          Status shown to the client on Setup and Live Campaign.
        </p>
      </div>

      <div className="border-b border-border px-lg py-md">
        <p className="text-label uppercase tracking-label text-muted">
          Onboarding
        </p>
      </div>
      {ONBOARDING_TOGGLES.map((item) => (
        <div
          key={item.column}
          className="flex flex-wrap items-center justify-between gap-md border-b border-border px-lg py-md"
        >
          <div>
            <p className="text-body-sm text-heading">{item.title}</p>
            <p className="text-body-sm text-muted">{item.detail}</p>
          </div>
          <DoneToggle
            clientId={clientId}
            column={item.column}
            done={Boolean(timestamps[item.column])}
          />
        </div>
      ))}

      <div className="border-b border-border px-lg py-md">
        <p className="text-label uppercase tracking-label text-muted">Setup</p>
      </div>
      {SETUP_ITEMS.map((item) => (
        <div
          key={item.column}
          className="flex flex-wrap items-center justify-between gap-md border-b border-border px-lg py-md"
        >
          <p className="text-body-sm text-heading">{item.title}</p>
          <StatusControl
            clientId={clientId}
            column={item.column}
            value={statuses[item.column]}
          />
        </div>
      ))}

      <div className="border-b border-border px-lg py-md">
        <p className="text-label uppercase tracking-label text-muted">
          Live Campaign
        </p>
      </div>
      {LIVE_ITEMS.map((item, index) => (
        <div
          key={item.column}
          className={`flex flex-wrap items-center justify-between gap-md px-lg py-md ${
            index === LIVE_ITEMS.length - 1 ? "" : "border-b border-border"
          }`}
        >
          <p className="text-body-sm text-heading">{item.title}</p>
          <StatusControl
            clientId={clientId}
            column={item.column}
            value={statuses[item.column]}
          />
        </div>
      ))}
    </section>
  );
}
