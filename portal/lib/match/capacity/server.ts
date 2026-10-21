import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { MATCH_MIGRATION_MISSING, selectAll } from "@/lib/match/db-server";
import { loadTierRun } from "@/lib/match/tiers/server";
import { buildPlan, planProblems, type CapacityPlan, type PlanRequest } from "@/lib/match/capacity/plan";
import { INPUT_LIMITS, type CapacityInputs } from "@/lib/match/capacity/schedule";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const CAPACITY_MIGRATION_MISSING =
  "Capacity plans are not set up in the database yet. Run portal/supabase/match_capacity.sql in Supabase.";

function planError(message: string, code?: string) {
  if (code === "42P01" || code === "42883" || code === "PGRST202" || code === "PGRST205" || /match_capacity_plans|match_save_capacity_plan/.test(message)) {
    return CAPACITY_MIGRATION_MISSING;
  }
  return message;
}

/** A plan request from the browser: every input checked; nothing is trusted. */
export function cleanRequest(raw: unknown): Result<PlanRequest> {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawInputs = (value.inputs && typeof value.inputs === "object" ? value.inputs : {}) as Record<string, unknown>;
  const inputs = {} as CapacityInputs;
  for (const key of Object.keys(INPUT_LIMITS) as (keyof CapacityInputs)[]) inputs[key] = Number(rawInputs[key]);
  const target = value.target === null || value.target === undefined || value.target === "" ? null : Number(value.target);
  const request: PlanRequest = { inputs, target, useGeneralists: value.useGeneralists === true };
  const problems = planProblems(request);
  return problems.length > 0 ? { ok: false, error: problems.join(" ") } : { ok: true, value: request };
}

/** What a saved plan stores of the allocation: the table, the totals and each firm. */
function storedAllocation(plan: CapacityPlan) {
  const { allocation } = plan;
  return {
    target: allocation.target,
    targetSource: plan.targetSource,
    rows: allocation.rows,
    fromTiers: allocation.fromTiers,
    generalistsProposed: allocation.generalistsProposed,
    planned: allocation.planned,
    shortfall: allocation.shortfall,
    maxAchievable: allocation.maxAchievable,
    firms: allocation.firms.map(({ firmId, name, source, score }) => ({ firmId, name, source, score })),
  };
}

function storedCapacity(plan: CapacityPlan) {
  return { ...plan.capacity, reach: plan.reach, benchmark: plan.benchmark };
}

/**
 * Saves a finalized plan as the client's next version. The plan is rebuilt
 * here from the saved run's stored rows, never taken from the browser.
 */
export async function saveCapacityPlan(
  supabase: ServiceClient,
  clientId: string,
  runId: string,
  request: PlanRequest,
  note: string,
  actor: string | null,
): Promise<Result<{ id: string; version: number }>> {
  const loaded = await loadTierRun(supabase, clientId, runId);
  if (!loaded.ok) return loaded;
  if (!loaded.value.complete) return { ok: false, error: "This run is incomplete: not every result was saved. Run the match again." };
  let plan: CapacityPlan;
  try {
    plan = buildPlan(loaded.value.rows, request);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The plan could not be calculated." };
  }
  const { data, error } = await supabase.rpc("match_save_capacity_plan", {
    p_plan: {
      client_id: clientId,
      run_id: runId,
      model_version: plan.capacity.modelVersion,
      inputs: plan.inputs,
      target: request.target,
      generalists_approved: request.useGeneralists && plan.allocation.generalistsProposed > 0,
      capacity: storedCapacity(plan),
      allocation: storedAllocation(plan),
      note: note.trim().slice(0, 1000),
      created_by: actor,
    },
  });
  if (error || !data) return { ok: false, error: planError(error?.message ?? "The plan was not saved.", error?.code) };
  const saved = data as { id: string; version: number };
  return { ok: true, value: { id: String(saved.id), version: Number(saved.version) } };
}

export type SavedPlan = {
  id: string;
  version: number;
  runId: string;
  profileVersion: number | null;
  taxonomyRevision: number;
  rulesVersion: string;
  fundDbVersion: string;
  modelVersion: string;
  inputs: CapacityInputs;
  target: number | null;
  generalistsApproved: boolean;
  capacity: Record<string, unknown>;
  allocation: ReturnType<typeof storedAllocation>;
  note: string;
  createdBy: string | null;
  createdAt: string;
};

function asPlan(row: Record<string, unknown>): SavedPlan {
  return {
    id: String(row.id),
    version: Number(row.version),
    runId: String(row.run_id),
    profileVersion: row.profile_version != null ? Number(row.profile_version) : null,
    taxonomyRevision: Number(row.taxonomy_revision ?? 0),
    rulesVersion: String(row.rules_version ?? ""),
    fundDbVersion: String(row.fund_db_version ?? ""),
    modelVersion: String(row.model_version ?? ""),
    inputs: (row.inputs ?? {}) as CapacityInputs,
    target: row.target != null ? Number(row.target) : null,
    generalistsApproved: row.generalists_approved === true,
    capacity: (row.capacity ?? {}) as Record<string, unknown>,
    allocation: (row.allocation ?? {}) as SavedPlan["allocation"],
    note: String(row.note ?? ""),
    createdBy: row.created_by != null ? String(row.created_by) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

/** The client's saved plans, newest version first. */
export async function listCapacityPlans(supabase: ServiceClient, clientId: string): Promise<Result<SavedPlan[]>> {
  const loaded = await selectAll<Record<string, unknown>>((from, to) =>
    supabase.from("match_capacity_plans").select("*").eq("client_id", clientId).order("version", { ascending: false }).range(from, to),
  );
  if (!loaded.ok) return { ok: false, error: loaded.error === MATCH_MIGRATION_MISSING ? CAPACITY_MIGRATION_MISSING : planError(loaded.error) };
  return { ok: true, value: loaded.rows.map(asPlan) };
}

/**
 * Whether a saved plan still rebuilds exactly from its run and inputs. True,
 * false, or null when the plan's model version is not the current one.
 */
export function rebuildsExactly(plan: SavedPlan, rows: Parameters<typeof buildPlan>[0], modelVersion: string) {
  if (plan.modelVersion !== modelVersion) return null;
  try {
    const rebuilt = buildPlan(rows, { inputs: plan.inputs, target: plan.target, useGeneralists: plan.generalistsApproved });
    const firms = (list: { firmId: string; source: string }[]) => list.map((f) => `${f.source}:${f.firmId}`).join("|");
    return rebuilt.capacity.firms === Number(plan.capacity.firms) && firms(rebuilt.allocation.firms) === firms(plan.allocation.firms ?? []);
  } catch {
    return false;
  }
}
