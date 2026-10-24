"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyMatchOption,
  findMatchOptions,
  saveThinThresholdsAction,
  type TestedOption,
} from "@/app/admin/thin-match-actions";
import { errorText, inputClass, labelClass, n, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import type { Limit, StageReachOption, ThinThresholds, TierTally } from "@/lib/match/tiers/thin";

const REACH_LABEL: Record<StageReachOption, string> = {
  exact: "Stage as profiled",
  next: "Also one stage up",
};

const TIERS: { key: keyof TierTally; label: string }[] = [
  { key: "core", label: "Core" },
  { key: "sphere", label: "Sphere" },
  { key: "tier3", label: "Tier 3" },
  { key: "tier4", label: "Tier 4" },
  { key: "total", label: "Total" },
];

type Notice = { kind: "ok" | "error"; text: string } | null;

/**
 * Thin match, on the Tiers tab: whether the newest run reaches the minimum
 * Core and total funds, what holds it down, and tested options (other
 * sectors, stage reach) with the engine's real counts. Applying one saves
 * it and runs the match again; nothing is pushed.
 */
export function ThinMatchPanel({
  clientId,
  tally,
  thresholds,
  limits,
  stageReach,
  claudeReady,
}: {
  clientId: string;
  tally: TierTally;
  thresholds: ThinThresholds;
  limits: Limit[];
  stageReach: StageReachOption;
  claudeReady: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ minCore: String(thresholds.minCore), minTotal: String(thresholds.minTotal) });
  const [options, setOptions] = useState<TestedOption[] | null>(null);
  const [pending, setPending] = useState<null | "find" | "save" | string>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const coreShort = Math.max(0, thresholds.minCore - tally.core);
  const totalShort = Math.max(0, thresholds.minTotal - tally.total);
  const thin = coreShort > 0 || totalShort > 0;

  async function onSave() {
    setPending("save");
    setNotice(null);
    try {
      const result = await saveThinThresholdsAction(form);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "The thresholds were not saved.") });
    } finally {
      setPending(null);
    }
  }

  async function onFind() {
    setPending("find");
    setNotice(null);
    try {
      const result = await findMatchOptions(clientId);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setOptions(result.options);
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "The options could not be found.") });
    } finally {
      setPending(null);
    }
  }

  async function onApply(option: TestedOption) {
    const sectors = [option.primaryLabel, ...option.secondaryLabels].join(", ");
    if (
      !window.confirm(
        `Apply ${sectors} · ${REACH_LABEL[option.option.stageReach]}? The sectors are saved as a new company profile version, and the match runs again. Nothing is pushed to the client.`,
      )
    ) {
      return;
    }
    setPending(option.key);
    setNotice(null);
    try {
      const result = await applyMatchOption(clientId, option.option, option.rationale);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setOptions(null);
      setNotice({ kind: "ok", text: "Applied. The match ran again: the tiers below are the new run." });
      router.refresh();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "The option was not applied.") });
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <section
      className={`mb-lg rounded-card border bg-surface ${thin ? "border-warning/40" : "border-border"}`}
      aria-labelledby="thin-match-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md">
        <div className="min-w-0 flex-1 text-body-sm">
          <h2 id="thin-match-title" className={`text-h4 ${thin ? "text-warning" : "text-heading"}`}>
            {thin ? "Thin match" : "Match size"}
          </h2>
          <p className="mt-xs text-body">
            Core {n(tally.core)} (minimum {n(thresholds.minCore)}) · all tiers {n(tally.total)} (minimum {n(thresholds.minTotal)}) ·{" "}
            {REACH_LABEL[stageReach].toLowerCase()}.
          </p>
          {thin ? (
            <p className="mt-xs text-secondary">
              Short by {[coreShort > 0 ? `${n(coreShort)} in Core` : "", totalShort > 0 ? `${n(totalShort)} overall` : ""].filter(Boolean).join(" and ")}.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-sm">
          <button type="button" className={smallButton} disabled={busy} onClick={() => setEditing((value) => !value)}>
            {editing ? "Close" : "Thresholds"}
          </button>
          <button
            type="button"
            className={thin ? primaryButton : secondaryButton}
            disabled={busy || !claudeReady}
            title={claudeReady ? undefined : "ANTHROPIC_API_KEY is not configured."}
            onClick={() => void onFind()}
          >
            {pending === "find" ? "Testing options…" : "Find options"}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-wrap items-end gap-md border-t border-border px-lg py-md">
          <label className={labelClass}>
            Minimum Core funds
            <input
              className={`${inputClass} mt-xs w-32`}
              inputMode="numeric"
              value={form.minCore}
              onChange={(event) => setForm({ ...form, minCore: event.target.value })}
            />
          </label>
          <label className={labelClass}>
            Minimum funds in all tiers
            <input
              className={`${inputClass} mt-xs w-32`}
              inputMode="numeric"
              value={form.minTotal}
              onChange={(event) => setForm({ ...form, minTotal: event.target.value })}
            />
          </label>
          <button type="button" className={primaryButton} disabled={busy} onClick={() => void onSave()}>
            {pending === "save" ? "Saving…" : "Save for all clients"}
          </button>
        </div>
      ) : null}

      {thin && limits.length > 0 ? (
        <div className="border-t border-border px-lg py-md text-body-sm">
          <p className={labelClass}>What holds it down</p>
          <ul className="mt-xs space-y-xs text-body">
            {limits.map((limit) => (
              <li key={limit.code}>
                {limit.label}: {n(limit.count)} funds
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pending === "find" ? (
        <p className="border-t border-border px-lg py-md text-body-sm text-muted" aria-live="polite">
          The AI proposes sector setups, then the match engine counts each one. This takes up to a minute.
        </p>
      ) : null}

      {options ? (
        <div className="border-t border-border">
          <p className="px-lg pt-md text-body-sm text-muted">
            Counts from the match engine on today&apos;s data, before website checks. Applying saves the option and runs the match again.
          </p>
          <div className="overflow-x-auto px-lg py-md">
            <table className="w-full min-w-[640px] text-left text-body-sm">
              <thead>
                <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                  <th scope="col" className="py-xs pr-md font-normal">Setup</th>
                  {TIERS.map((tier) => (
                    <th key={tier.key} scope="col" className="py-xs pr-md text-right font-normal">
                      {tier.label}
                    </th>
                  ))}
                  <th scope="col" className="py-xs font-normal">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {options.map((option) => {
                  const isNow = option.current && option.option.stageReach === stageReach;
                  return (
                    <tr key={option.key} className="align-top">
                      <td className="py-sm pr-md">
                        <p className="text-heading">
                          {option.primaryLabel}
                          {option.secondaryLabels.length > 0 ? (
                            <span className="text-secondary"> + {option.secondaryLabels.join(", ")}</span>
                          ) : null}
                        </p>
                        <p className="text-muted">
                          {REACH_LABEL[option.option.stageReach]}
                          {isNow ? " · current" : ""}
                          {option.meets ? <span className="text-success"> · meets the minimums</span> : null}
                        </p>
                        {option.rationale ? <p className="mt-xs max-w-prose text-secondary">{option.rationale}</p> : null}
                      </td>
                      {TIERS.map((tier) => (
                        <td key={tier.key} className={`py-sm pr-md text-right tabular-nums ${tier.key === "total" ? "text-heading" : "text-body"}`}>
                          {n(option.tally[tier.key])}
                        </td>
                      ))}
                      <td className="py-sm text-right">
                        {isNow ? null : (
                          <button type="button" className={smallButton} disabled={busy} onClick={() => void onApply(option)}>
                            {pending === option.key ? "Applying…" : "Apply"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`border-t border-border px-lg py-sm text-body-sm ${notice.kind === "error" ? "text-error" : "text-success"}`}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
