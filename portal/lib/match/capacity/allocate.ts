// Splitting a campaign across the four tiers of one saved run. Pure module.
//
// The suggested split: Core first, capped at CORE_CAP firms; what's left goes
// 40% Sphere, 35% Tier 3, 25% Tier 4 (DEFAULT_SPLIT). A tier that has fewer
// firms than its share passes the rest on to the next tiers that have room.
// Generalists fill what the four tiers can't, only when an admin approves
// them, and stay labelled as generalists. The admin can then change any number.
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
export const DEFAULT_SPLIT: Record<"sphere" | "tier3" | "tier4", number> = { sphere: 40, tier3: 35, tier4: 25 };

/** Firms wanted from each source. */
export type Counts = Record<PlanSource, number>;

export const ZERO_COUNTS: Counts = { core: 0, sphere: 0, tier3: 0, tier4: 0, generalist: 0 };

/** A firm taken out of the campaign after the plan was confirmed. */
export type RemovedFirm = { firmId: string; name: string; source: PlanSource; reason: string; by: string | null; at: string };

const REST: ("sphere" | "tier3" | "tier4")[] = ["sphere", "tier3", "tier4"];

/** Eligible firms per source. */
export type Sizes = Record<PlanSource, number>;

export function sizesOf(pools: Record<PlanSource, PoolFirm[]>, removed: RemovedFirm[] = []): Sizes {
  const out = new Set(removed.map((firm) => firm.firmId));
  return Object.fromEntries(SOURCES.map((source) => [source, pools[source].filter((firm) => !out.has(firm.firmId)).length])) as Sizes;
}

/**
 * The suggested split of `total` firms across sources of the given sizes.
 * Pure arithmetic: never more than a source has; generalists only when approved.
 */
export function suggestCounts(sizes: Sizes, total: number, useGeneralists: boolean): Counts {
  const counts: Counts = { ...ZERO_COUNTS };
  const wanted = Math.max(0, Math.floor(total));
  counts.core = Math.min(CORE_CAP, sizes.core, wanted);
  const rest = wanted - counts.core;
  const sphere = Math.round((rest * DEFAULT_SPLIT.sphere) / 100);
  const tier3 = Math.round((rest * DEFAULT_SPLIT.tier3) / 100);
  const share = { sphere, tier3, tier4: rest - sphere - tier3 };
  let overflow = 0;
  for (const tier of REST) {
    counts[tier] = Math.min(share[tier], sizes[tier]);
    overflow += share[tier] - counts[tier];
  }
  for (const tier of REST) {
    const add = Math.min(sizes[tier] - counts[tier], overflow);
    counts[tier] += add;
    overflow -= add;
  }
  if (useGeneralists) counts.generalist = Math.min(overflow, sizes.generalist);
  return counts;
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
