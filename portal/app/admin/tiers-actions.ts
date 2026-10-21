"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadLiveDb } from "@/lib/match/db-server";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { decideIdentity, proposeFofException, reviewFofException, runComparison, runFourTier } from "@/lib/match/tiers/server";

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

function asText(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Runs the current engine and the four-tier engine for a client and saves
 * both runs. The live Match page and its saved result are not touched.
 */
export async function runTierComparison(clientId: string): Promise<Result<{ comparisonId: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const id = asText(clientId, 64);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Unknown client." };
  try {
    const done = await runComparison(access.supabase, id, access.email);
    if (!done.ok) return done;
    revalidatePath(`/admin/clients/${id}/match/compare`);
    return { ok: true, comparisonId: done.value.comparisonId };
  } catch (err) {
    return { ok: false, error: errorText(err, "The comparison could not run.") };
  }
}

export async function proposeFof(input: {
  firmId: string;
  firmName: string;
  evidenceUrl: string;
  evidenceNote: string;
  rationale: string;
}): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const saved = await proposeFofException(
      access.supabase,
      {
        firmId: asText(input?.firmId, 200),
        firmName: asText(input?.firmName, 300),
        evidenceUrl: asText(input?.evidenceUrl, 1000),
        evidenceNote: asText(input?.evidenceNote, 2000),
        rationale: asText(input?.rationale, 2000),
      },
      access.email,
    );
    if (!saved.ok) return saved;
    revalidatePath("/admin/matching");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The exception could not be saved.") };
  }
}

export async function reviewFof(firmId: string, decision: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (decision !== "approved" && decision !== "rejected") return { ok: false, error: "Unknown decision." };
  try {
    const saved = await reviewFofException(access.supabase, asText(firmId, 200), decision, access.email);
    if (!saved.ok) return saved;
    revalidatePath("/admin/matching");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The review could not be saved.") };
  }
}

/** A four-tier run for the admin preview, saved permanently. The live Match page is not touched. */
export async function runFourTierPreview(clientId: string): Promise<Result<{ runId: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const id = asText(clientId, 64);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Unknown client." };
  try {
    const done = await runFourTier(access.supabase, id, access.email);
    if (!done.ok) return done;
    revalidatePath(`/admin/clients/${id}/match/four-tier`);
    return { ok: true, runId: done.value.runId };
  } catch (err) {
    return { ok: false, error: errorText(err, "The four-tier run failed.") };
  }
}

/** Confirms a group as one firm, or keeps its records separate. Recorded with the exact records. */
export async function decideIdentityGroup(groupKey: string, decision: string, note: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (decision !== "confirmed" && decision !== "rejected") return { ok: false, error: "Unknown decision." };
  try {
    const [taxonomy, live] = await Promise.all([loadTaxonomy(access.supabase), loadLiveDb(access.supabase)]);
    if (!taxonomy.ok) return taxonomy;
    if (!live.ok) return live;
    const saved = await decideIdentity(
      access.supabase,
      { groupKey: asText(groupKey, 600), status: decision, note: asText(note, 1000) },
      live.value.db,
      taxonomy.value,
      access.email,
    );
    if (!saved.ok) return saved;
    revalidatePath("/admin/matching/duplicates");
    revalidatePath("/admin/matching");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The decision could not be saved.") };
  }
}
