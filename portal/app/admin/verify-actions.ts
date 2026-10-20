"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import {
  applyVerificationActions,
  clearCorrectionFlag,
  deleteCorrection,
  finishVerificationBatch,
  loadVerifyOverview,
  runVerificationStep,
  saveCorrection,
  setLeadStatus,
  startVerificationRun,
} from "@/lib/match/verify-server";
import type {
  ActionInput,
  BatchDone,
  ContactResult,
  FlaggedChoice,
  LeadRow,
  RunState,
  StepNumber,
  VerifyOverview,
  VerifyScope,
} from "@/lib/match/verify";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function requireAdmin() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false as const, error: "Service role key is not configured." };
  }
  return { ok: true as const, supabase: createServiceClient(), email: user.email ?? null };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function revalidateClient(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}/match/verify`);
  revalidatePath("/admin/fund-database");
}

export async function getVerifyOverview(clientId: string): Promise<Result<{ overview: VerifyOverview }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const loaded = await loadVerifyOverview(access.supabase, String(clientId));
    if (!loaded.ok) return { ok: false, error: loaded.error };
    return { ok: true, overview: loaded.value };
  } catch (err) {
    return { ok: false, error: errorText(err, "The verification could not be loaded.") };
  }
}

export async function startVerification(
  clientId: string,
  scope: VerifyScope,
  choices: { id: string; choice: FlaggedChoice }[],
  limit: number,
): Promise<Result<{ run: RunState }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const started = await startVerificationRun(
      access.supabase,
      String(clientId),
      scope,
      Array.isArray(choices) ? choices.slice(0, 5000) : [],
      Number(limit) || 0,
      access.email,
    );
    if (!started.ok) return { ok: false, error: started.error };
    revalidateClient(clientId);
    return { ok: true, run: started.value };
  } catch (err) {
    return { ok: false, error: errorText(err, "The verification could not start.") };
  }
}

export async function runVerifyStep(
  clientId: string,
  runId: string,
  batch: number,
  step: StepNumber,
): Promise<Result<{ results: ContactResult[] }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (step !== 1 && step !== 2 && step !== 3) return { ok: false, error: "Unknown step." };
  try {
    const done = await runVerificationStep(access.supabase, String(clientId), String(runId), Number(batch), step);
    if (!done.ok) return { ok: false, error: done.error };
    return { ok: true, results: done.value };
  } catch (err) {
    return { ok: false, error: errorText(err, "The step did not finish.") };
  }
}

export async function finishVerifyBatch(
  clientId: string,
  runId: string,
  batch: number,
  ms: number,
): Promise<Result<{ batch: BatchDone }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const done = await finishVerificationBatch(access.supabase, String(clientId), String(runId), Number(batch), Number(ms));
    if (!done.ok) return { ok: false, error: done.error };
    if (done.value.status === "done") revalidateClient(clientId);
    return { ok: true, batch: done.value };
  } catch (err) {
    return { ok: false, error: errorText(err, "The batch was not saved.") };
  }
}

export async function applyVerifyActions(
  clientId: string,
  items: ActionInput[],
): Promise<Result<{ updated: { id: string; decision: "keep" | "remove" | null; corrected: boolean }[] }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "Choose at least one action." };
  try {
    const done = await applyVerificationActions(access.supabase, String(clientId), items.slice(0, 5000), access.email);
    if (!done.ok) return { ok: false, error: done.error };
    revalidateClient(clientId);
    return { ok: true, updated: done.value };
  } catch (err) {
    return { ok: false, error: errorText(err, "The actions were not saved.") };
  }
}

// ---------------------------------------------------------------------------
// Fund Database page

export async function updateCorrection(
  firmId: string,
  key: string,
  input: { email?: string; firstName?: string; lastName?: string; title?: string; note?: string },
): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const error = await saveCorrection(access.supabase, String(firmId), String(key), input ?? {}, access.email);
  if (error) return { ok: false, error };
  revalidatePath("/admin/fund-database");
  return { ok: true };
}

export async function clearContactFlag(firmId: string, key: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const error = await clearCorrectionFlag(access.supabase, String(firmId), String(key), access.email);
  if (error) return { ok: false, error };
  revalidatePath("/admin/fund-database");
  return { ok: true };
}

export async function removeCorrection(firmId: string, key: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const error = await deleteCorrection(access.supabase, String(firmId), String(key));
  if (error) return { ok: false, error };
  revalidatePath("/admin/fund-database");
  return { ok: true };
}

export async function updateLeadStatus(id: string, status: LeadRow["status"]): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const error = await setLeadStatus(access.supabase, String(id), status);
  if (error) return { ok: false, error };
  revalidatePath("/admin/fund-database");
  return { ok: true };
}
