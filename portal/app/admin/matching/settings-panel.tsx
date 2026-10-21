"use client";

import { useState } from "react";
import {
  cardClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
  smallButton,
} from "@/app/admin/clients/[id]/match/ui";
import { DEFAULT_SETTINGS, SITE_N_OPTIONS, type MatchSettings } from "@/lib/match/shared";

export type HiddenFund = { id: string; name: string; reason: string };

/** The client's quality filters and website rules, and the funds hidden for all clients. */
export function SettingsPanel({
  settings,
  busy,
  hidden,
  onApply,
  onRestore,
}: {
  settings: MatchSettings;
  busy: boolean;
  hidden: HiddenFund[];
  onApply: (next: MatchSettings) => void;
  onRestore: (firmId: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const filters = draft.filters;
  const setFilter = (patch: Partial<MatchSettings["filters"]>) =>
    setDraft((current) => ({ ...current, filters: { ...current.filters, ...patch } }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <details className={`${cardClass} px-lg py-md`}>
      <summary className="cursor-pointer text-label uppercase tracking-label text-secondary">
        Quality filters & rules
      </summary>
      <div className="mt-md grid gap-md md:grid-cols-2">
        <div className="space-y-sm text-body-sm">
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={filters.noPlatforms}
              onChange={(event) => setFilter({ noPlatforms: event.target.checked })}
            />
            Drop multi-stage platforms (8+ stages)
          </label>
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={filters.needDecision}
              onChange={(event) => setFilter({ needDecision: event.target.checked })}
            />
            Require a decision maker or deal champion with an email
          </label>
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={filters.needEmail}
              onChange={(event) => setFilter({ needEmail: event.target.checked })}
            />
            Only funds with an investing contact who has an email
          </label>
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={filters.nearOnly}
              onChange={(event) => setFilter({ nearOnly: event.target.checked })}
            />
            Team near the client only
          </label>
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={draft.dropDead}
              onChange={(event) => setDraft((current) => ({ ...current, dropDead: event.target.checked }))}
            />
            Drop funds whose website is dead, parked or not investing
          </label>
        </div>
        <div className="grid gap-sm sm:grid-cols-2">
          <label className="text-body-sm">
            <span className={labelClass}>Minimum data confidence</span>
            <select
              className={`${inputClass} mt-xs`}
              value={filters.minConf}
              onChange={(event) =>
                setFilter({ minConf: Number(event.target.value) as MatchSettings["filters"]["minConf"] })
              }
            >
              <option value={0}>Any</option>
              <option value={0.6}>Medium or high</option>
              <option value={0.99}>High only</option>
            </select>
          </label>
          <label className="text-body-sm">
            <span className={labelClass}>Founded in or after</span>
            <input
              type="number"
              min={1900}
              max={2100}
              placeholder="Any year"
              className={`${inputClass} mt-xs`}
              value={filters.foundedAfter || ""}
              onChange={(event) => setFilter({ foundedAfter: Number(event.target.value) || 0 })}
            />
          </label>
          <label className="text-body-sm">
            <span className={labelClass}>Websites checked per tier</span>
            <select
              className={`${inputClass} mt-xs`}
              value={draft.siteN}
              onChange={(event) =>
                setDraft((current) => ({ ...current, siteN: Number(event.target.value) as MatchSettings["siteN"] }))
              }
            >
              {SITE_N_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 0 ? "Off" : `Top ${option}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="mt-md flex flex-wrap gap-sm">
        <button type="button" className={primaryButton} disabled={busy || !dirty} onClick={() => onApply(draft)}>
          Apply
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={busy}
          onClick={() => {
            // Tightness and wave size aren't used by the matching engine: they stay as saved.
            const next = { ...DEFAULT_SETTINGS, tune: settings.tune, waveSize: settings.waveSize };
            setDraft(next);
            onApply(next);
          }}
        >
          Reset to default
        </button>
      </div>
      <div className="mt-lg">
        <p className={`${labelClass} mb-xs`}>Hidden for all clients</p>
        {hidden.length === 0 ? (
          <p className="text-body-sm text-muted">
            None. Rejecting a fund with &ldquo;Hide this fund for all clients&rdquo; puts it here.
          </p>
        ) : (
          <ul className="max-h-48 space-y-xs overflow-auto text-body-sm">
            {hidden.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-sm">
                <span>
                  <span className="text-heading">{item.name || item.id}</span>
                  {item.reason ? <span className="text-muted"> · {item.reason}</span> : null}
                </span>
                <button type="button" className={smallButton} disabled={busy} onClick={() => onRestore(item.id)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
