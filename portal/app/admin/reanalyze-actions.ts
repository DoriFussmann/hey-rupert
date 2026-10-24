"use server";

import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { analyzeClientMaterials, buildClientNarrative, generateIntakeBrief } from "@/app/admin/agent-actions";
import { buildMatchProfile } from "@/app/admin/match-actions";
import { latestTierRun, profileChangedSince } from "@/lib/match/tiers/server";
import type { ReanalyzeStepId } from "@/lib/reanalyze";
import { createServiceClient } from "@/lib/supabase/admin";

type StepResult = { ok: true; note: string | null } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Runs one step of Re-analyze all. The page runs the steps one after the
 * other, each in its own request: together they take longer than one
 * request may. Each step is the same action as its own button.
 */
export async function reanalyzeStep(clientId: string, step: ReanalyzeStepId): Promise<StepResult> {
  if (!UUID.test(String(clientId ?? ""))) return { ok: false, error: "Unknown client." };
  if (step === "brief") {
    const result = await generateIntakeBrief(clientId);
    return result.ok ? { ok: true, note: null } : result;
  }
  if (step === "feedback") {
    const result = await analyzeClientMaterials(clientId);
    if (!result.ok) return result;
    return {
      ok: true,
      note: result.feedback.skipped.length > 0 ? `Not readable: ${result.feedback.skipped.join(" ")}` : null,
    };
  }
  if (step === "profile") {
    const result = await buildMatchProfile(clientId);
    return result.ok ? { ok: true, note: null } : result;
  }
  if (step === "narrative") {
    const result = await buildClientNarrative(clientId);
    if (!result.ok) return result;
    return {
      ok: true,
      note: result.kept.length > 0 ? `Kept from the version the client reviewed: ${result.kept.join(", ")}.` : null,
    };
  }
  return { ok: false, error: "Unknown step." };
}

/** After a run: whether the newest match run no longer reflects the company profile. */
export async function matchNeedsRerun(clientId: string): Promise<{ ok: true; needed: boolean } | { ok: false; error: string }> {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false, error: "Service role key is not configured." };
  if (!UUID.test(String(clientId ?? ""))) return { ok: false, error: "Unknown client." };

  const supabase = createServiceClient();
  const latest = await latestTierRun(supabase, clientId);
  if (!latest.ok) return latest;
  if (!latest.value) return { ok: true, needed: false };
  const changed = await profileChangedSince(supabase, clientId, latest.value);
  if (!changed.ok) return changed;
  return { ok: true, needed: changed.value };
}
