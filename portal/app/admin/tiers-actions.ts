"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadLiveDb, matchTableError } from "@/lib/match/db-server";
import { cleanSettings, loadProfileState, saveProfileState } from "@/lib/match/profile-server";
import { REJECT_REASONS } from "@/lib/match/shared";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import {
  decideIdentity,
  proposeFofException,
  reviewFofException,
  runFourTier,
} from "@/lib/match/tiers/server";

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
    revalidatePath("/admin/taxonomy");
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
    revalidatePath("/admin/taxonomy");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The review could not be saved.") };
  }
}

const CLIENT_ID = /^[0-9a-f-]{36}$/i;

function revalidateFourTier(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin/matching");
}

/** Runs the match for a client and saves the run permanently. The Matching page shows the newest run. */
export async function runMatchForClient(clientId: string): Promise<Result<{ runId: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const id = asText(clientId, 64);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Unknown client." };
  try {
    const done = await runFourTier(access.supabase, id, access.email);
    if (!done.ok) return done;
    revalidateFourTier(id);
    return { ok: true, runId: done.value.runId };
  } catch (err) {
    return { ok: false, error: errorText(err, "The match did not run.") };
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
    revalidatePath("/admin/taxonomy/duplicates");
    revalidatePath("/admin/taxonomy");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The decision could not be saved.") };
  }
}

/**
 * Approves or rejects a fund for a client from the four-tier Match page.
 * Saved runs never change: the review applies from the next run.
 */
export async function reviewFund(
  clientId: string,
  input: { firmId: string; firmName: string; tier: string; status: string; reason: string; note: string; hideForAll: boolean },
): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const id = asText(clientId, 64);
  if (!CLIENT_ID.test(id)) return { ok: false, error: "Unknown client." };
  const firmId = asText(input?.firmId, 200).trim();
  if (!firmId) return { ok: false, error: "Unknown fund." };
  const status = input?.status === "no" ? "no" : "ok";
  const reason = asText(input?.reason, 200);
  if (status === "no" && !REJECT_REASONS.includes(reason)) return { ok: false, error: "Choose a reason for rejecting." };
  const note = asText(input?.note, 1000).trim();
  const firmName = asText(input?.firmName, 255);
  try {
    const { error } = await access.supabase.from("match_reviews").upsert(
      {
        client_id: id,
        firm_id: firmId,
        firm_name: firmName,
        status,
        reason: status === "no" ? reason : null,
        note: note || null,
        tier: asText(input?.tier, 20) || null,
        reviewed_by: access.email,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: "client_id,firm_id" },
    );
    if (error) return { ok: false, error: matchTableError(error.message, error.code) };
    if (status === "no" && input?.hideForAll === true) {
      const { error: hideError } = await access.supabase.from("match_suppressions").upsert(
        { firm_id: firmId, firm_name: firmName, reason: reason + (note ? `: ${note}` : ""), from_client: id, created_by: access.email },
        { onConflict: "firm_id" },
      );
      if (hideError) return { ok: false, error: matchTableError(hideError.message, hideError.code) };
    }
    revalidateFourTier(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The review was not saved.") };
  }
}

export async function clearFundReview(clientId: string, firmId: string): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const id = asText(clientId, 64);
  if (!CLIENT_ID.test(id)) return { ok: false, error: "Unknown client." };
  try {
    const { error } = await access.supabase.from("match_reviews").delete().eq("client_id", id).eq("firm_id", asText(firmId, 200));
    if (error) return { ok: false, error: matchTableError(error.message, error.code) };
    revalidateFourTier(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The review was not cleared.") };
  }
}

/** Saves the quality filters and website rules for the four-tier engine. They apply from the next run. */
export async function saveFourTierSettings(clientId: string, settings: unknown): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const id = asText(clientId, 64);
  if (!CLIENT_ID.test(id)) return { ok: false, error: "Unknown client." };
  try {
    const current = await loadProfileState(access.supabase, id);
    if (!current.ok) return current;
    if (!current.value) return { ok: false, error: "Fill the company profile first." };
    const next = cleanSettings(settings);
    // The four-tier engine has no tightness or wave limit: the current engine's stay as they are.
    const saved = await saveProfileState(access.supabase, id, {
      answers: current.value.answers,
      settings: { ...next, tune: current.value.settings.tune, waveSize: current.value.settings.waveSize },
      source: "settings",
    });
    if (!saved.ok) return saved;
    revalidateFourTier(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err, "The settings were not saved.") };
  }
}
