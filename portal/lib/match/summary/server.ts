import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { DryStep } from "@/lib/match/dry/core";
import { checkAgainstDatabase, currentLandscape } from "@/lib/match/landscape/server";
import type { CheckRow } from "@/lib/match/landscape/check";
import type { Competitor } from "@/lib/match/landscape/core";
import type { Investor } from "@/lib/match/landscape/investors";
import { confirmedRoster } from "@/lib/match/roster/server";
import { savedPlan } from "@/lib/match/plan/server";
import { landscapeSummary, matchingSummary, type Summary } from "./core.ts";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const SUMMARY_MIGRATION = "The matching summary tables are missing. Run portal/supabase/match_summary.sql in the Supabase SQL editor.";

function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /match_finalizations|client_deliverables/.test(message) || message.toLowerCase().includes("schema cache")
    ? SUMMARY_MIGRATION
    : message;
}

export type DeliverableKind = "matching" | "landscape";

export type Finalization = {
  id: string;
  matching: Summary;
  landscape: Summary | null;
  finalizedAt: string;
  finalizedBy: string | null;
  /** When each summary was last pushed to the client page (null: not yet, or not since this finalize). */
  pushed: Record<DeliverableKind, string | null>;
};

export type Deliverable = { id: string; kind: DeliverableKind; content: Summary; pushedAt: string; pushedBy: string | null };

/** The matching's current finalization, if it is finalized. */
export async function currentFinalization(supabase: ServiceClient, clientId: string): Promise<Result<Finalization | null>> {
  const { data, error } = await supabase
    .from("match_finalizations")
    .select("id, matching, landscape, finalized_at, finalized_by")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("finalized_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; matching: Summary; landscape: Summary | null; finalized_at: string; finalized_by: string | null }>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data) return { ok: true, value: null };
  const pushes = await supabase
    .from("client_deliverables")
    .select("kind, pushed_at")
    .eq("client_id", clientId)
    .eq("finalization_id", data.id)
    .is("cleared_at", null);
  if (pushes.error) return { ok: false, error: tableError(pushes.error.message, pushes.error.code) };
  const pushed: Record<DeliverableKind, string | null> = { matching: null, landscape: null };
  for (const p of (pushes.data ?? []) as { kind: DeliverableKind; pushed_at: string }[]) pushed[p.kind] = p.pushed_at;
  return {
    ok: true,
    value: { id: data.id, matching: data.matching, landscape: data.landscape, finalizedAt: data.finalized_at, finalizedBy: data.finalized_by, pushed },
  };
}

/**
 * The error to give when a step is changed while the matching is finalized,
 * or null. A missing table means nothing was ever finalized.
 */
export async function lockedError(supabase: ServiceClient, clientId: string): Promise<string | null> {
  const { data, error } = await supabase.from("match_finalizations").select("id").eq("client_id", clientId).is("cleared_at", null).limit(1);
  if (error) return null;
  return data && data.length ? "The matching is finalized. Reopen matching to change a step." : null;
}

/** Builds both summaries from what each step confirmed. */
async function build(supabase: ServiceClient, clientId: string): Promise<Result<{ matching: Summary; landscape: Summary | null; planId: string }>> {
  const { data: client } = await supabase.from("clients").select("company_name").eq("id", clientId).maybeSingle<{ company_name: string | null }>();
  const clientName = client?.company_name ?? "";
  const plan = await savedPlan(supabase, clientId);
  if (!plan.ok) return plan;
  if (!plan.value) return { ok: false, error: "Confirm Step 4 first." };
  const roster = await confirmedRoster(supabase, clientId);
  if (!roster.ok) return roster;
  if (!roster.value) return { ok: false, error: "Confirm Step 3 first." };
  const { data: dry, error: dryError } = await supabase
    .from("dry_match_lists")
    .select("total_funds, steps, fund_count")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ total_funds: number; fund_count: number; steps: { step: DryStep; chosenLabels: string[]; before: number; removed: number; left: number }[] }>();
  if (dryError) return { ok: false, error: dryError.message };
  if (!dry) return { ok: false, error: "Confirm Step 1 first." };

  let landscape: { competitors: Competitor[]; investors: Investor[] } | null = null;
  let rows: CheckRow[] = [];
  if (!roster.value.facts.step2Skipped) {
    const land = await currentLandscape(supabase, clientId);
    if (!land.ok) return land;
    if (land.value) {
      landscape = { competitors: land.value.competitors, investors: land.value.investors };
      const check = await checkAgainstDatabase(supabase, clientId);
      if (!check.ok) return check;
      rows = check.value.rows;
    }
  }
  const p = plan.value;
  const matching = matchingSummary({
    clientName,
    dry: { totalFunds: dry.total_funds, steps: dry.steps, fundCount: dry.fund_count },
    landscape,
    rows,
    roster: roster.value.counts,
    plan: { inputs: p.inputs, capacityContacts: p.capacity.contacts, planned: p.planned, funds: p.funds },
  });
  const overview = landscape
    ? landscapeSummary({ clientName, competitors: landscape.competitors, investors: landscape.investors, rows, outreach: new Set(p.planned.map((x) => x.firmId)) })
    : null;
  return { ok: true, value: { matching, landscape: overview, planId: p.id } };
}

/** Finalize: closes the matching. The summaries are saved as they stand and the steps lock. */
export async function finalizeMatching(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<null>> {
  const built = await build(supabase, clientId);
  if (!built.ok) return built;
  const cleared = await supabase.from("match_finalizations").update({ cleared_at: new Date().toISOString(), cleared_by: actor }).eq("client_id", clientId).is("cleared_at", null);
  if (cleared.error) return { ok: false, error: tableError(cleared.error.message, cleared.error.code) };
  const { error } = await supabase.from("match_finalizations").insert({
    client_id: clientId,
    plan_id: built.value.planId,
    matching: built.value.matching,
    landscape: built.value.landscape,
    finalized_by: actor,
  });
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: null };
}

/** Reopen matching: the steps unlock. What was pushed to the client page stays there until pushed again. */
export async function reopenMatching(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<null>> {
  const { error } = await supabase.from("match_finalizations").update({ cleared_at: new Date().toISOString(), cleared_by: actor }).eq("client_id", clientId).is("cleared_at", null);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: null };
}

/** Push to Client: the summary goes to the client's admin page (not the client's portal), replacing the one there. */
export async function pushToClient(supabase: ServiceClient, clientId: string, kind: DeliverableKind, actor: string | null): Promise<Result<null>> {
  const fin = await currentFinalization(supabase, clientId);
  if (!fin.ok) return fin;
  if (!fin.value) return { ok: false, error: "Finalize the matching first." };
  const content = kind === "matching" ? fin.value.matching : fin.value.landscape;
  if (!content) return { ok: false, error: "There is no Competitive Landscape Overview (Step 2 was skipped)." };
  const at = new Date().toISOString();
  const cleared = await supabase.from("client_deliverables").update({ cleared_at: at, cleared_by: actor }).eq("client_id", clientId).eq("kind", kind).is("cleared_at", null);
  if (cleared.error) return { ok: false, error: tableError(cleared.error.message, cleared.error.code) };
  const { error } = await supabase.from("client_deliverables").insert({ client_id: clientId, kind, content, finalization_id: fin.value.id, pushed_by: actor });
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: null };
}

/** Push to Client, both summaries at once (the overview only when there is one). */
export async function pushAllToClient(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<null>> {
  const fin = await currentFinalization(supabase, clientId);
  if (!fin.ok) return fin;
  if (!fin.value) return { ok: false, error: "Finalize the matching first." };
  const kinds: DeliverableKind[] = fin.value.landscape ? ["matching", "landscape"] : ["matching"];
  for (const kind of kinds) {
    const done = await pushToClient(supabase, clientId, kind, actor);
    if (!done.ok) return done;
  }
  return { ok: true, value: null };
}

/** What was pushed to the client page, matching first. */
export async function loadDeliverables(supabase: ServiceClient, clientId: string): Promise<Result<Deliverable[]>> {
  const { data, error } = await supabase
    .from("client_deliverables")
    .select("id, kind, content, pushed_at, pushed_by")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("kind", { ascending: false });
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return {
    ok: true,
    value: ((data ?? []) as { id: string; kind: DeliverableKind; content: Summary; pushed_at: string; pushed_by: string | null }[]).map((d) => ({
      id: d.id,
      kind: d.kind,
      content: d.content,
      pushedAt: d.pushed_at,
      pushedBy: d.pushed_by,
    })),
  };
}
