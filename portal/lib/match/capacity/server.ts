import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { MATCH_MIGRATION_MISSING, selectAll } from "@/lib/match/db-server";
import { latestTierRun, loadTierRun } from "@/lib/match/tiers/server";
import type { StoredResult } from "@/lib/match/tiers/stored";
import { SOURCES, SOURCE_LABEL, type AllocationRow, type Counts, type PlanSource, type RemovedFirm } from "@/lib/match/capacity/allocate";
import { buildPlan, confirmProblems, planProblems, type CampaignPlan, type PlanRequest } from "@/lib/match/capacity/plan";
import { INPUT_LIMITS, type CapacityInputs } from "@/lib/match/capacity/schedule";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const CAPACITY_MIGRATION_MISSING =
  "Campaign plans are not set up in the database yet. Run portal/supabase/match_capacity.sql in Supabase.";

const REASON_MAX = 500;

function planError(message: string, code?: string) {
  if (code === "42P01" || code === "42883" || code === "PGRST202" || code === "PGRST205" || /match_capacity_plans|match_save_capacity_plan/.test(message)) {
    return CAPACITY_MIGRATION_MISSING;
  }
  return message;
}

/** A plan request from the browser: every value checked; nothing is trusted. Removals are never taken from the browser. */
export function cleanRequest(raw: unknown): Result<PlanRequest> {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawInputs = (value.inputs && typeof value.inputs === "object" ? value.inputs : {}) as Record<string, unknown>;
  const inputs = {} as CapacityInputs;
  for (const key of Object.keys(INPUT_LIMITS) as (keyof CapacityInputs)[]) inputs[key] = Number(rawInputs[key]);
  let counts: Counts | null = null;
  if (value.counts && typeof value.counts === "object") {
    const rawCounts = value.counts as Record<string, unknown>;
    counts = Object.fromEntries(SOURCES.map((source) => [source, Number(rawCounts[source] ?? 0)])) as Counts;
  }
  const request: PlanRequest = { inputs, counts, useGeneralists: value.useGeneralists === true, removed: [] };
  const problems = planProblems(request);
  return problems.length > 0 ? { ok: false, error: problems.join(" ") } : { ok: true, value: request };
}

export type StoredFirm = { firmId: string; name: string; source: PlanSource; score: number | null };

/** What a saved campaign plan stores of the allocation. `kind` tells it apart from earlier capacity plans. */
export type StoredAllocation = {
  kind: "campaign";
  counts: Counts;
  total: number;
  fundsRequired: number;
  monthsNeeded: number | null;
  rows: AllocationRow[];
  requested: number;
  planned: number;
  shortfall: number;
  firms: StoredFirm[];
  removed: RemovedFirm[];
  /** The change that made this version, when it was a removal. */
  change?: { removed: StoredFirm; replacedBy: StoredFirm | null };
};

function storedFirm(firm: { firmId: string; name: string; source: PlanSource; score: number | null }): StoredFirm {
  return { firmId: firm.firmId, name: firm.name, source: firm.source, score: firm.score };
}

function storedAllocation(plan: CampaignPlan): StoredAllocation {
  const { allocation } = plan;
  return {
    kind: "campaign",
    counts: allocation.counts,
    total: plan.total,
    fundsRequired: plan.fundsRequired,
    monthsNeeded: plan.monthsNeeded,
    rows: allocation.rows,
    requested: allocation.requested,
    planned: allocation.planned,
    shortfall: allocation.shortfall,
    firms: allocation.firms.map(storedFirm),
    removed: allocation.removed,
  };
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
  generalistsApproved: boolean;
  capacity: Record<string, unknown>;
  /** Null for plans saved by the earlier capacity calculator. */
  allocation: StoredAllocation | null;
  note: string;
  createdBy: string | null;
  createdAt: string;
};

function asAllocation(value: unknown): StoredAllocation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<StoredAllocation>;
  if (raw.kind !== "campaign" || !raw.counts || !Array.isArray(raw.firms) || !Array.isArray(raw.rows)) return null;
  return { ...raw, removed: Array.isArray(raw.removed) ? raw.removed : [] } as StoredAllocation;
}

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
    generalistsApproved: row.generalists_approved === true,
    capacity: (row.capacity ?? {}) as Record<string, unknown>,
    allocation: asAllocation(row.allocation),
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

/** The confirmed campaign plan of one run: its newest version, or null. */
export function planForRun(plans: SavedPlan[], runId: string): SavedPlan | null {
  return plans.find((plan) => plan.runId === runId && plan.allocation !== null) ?? null;
}

export async function loadPlanForRun(supabase: ServiceClient, clientId: string, runId: string): Promise<Result<SavedPlan | null>> {
  const plans = await listCapacityPlans(supabase, clientId);
  if (!plans.ok) return plans;
  return { ok: true, value: planForRun(plans.value, runId) };
}

/** The run row keys a plan includes: the four tiers and any approved generalists. */
export function plannedIds(plan: SavedPlan): Set<string> {
  return new Set((plan.allocation?.firms ?? []).map((firm) => firm.firmId));
}

function requestOf(plan: SavedPlan, removed: RemovedFirm[]): PlanRequest {
  return { inputs: plan.inputs, counts: plan.allocation?.counts ?? null, useGeneralists: plan.generalistsApproved, removed };
}

async function savePlan(
  supabase: ServiceClient,
  clientId: string,
  runId: string,
  plan: CampaignPlan,
  useGeneralists: boolean,
  allocation: StoredAllocation,
  note: string,
  actor: string | null,
): Promise<Result<{ id: string; version: number }>> {
  const { data, error } = await supabase.rpc("match_save_capacity_plan", {
    p_plan: {
      client_id: clientId,
      run_id: runId,
      model_version: plan.capacity.modelVersion,
      inputs: plan.inputs,
      target: plan.total,
      generalists_approved: useGeneralists,
      capacity: { ...plan.capacity, benchmark: plan.benchmark },
      allocation,
      note: note.trim().slice(0, 1000),
      created_by: actor,
    },
  });
  if (error || !data) return { ok: false, error: planError(error?.message ?? "The plan was not saved.", error?.code) };
  const saved = data as { id: string; version: number };
  return { ok: true, value: { id: String(saved.id), version: Number(saved.version) } };
}

/** The rows of the client's newest run, when it is `runId` and complete: plans are only confirmed against it. */
async function latestRunRows(supabase: ServiceClient, clientId: string, runId: string): Promise<Result<StoredResult[]>> {
  const latest = await latestTierRun(supabase, clientId);
  if (!latest.ok) return latest;
  if (latest.value?.id !== runId) return { ok: false, error: "A newer run exists for this client. Reload the page and plan from that one." };
  const loaded = await loadTierRun(supabase, clientId, runId);
  if (!loaded.ok) return loaded;
  if (!loaded.value.complete) return { ok: false, error: "This run is incomplete: not every result was saved. Run the match again." };
  return { ok: true, value: loaded.value.rows };
}

/**
 * Confirms a campaign plan for the client's newest run, as its next version.
 * The plan is rebuilt here from the saved run's rows, never taken from the
 * browser. Funds already removed from this run's plan stay removed.
 */
export async function confirmPlan(
  supabase: ServiceClient,
  clientId: string,
  runId: string,
  request: PlanRequest,
  note: string,
  actor: string | null,
): Promise<Result<{ id: string; version: number }>> {
  if (!request.counts) return { ok: false, error: "Calculate the split before confirming." };
  const rows = await latestRunRows(supabase, clientId, runId);
  if (!rows.ok) return rows;
  const previous = await loadPlanForRun(supabase, clientId, runId);
  if (!previous.ok) return previous;
  const removed = previous.value?.allocation?.removed ?? [];
  let plan: CampaignPlan;
  try {
    plan = buildPlan(rows.value, { ...request, removed });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The plan could not be calculated." };
  }
  const problems = confirmProblems(plan);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };
  return savePlan(supabase, clientId, runId, plan, request.useGeneralists, storedAllocation(plan), note, actor);
}

/**
 * Takes one fund out of the confirmed plan, as a new version. The next fund
 * in the same tier moves in when there is one; the version records both.
 */
export async function removeFromPlan(
  supabase: ServiceClient,
  clientId: string,
  runId: string,
  firmId: string,
  reason: string,
  actor: string | null,
): Promise<Result<{ version: number; replacedBy: string | null }>> {
  const why = reason.trim().slice(0, REASON_MAX);
  if (!why) return { ok: false, error: "Say why the fund is leaving the campaign." };
  const rows = await latestRunRows(supabase, clientId, runId);
  if (!rows.ok) return rows;
  const current = await loadPlanForRun(supabase, clientId, runId);
  if (!current.ok) return current;
  const plan = current.value;
  if (!plan?.allocation) return { ok: false, error: "Confirm a plan for this run first." };
  const leaving = plan.allocation.firms.find((firm) => firm.firmId === firmId);
  if (!leaving) return { ok: false, error: "That fund is not in the campaign. Reload the page." };

  const removed: RemovedFirm[] = [
    ...plan.allocation.removed,
    { firmId: leaving.firmId, name: leaving.name, source: leaving.source, reason: why, by: actor, at: new Date().toISOString() },
  ];
  let next: CampaignPlan;
  try {
    next = buildPlan(rows.value, requestOf(plan, removed));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The plan could not be calculated." };
  }
  const before = plannedIds(plan);
  const incoming = next.allocation.firms.find((firm) => !before.has(firm.firmId)) ?? null;
  const allocation: StoredAllocation = {
    ...storedAllocation(next),
    change: { removed: storedFirm(leaving), replacedBy: incoming ? storedFirm(incoming) : null },
  };
  const note = `Removed ${leaving.name} (${SOURCE_LABEL[leaving.source]}): ${why}.${incoming ? ` ${incoming.name} moved in.` : " No fund left in that tier to replace it."}`;
  const saved = await savePlan(supabase, clientId, runId, next, plan.generalistsApproved, allocation, note, actor);
  if (!saved.ok) return saved;
  return { ok: true, value: { version: saved.value.version, replacedBy: incoming?.name ?? null } };
}

/**
 * Whether a saved plan still rebuilds exactly from its run. True, false, or
 * null when its model version is not the current one or it predates campaign plans.
 */
export function rebuildsExactly(plan: SavedPlan, rows: StoredResult[], modelVersion: string) {
  if (plan.modelVersion !== modelVersion || !plan.allocation) return null;
  try {
    const rebuilt = buildPlan(rows, requestOf(plan, plan.allocation.removed));
    const firms = (list: { firmId: string; source: string }[]) => list.map((f) => `${f.source}:${f.firmId}`).join("|");
    return rebuilt.fundsRequired === plan.allocation.fundsRequired && firms(rebuilt.allocation.firms) === firms(plan.allocation.firms);
  } catch {
    return false;
  }
}
