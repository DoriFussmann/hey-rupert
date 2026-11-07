import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { PlanFund, Planned } from "@/lib/match/plan/core";
import { outreachFunds, type OutreachFund } from "@/lib/outreach/source-copy";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type OutreachPlan = { planId: string; funds: OutreachFund[] };

/**
 * The funds the outreach reaches: the Plan of the current finalized matching
 * (the one whose summaries were pushed), each with its source group and hook.
 */
export async function loadOutreachPlan(supabase: ServiceClient, clientId: string): Promise<Result<OutreachPlan>> {
  const fin = await supabase
    .from("match_finalizations")
    .select("plan_id")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("finalized_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ plan_id: string | null }>();
  if (fin.error) return { ok: false, error: fin.error.message };
  if (!fin.data) return { ok: false, error: "The matching is not finalized (or was reopened). Finalize it, push it again, then draft the copy." };
  if (!fin.data.plan_id) return { ok: false, error: "The finalized matching has no Plan. Confirm Step 5 and finalize again." };

  const plan = await supabase
    .from("match_plans")
    .select("id, funds, planned")
    .eq("id", fin.data.plan_id)
    .maybeSingle<{ id: string; funds: PlanFund[] | null; planned: Planned[] | null }>();
  if (plan.error) return { ok: false, error: plan.error.message };
  if (!plan.data) return { ok: false, error: "The finalized matching's Plan was not found." };

  const funds = outreachFunds({ funds: plan.data.funds ?? [], planned: plan.data.planned ?? [] });
  if (funds.length === 0) return { ok: false, error: "The Plan reaches no funds. Check Step 5." };
  return { ok: true, value: { planId: plan.data.id, funds } };
}
