// Thin match: when a client's run has too few funds, how short it is, what
// holds it down, and the options to test. Pure module.

import { REASONS, TIER_KEYS, type TierCounts, type TierKey } from "./core.ts";
import type { StoredResult } from "./stored.ts";

/** form_templates row holding the thresholds (one setting for every client). */
export const THIN_THRESHOLDS_SLUG = "match_thin_thresholds";

export type ThinThresholds = { minCore: number; minTotal: number };

export const DEFAULT_THIN_THRESHOLDS: ThinThresholds = { minCore: 5, minTotal: 100 };

const THRESHOLD_MAX = 10000;

function whole(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(number) && number >= 0 && number <= THRESHOLD_MAX ? number : null;
}

/** Problems with thresholds an admin entered, in words. Empty when they can be saved. */
export function thresholdProblems(input: { minCore: unknown; minTotal: unknown }): string[] {
  const problems: string[] = [];
  if (whole(input.minCore) === null) problems.push(`Minimum Core funds: a whole number from 0 to ${THRESHOLD_MAX}.`);
  if (whole(input.minTotal) === null) problems.push(`Minimum funds in all tiers: a whole number from 0 to ${THRESHOLD_MAX}.`);
  return problems;
}

/** The stored thresholds, or the defaults for anything missing or invalid. */
export function parseThresholds(raw: unknown): ThinThresholds {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    minCore: whole(record.minCore) ?? DEFAULT_THIN_THRESHOLDS.minCore,
    minTotal: whole(record.minTotal) ?? DEFAULT_THIN_THRESHOLDS.minTotal,
  };
}

export type TierTally = Record<TierKey, number> & { total: number };

function tally(byTier: Record<TierKey, number>): TierTally {
  return { ...byTier, total: TIER_KEYS.reduce((sum, tier) => sum + byTier[tier], 0) };
}

/** Funds per tier in a saved run: listed, not rejected for the client, not shown through another record. */
export function tallyRows(rows: StoredResult[]): TierTally {
  const byTier: Record<TierKey, number> = { core: 0, sphere: 0, tier3: 0, tier4: 0 };
  for (const row of rows) {
    if (row.status !== "tiered" || row.detail.rejected || row.detail.representedBy) continue;
    if ((TIER_KEYS as readonly string[]).includes(row.tier ?? "")) byTier[row.tier as TierKey] += 1;
  }
  return tally(byTier);
}

/** Funds per tier from an engine run's counts. */
export function tallyCounts(counts: TierCounts): TierTally {
  return tally({ ...counts.tiers });
}

export type Thinness = { thin: boolean; coreShort: number; totalShort: number };

/** How far below the thresholds a tally is (0 when it meets them). */
export function thinness(counts: TierTally, thresholds: ThinThresholds): Thinness {
  const coreShort = Math.max(0, thresholds.minCore - counts.core);
  const totalShort = Math.max(0, thresholds.minTotal - counts.total);
  return { thin: coreShort > 0 || totalShort > 0, coreShort, totalShort };
}

export type Limit = { code: string; label: string; count: number };

/** Why funds left the run, most common first: the deciding reason of each excluded or unresolved fund. */
export function runLimits(rows: StoredResult[], top = 5): Limit[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.detail.representedBy) continue;
    if (row.status !== "excluded" && row.status !== "unresolved") continue;
    const code = row.reasonCodes[row.reasonCodes.length - 1];
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([code, count]) => ({ code, label: (REASONS as Record<string, { label: string }>)[code]?.label ?? code, count }));
}

export type StageReachOption = "exact" | "next";

/** One setup to test: sectors and stage reach. */
export type MatchOption = { primary: string; secondary: string[]; stageReach: StageReachOption };

export function optionKey(option: MatchOption) {
  return [option.primary, ...option.secondary, option.stageReach].join("|");
}

/** The options to test, each sector setup with both stage reaches, the current setup first, without repeats. */
export function optionsToTest(current: MatchOption, setups: { primary: string; secondary: string[] }[]): MatchOption[] {
  const seen = new Set<string>();
  const out: MatchOption[] = [];
  const add = (option: MatchOption) => {
    const key = optionKey(option);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(option);
  };
  add(current);
  add({ ...current, stageReach: current.stageReach === "next" ? "exact" : "next" });
  for (const setup of setups) {
    const secondary = setup.secondary.filter((id) => id && id !== setup.primary);
    add({ primary: setup.primary, secondary, stageReach: "exact" });
    add({ primary: setup.primary, secondary, stageReach: "next" });
  }
  return out;
}
