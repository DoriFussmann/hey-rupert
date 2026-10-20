"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { companyAnswers, resetSandbox, runSandboxMatch } from "@/lib/match/sandbox-server";
import type { MatchAnswers } from "@/lib/match/shared";
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
  return { ok: true as const, supabase: createServiceClient() };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function revalidateSandbox(clientId: string | null) {
  revalidatePath("/admin/fund-database");
  if (clientId) {
    revalidatePath(`/admin/clients/${clientId}/match`);
    revalidatePath(`/admin/clients/${clientId}/match/verify`);
  }
}

/** Saves the sandbox profile and runs the match. Returns where to go next. */
export async function runSandbox(answers: MatchAnswers): Promise<Result<{ clientId: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const done = await runSandboxMatch(access.supabase, answers);
    if (!done.ok) return { ok: false, error: done.error };
    revalidateSandbox(done.value.clientId);
    return { ok: true, clientId: done.value.clientId };
  } catch (err) {
    return { ok: false, error: errorText(err, "The sandbox match did not run.") };
  }
}

/** A real company's matching inputs, to copy into the sandbox form. */
export async function copyCompanyToSandbox(clientId: string): Promise<Result<{ answers: MatchAnswers }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const loaded = await companyAnswers(access.supabase, String(clientId));
    if (!loaded.ok) return { ok: false, error: loaded.error };
    return { ok: true, answers: loaded.value };
  } catch (err) {
    return { ok: false, error: errorText(err, "The company profile could not be loaded.") };
  }
}

/** Clears the sandbox's reviews, decisions, verification runs and pushed list. */
export async function resetSandboxData(): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const done = await resetSandbox(access.supabase);
    if (!done.ok) return { ok: false, error: done.error };
    revalidateSandbox(done.value.clientId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The sandbox could not be reset.") };
  }
}
