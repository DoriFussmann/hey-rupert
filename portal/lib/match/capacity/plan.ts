// A capacity plan: the schedule for the inputs, and the allocation of the
// target across one saved four-tier run. Pure module: the same run rows and
// inputs always give the same plan, so a saved plan can be rebuilt and checked.

import type { StoredResult } from "../tiers/compare.ts";
import { allocate, poolsOf, type Allocation, type PlanSource, type PoolFirm } from "./allocate.ts";
import { benchmarkFor, compareToBenchmark, inboxesNeeded, inputProblems, schedule, type CapacityInputs, type CapacityResult } from "./schedule.ts";

export type PlanRequest = {
  inputs: CapacityInputs;
  /** Unique firms wanted. Null: plan for what the inboxes can reach. */
  target: number | null;
  useGeneralists: boolean;
};

export type CapacityPlan = {
  inputs: CapacityInputs;
  capacity: CapacityResult;
  /** The target the allocation used: the one entered, or the calculated capacity. */
  target: number;
  targetSource: "entered" | "capacity";
  /** When a target was entered: can the inboxes reach it in time, and how many inboxes would. */
  reach: { fits: boolean; firmsAtTarget: number; inboxesNeeded: number | null; lastStartDay: number } | null;
  benchmark: { firms: number; status: "under" | "on" | "over"; difference: number } | null;
  allocation: Allocation;
};

export const TARGET_MAX = 20_000;

export function planProblems(request: PlanRequest): string[] {
  const problems = inputProblems(request.inputs);
  if (request.target !== null && (!Number.isInteger(request.target) || request.target < 1 || request.target > TARGET_MAX)) {
    problems.push(`Target firms: a whole number from 1 to ${TARGET_MAX.toLocaleString("en-US")}, or blank to use the calculated capacity.`);
  }
  return problems;
}

/** The plan for a saved run's rows. */
export function buildPlan(rows: StoredResult[], request: PlanRequest): CapacityPlan {
  return buildPlanFromPools(poolsOf(rows), request);
}

/** The plan for pools already taken from a saved run (the calculator page passes these). */
export function buildPlanFromPools(pools: Record<PlanSource, PoolFirm[]>, request: PlanRequest): CapacityPlan {
  const problems = planProblems(request);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const capacity = schedule(request.inputs);
  const target = request.target ?? capacity.firms;
  let reach: CapacityPlan["reach"] = null;
  if (request.target !== null) {
    const atTarget = schedule(request.inputs, request.target);
    const fits = atTarget.firms >= request.target;
    reach = {
      fits,
      firmsAtTarget: atTarget.firms,
      inboxesNeeded: fits ? request.inputs.inboxes : inboxesNeeded(request.inputs, request.target),
      lastStartDay: atTarget.lastStartDay,
    };
  }
  const reference = benchmarkFor(request.inputs.months);
  return {
    inputs: request.inputs,
    capacity,
    target,
    targetSource: request.target === null ? "capacity" : "entered",
    reach,
    benchmark: reference === null ? null : { firms: reference, ...compareToBenchmark(capacity.firms, reference) },
    allocation: allocate(pools, target, request.useGeneralists),
  };
}
