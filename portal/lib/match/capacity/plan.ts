// A campaign plan: how many funds the inboxes can work through in the chosen
// months, how they split across the tiers of one saved run, and which funds
// that makes. Pure module: the same run rows and request always give the same
// plan, so a saved plan can be rebuilt and checked.

import type { StoredResult } from "../tiers/stored.ts";
import {
  CORE_CAP,
  SOURCES,
  SOURCE_LABEL,
  allocateCounts,
  poolsOf,
  sizesOf,
  suggestCounts,
  type Allocation,
  type Counts,
  type PlanSource,
  type PoolFirm,
  type RemovedFirm,
} from "./allocate.ts";
import { INPUT_LIMITS, benchmarkFor, compareToBenchmark, inputProblems, schedule, type CapacityInputs, type CapacityResult } from "./schedule.ts";

export type PlanRequest = {
  inputs: CapacityInputs;
  /** Firms per source. Null: the suggested split of what the inboxes can reach. */
  counts: Counts | null;
  /** The admin approves topping up with generalists. */
  useGeneralists: boolean;
  /** Firms taken out of the campaign after it was confirmed. */
  removed: RemovedFirm[];
};

export type CampaignPlan = {
  inputs: CapacityInputs;
  capacity: CapacityResult;
  /** Funds the inboxes can work through in the chosen months. */
  fundsRequired: number;
  counts: Counts;
  /** Firms the split asks for in all. */
  total: number;
  /** Fewest months that fit `total`, or null when not even the longest campaign does. */
  monthsNeeded: number | null;
  benchmark: { firms: number; status: "under" | "on" | "over"; difference: number } | null;
  allocation: Allocation;
};

export const TARGET_MAX = 20_000;

export function countsTotal(counts: Counts) {
  return SOURCES.reduce((sum, source) => sum + (counts[source] || 0), 0);
}

export function planProblems(request: PlanRequest): string[] {
  const problems = inputProblems(request.inputs);
  const { counts } = request;
  if (counts) {
    for (const source of SOURCES) {
      const value = counts[source];
      if (!Number.isInteger(value) || value < 0) problems.push(`${SOURCE_LABEL[source]}: a whole number, 0 or more.`);
    }
    if (counts.core > CORE_CAP) problems.push(`Core is capped at ${CORE_CAP} funds.`);
    if (counts.generalist > 0 && !request.useGeneralists) problems.push("Approve generalists before planning any.");
    const total = countsTotal(counts);
    if (total < 1) problems.push("Plan at least one fund.");
    if (total > TARGET_MAX) problems.push(`Plan at most ${TARGET_MAX.toLocaleString("en-US")} funds.`);
  }
  return problems;
}

/** Fewest campaign months (within the limits) whose schedule fits `total` firms, other inputs unchanged. */
export function monthsNeeded(inputs: CapacityInputs, total: number): number | null {
  if (total < 1) return null;
  for (let months = INPUT_LIMITS.months.min; months <= INPUT_LIMITS.months.max; months += 1) {
    const next = { ...inputs, months };
    if (inputProblems(next).length > 0) continue;
    if (schedule(next, total).firms >= total) return months;
  }
  return null;
}

/** Problems that block confirming a plan (the plan itself can still be shown). */
export function confirmProblems(plan: CampaignPlan): string[] {
  const problems: string[] = [];
  for (const row of plan.allocation.rows) {
    if (row.short > 0) problems.push(`${SOURCE_LABEL[row.source]} is short by ${row.short}: lower it or move the funds to another tier.`);
  }
  if (plan.allocation.planned < 1) problems.push("Plan at least one fund.");
  return problems;
}

/** The plan for a saved run's rows. */
export function buildPlan(rows: StoredResult[], request: PlanRequest): CampaignPlan {
  return buildPlanFromPools(poolsOf(rows), request);
}

/** The plan for pools already taken from a saved run (the Plan tab passes these). */
export function buildPlanFromPools(pools: Record<PlanSource, PoolFirm[]>, request: PlanRequest): CampaignPlan {
  const problems = planProblems(request);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const capacity = schedule(request.inputs);
  const counts = request.counts ?? suggestCounts(sizesOf(pools, request.removed), capacity.firms, request.useGeneralists);
  const total = countsTotal(counts);
  const reference = benchmarkFor(request.inputs.months);
  return {
    inputs: request.inputs,
    capacity,
    fundsRequired: capacity.firms,
    counts,
    total,
    monthsNeeded: monthsNeeded(request.inputs, total),
    benchmark: reference === null ? null : { firms: reference, ...compareToBenchmark(capacity.firms, reference) },
    allocation: allocateCounts(pools, counts, request.removed),
  };
}
