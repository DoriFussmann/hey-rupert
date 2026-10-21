"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { copyProfileToSandbox, ensureSandbox, resetSandbox } from "@/lib/match/sandbox-server";
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

/** Creates the test client if it doesn't exist yet. */
export async function createTestClient(): Promise<Result<{ clientId: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const done = await ensureSandbox(access.supabase);
    if (!done.ok) return { ok: false, error: done.error };
    revalidatePath("/admin/matching");
    return { ok: true, clientId: done.value };
  } catch (err) {
    return { ok: false, error: errorText(err, "The test client could not be created.") };
  }
}

/** Copies a real client's company profile into the test client. */
export async function copyProfileToTestClient(sourceId: string): Promise<Result<{ clientId: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!/^[0-9a-f-]{36}$/i.test(String(sourceId ?? ""))) return { ok: false, error: "Pick a client to copy from." };
  try {
    const done = await copyProfileToSandbox(access.supabase, String(sourceId));
    if (!done.ok) return { ok: false, error: done.error };
    revalidatePath("/admin/matching");
    return { ok: true, clientId: done.value.clientId };
  } catch (err) {
    return { ok: false, error: errorText(err, "The profile could not be copied.") };
  }
}

/** Clears the test client's reviews, contact decisions, verification runs and pushed list. */
export async function resetTestClient(): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const done = await resetSandbox(access.supabase);
    if (!done.ok) return { ok: false, error: done.error };
    revalidatePath("/admin/matching");
    if (done.value.clientId) revalidatePath(`/admin/clients/${done.value.clientId}/match/verify`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The test client could not be reset.") };
  }
}
