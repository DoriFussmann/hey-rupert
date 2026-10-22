"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { cleanRequest, confirmPlan, removeFromPlan } from "@/lib/match/capacity/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

async function requireAdmin() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  return { ok: true as const, actor: user.email ?? null };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Confirms the campaign plan for the client's newest run, as its next
 * version. It never pushes a list, changes a run or sends anything.
 */
export async function confirmPlanAction(clientId: string, runId: string, request: unknown, note: string): Promise<Result<{ version: number }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const client = String(clientId ?? "");
  const run = String(runId ?? "");
  if (!UUID.test(client) || !UUID.test(run)) return { ok: false, error: "Unknown client or run." };
  const cleaned = cleanRequest(request);
  if (!cleaned.ok) return cleaned;
  try {
    const saved = await confirmPlan(createServiceClient(), client, run, cleaned.value, typeof note === "string" ? note : "", access.actor);
    if (!saved.ok) return saved;
    revalidatePath("/admin/matching");
    return { ok: true, version: saved.value.version };
  } catch (err) {
    return { ok: false, error: errorText(err, "The plan was not saved.") };
  }
}

/** Takes one fund out of the confirmed campaign; the next fund in its tier moves in. */
export async function removeFromPlanAction(
  clientId: string,
  runId: string,
  firmId: string,
  reason: string,
): Promise<Result<{ version: number; replacedBy: string | null }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const client = String(clientId ?? "");
  const run = String(runId ?? "");
  const firm = String(firmId ?? "").slice(0, 200);
  if (!UUID.test(client) || !UUID.test(run) || !firm) return { ok: false, error: "Unknown client, run or fund." };
  try {
    const saved = await removeFromPlan(createServiceClient(), client, run, firm, typeof reason === "string" ? reason : "", access.actor);
    if (!saved.ok) return saved;
    revalidatePath("/admin/matching");
    return { ok: true, ...saved.value };
  } catch (err) {
    return { ok: false, error: errorText(err, "The fund was not removed.") };
  }
}
