// Splitting a campaign across the four tiers of one saved run. Pure module.
//
// The suggested split: Core first, capped at CORE_CAP firms. What's left is
// shared by weight (40% Sphere, 35% Tier 3, 25% Tier 4 unless the admin sets
// others). The weights are targets, not quotas: a tier that runs out passes
// its remaining share to the tiers that still have firms, in proportion to
// their weights, but no tier takes more than TIER_CEILING times its own
// target. What no tier can take is a shortfall. Generalists fill a shortfall
// only when an admin approves them, and stay labelled as generalists. The
// admin can then change any number.
// Within each source the plan takes the run's best-fit firms first (saved
// order), skipping firms removed from the campaign.
// Only eligible firms are used: in a tier (or a generalist), not rejected for
// the client, not shown through another record, each FirmID once. Excluded,
// unresolved and near-miss firms never enter a plan. No eligibility check is
// relaxed to meet a target.

import { TIER_INFO, TIER_KEYS, type TierKey } from "../tiers/core.ts";
import type { StoredResult } from "../tiers/stored.ts";

export const CORE_CAP = 10;

export type PlanSource = TierKey | "generalist";

export const SOURCE_LABEL: Record<PlanSource, string> = {
  core: TIER_INFO.core.label,
  sphere: TIER_INFO.sphere.label,
  tier3: TIER_INFO.tier3.label,
  tier4: TIER_INFO.tier4.label,
  generalist: "Generalists (top-up)",
};

export const SOURCES: PlanSource[] = [...TIER_KEYS, "generalist"];

const REST: SplitTier[] = ["sphere", "tier3", "tier4"];

/** One firm a plan can use, as the saved run stored it. */
export type PoolFirm = { firmId: string; name: string; source: PlanSource; score: number | null; position: number };

const baseId = (id: string) => id.replace(/#\d+$/, "");

/**
 * The firms of a saved run a plan may use, by source, in the run's order.
 * A FirmID that appears twice (a repeated provider row) is used once, from its best place.
 */
export function poolsOf(rows: StoredResult[]): Record<PlanSource, PoolFirm[]> {
  const pools: Record<PlanSource, PoolFirm[]> = { core: [], sphere: [], tier3: [], tier4: [], generalist: [] };
  const rank = (row: StoredResult) => (row.status === "tiered" ? TIER_KEYS.indexOf(row.tier as TierKey) : 10);
  const eligible = rows
    .filter((row) => !row.detail.representedBy && !row.detail.rejected)
    .filter((row) => (row.status === "tiered" && TIER_KEYS.includes(row.tier as TierKey)) || row.status === "generalist")
    .sort((a, b) => rank(a) - rank(b) || a.position - b.position);
  const seen = new Set<string>();
  for (const row of eligible) {
    const id = baseId(row.firmId);
    if (seen.has(id)) continue;
    seen.add(id);
    const source: PlanSource = row.status === "generalist" ? "generalist" : (row.tier as TierKey);
    pools[source].push({ firmId: row.firmId, name: row.firmName, source, score: row.score, position: row.position });
  }
  return pools;
}

/** How what's left after Core is shared out, in percent. */
export type SplitTier = "sphere" | "tier3" | "tier4";

/** How what's left after Core is shared out, in whole percent adding up to 100. */
export type Weights = Record<SplitTier, number>;

export const DEFAULT_SPLIT: Weights = { sphere: 40, tier3: 35, tier4: 25 };

/** No tier takes more than this times its own target when others run out. */
export const TIER_CEILING = 1.5;

/** Problems with weights, in words. Empty when they can be used. */
export function weightProblems(weights: Weights): string[] {
  const problems: string[] = [];
  for (const tier of REST) {
    const value = weights[tier];
    if (!Number.isInteger(value) || value < 0 || value > 100) problems.push(`${SOURCE_LABEL[tier]} weight: a whole number from 0 to 100.`);
  }
  if (problems.length === 0 && REST.reduce((sum, tier) => sum + weights[tier], 0) !== 100) problems.push("The weights must add up to 100.");
  return problems;
}

/** Firms wanted from each source. */
export type Counts = Record<PlanSource, number>;

export const ZERO_COUNTS: Counts = { core: 0, sphere: 0, tier3: 0, tier4: 0, generalist: 0 };

/** A firm taken out of the campaign after the plan was confirmed. */
export type RemovedFirm = { firmId: string; name: string; source: PlanSource; reason: string; by: string | null; at: string };


/** Eligible firms per source. */
export type Sizes = Record<PlanSource, number>;

export function sizesOf(pools: Record<PlanSource, PoolFirm[]>, removed: RemovedFirm[] = []): Sizes {
  const out = new Set(removed.map((firm) => firm.firmId));
  return Object.fromEntries(SOURCES.map((source) => [source, pools[source].filter((firm) => !out.has(firm.firmId)).length])) as Sizes;
}

/**
 * The suggested split of `total` firms across sources of the given sizes.
 * Pure arithmetic: never more than a source has, never more than the
 * ceiling over a tier's target; generalists only when approved.
 */
export function suggestCounts(sizes: Sizes, total: number, useGeneralists: boolean, weights: Weights = DEFAULT_SPLIT): Counts {
  const counts: Counts = { ...ZERO_COUNTS };
  const wanted = Math.max(0, Math.floor(total));
  counts.core = Math.min(CORE_CAP, sizes.core, wanted);
  const rest = wanted - counts.core;

  // Each tier's target and the most it may take: the ceiling over its target
  // (never below the target rounded up, so small plans still add up), within what it has.
  const target = Object.fromEntries(REST.map((tier) => [tier, (rest * weights[tier]) / 100])) as Record<SplitTier, number>;
  const limit = Object.fromEntries(
    REST.map((tier) => [tier, Math.min(sizes[tier], Math.max(Math.ceil(target[tier] - 1e-9), Math.floor(target[tier] * TIER_CEILING + 1e-9)))]),
  ) as Record<SplitTier, number>;

  // Share by weight among the tiers with room; a tier that hits its limit is
  // filled and the rest is shared again among the others.
  const share: Record<SplitTier, number> = { sphere: 0, tier3: 0, tier4: 0 };
  let open = REST.filter((tier) => weights[tier] > 0 && limit[tier] > 0);
  let left = rest;
  while (left > 1e-9 && open.length > 0) {
    const weight = open.reduce((sum, tier) => sum + weights[tier], 0);
    const full = open.filter((tier) => share[tier] + (left * weights[tier]) / weight >= limit[tier] - 1e-9);
    if (full.length === 0) {
      for (const tier of open) share[tier] += (left * weights[tier]) / weight;
      left = 0;
      break;
    }
    for (const tier of full) {
      left -= limit[tier] - share[tier];
      share[tier] = limit[tier];
    }
    open = open.filter((tier) => !full.includes(tier));
  }

  // Whole firms: round down, then hand out what's left by the largest remainders, within the limits.
  for (const tier of REST) counts[tier] = Math.floor(share[tier] + 1e-9);
  let spare = Math.round(REST.reduce((sum, tier) => sum + share[tier], 0)) - REST.reduce((sum, tier) => sum + counts[tier], 0);
  const byRemainder = [...REST].sort((a, b) => share[b] - Math.floor(share[b] + 1e-9) - (share[a] - Math.floor(share[a] + 1e-9)) || REST.indexOf(a) - REST.indexOf(b));
  for (const tier of byRemainder) {
    if (spare <= 0) break;
    if (counts[tier] < limit[tier]) {
      counts[tier] += 1;
      spare -= 1;
    }
  }

  const shortfall = rest - REST.reduce((sum, tier) => sum + counts[tier], 0);
  if (useGeneralists && shortfall > 0) counts.generalist = Math.min(shortfall, sizes.generalist);
  return counts;
}

/** Each split tier's share of what was planned after Core, in whole percent (the real split, not the weights). */
export function actualSplit(counts: Counts): Weights {
  const rest = REST.reduce((sum, tier) => sum + counts[tier], 0);
  return Object.fromEntries(REST.map((tier) => [tier, rest > 0 ? Math.round((counts[tier] / rest) * 100) : 0])) as Weights;
}

export type AllocationRow = {
  source: PlanSource;
  /** Eligible firms left in the source (removed ones not counted). */
  available: number;
  /** Firms the plan asks for. */
  requested: number;
  planned: number;
  /** Requested − available, when the source can't supply it. */
  short: number;
  remaining: number;
};

export type Allocation = {
  counts: Counts;
  rows: AllocationRow[];
  requested: number;
  planned: number;
  shortfall: number;
  firms: PoolFirm[];
  removed: RemovedFirm[];
};

/** Takes each source's best `counts` firms, skipping removed ones. */
export function allocateCounts(pools: Record<PlanSource, PoolFirm[]>, counts: Counts, removed: RemovedFirm[] = []): Allocation {
  const out = new Set(removed.map((firm) => firm.firmId));
  const rows: AllocationRow[] = [];
  const firms: PoolFirm[] = [];
  for (const source of SOURCES) {
    const eligible = pools[source].filter((firm) => !out.has(firm.firmId));
    const requested = Math.max(0, Math.floor(counts[source] ?? 0));
    const taken = eligible.slice(0, requested);
    firms.push(...taken);
    rows.push({
      source,
      available: eligible.length,
      requested,
      planned: taken.length,
      short: Math.max(0, requested - eligible.length),
      remaining: eligible.length - taken.length,
    });
  }
  const requested = rows.reduce((sum, row) => sum + row.requested, 0);
  return {
    counts: { ...counts },
    rows,
    requested,
    planned: firms.length,
    shortfall: rows.reduce((sum, row) => sum + row.short, 0),
    firms,
    removed,
  };
}
