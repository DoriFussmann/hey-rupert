"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { cleanRequest, saveCapacityPlan } from "@/lib/match/capacity/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Saves a finalized capacity plan as the client's next version. Planning
 * only: it never pushes a list, changes a run or sends anything.
 */
export async function saveCapacityPlanAction(
  clientId: string,
  runId: string,
  request: unknown,
  note: string,
): Promise<Result<{ version: number }>> {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false, error: "Service role key is not configured." };
  const client = String(clientId ?? "");
  const run = String(runId ?? "");
  if (!UUID.test(client) || !UUID.test(run)) return { ok: false, error: "Unknown client or run." };
  const cleaned = cleanRequest(request);
  if (!cleaned.ok) return cleaned;
  try {
    const saved = await saveCapacityPlan(createServiceClient(), client, run, cleaned.value, typeof note === "string" ? note : "", user.email ?? null);
    if (!saved.ok) return saved;
    revalidatePath(`/admin/clients/${client}/match/capacity`);
    return { ok: true, version: saved.value.version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The plan was not saved." };
  }
}
