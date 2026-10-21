// Allocating a campaign target across the four tiers of one saved four-tier
// run. Pure module.
//
// Order (a pyramid, best fit first):
//   1. Core, capped at CORE_CAP firms.
//   2. Sphere, then Tier 3, then Tier 4: each is used in full before the next.
//      No fixed ratio: how deep the plan goes depends on the target and the pool.
//   3. Generalists, only for what the four tiers can't fill, and only when an
//      admin approves using them. They stay labelled as generalists.
// Within each source, firms keep the run's saved order (fit score first).
// Only eligible firms are used: in a tier (or a generalist), not rejected for
// the client, not shown through another record, each FirmID once. Excluded,
// unresolved and near-miss firms never enter a plan. No eligibility check is
// relaxed to meet a target.

import { TIER_INFO, TIER_KEYS, type TierKey } from "../tiers/core.ts";
import type { StoredResult } from "../tiers/compare.ts";

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

export type AllocationRow = { source: PlanSource; available: number; planned: number; remaining: number; note: string };

export type Allocation = {
  target: number;
  rows: AllocationRow[];
  /** Firms the four tiers supply toward the target. */
  fromTiers: number;
  /** Generalists the shortfall would need (whether or not approved). */
  generalistsProposed: number;
  generalistsApproved: boolean;
  /** Firms planned: the four tiers, plus generalists when approved. */
  planned: number;
  /** Target − planned (0 when met). */
  shortfall: number;
  /** The most firms this run can supply: Core up to the cap, the other tiers in full, and every generalist. */
  maxAchievable: number;
  firms: PoolFirm[];
};

export function allocate(pools: Record<PlanSource, PoolFirm[]>, target: number, useGeneralists: boolean): Allocation {
  if (!Number.isInteger(target) || target < 0) throw new Error("The target must be a whole number, 0 or more.");
  const planned: Record<PlanSource, PoolFirm[]> = { core: [], sphere: [], tier3: [], tier4: [], generalist: [] };
  let left = target;
  const take = (source: PlanSource, limit: number) => {
    planned[source] = pools[source].slice(0, Math.max(0, Math.min(limit, left)));
    left -= planned[source].length;
  };
  take("core", CORE_CAP);
  take("sphere", Number.POSITIVE_INFINITY);
  take("tier3", Number.POSITIVE_INFINITY);
  take("tier4", Number.POSITIVE_INFINITY);
  const fromTiers = target - left;
  const generalistsProposed = Math.min(left, pools.generalist.length);
  if (useGeneralists) take("generalist", Number.POSITIVE_INFINITY);

  const note = (source: PlanSource): string => {
    const available = pools[source].length;
    const used = planned[source].length;
    if (source === "core") {
      if (available < Math.min(CORE_CAP, target)) return `Only ${available} eligible Core firm${available === 1 ? "" : "s"}: short of ${Math.min(CORE_CAP, target) - available} for the cap.`;
      if (available > CORE_CAP && used === CORE_CAP) return `Capped at ${CORE_CAP}.`;
      return "";
    }
    if (source === "generalist") {
      if (generalistsProposed === 0) return fromTiers >= target ? "Not needed: the four tiers meet the target." : "None available.";
      return useGeneralists ? `Used for a shortfall of ${generalistsProposed + left}.` : `${generalistsProposed} proposed for the shortfall; not approved.`;
    }
    return used === available && available > 0 && fromTiers < target ? "Used in full." : "";
  };

  const rows = SOURCES.map((source) => ({
    source,
    available: pools[source].length,
    planned: planned[source].length,
    remaining: pools[source].length - planned[source].length,
    note: note(source),
  }));
  const total = SOURCES.reduce((sum, source) => sum + planned[source].length, 0);
  return {
    target,
    rows,
    fromTiers,
    generalistsProposed,
    generalistsApproved: useGeneralists,
    planned: total,
    shortfall: Math.max(0, target - total),
    maxAchievable:
      Math.min(CORE_CAP, pools.core.length) + pools.sphere.length + pools.tier3.length + pools.tier4.length + pools.generalist.length,
    firms: SOURCES.flatMap((source) => planned[source]),
  };
}
