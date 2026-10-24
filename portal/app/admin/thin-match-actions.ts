"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import { updateSectors } from "@/app/admin/profile-actions";
import { runMatchForClient } from "@/app/admin/tiers-actions";
import { loadCompanyProfile } from "@/lib/company-profile/server";
import { loadProfileState, saveProfileState } from "@/lib/match/profile-server";
import { matchPath } from "@/lib/match/shared";
import { latestTierRun, loadTierRun, previewOptions } from "@/lib/match/tiers/server";
import {
  optionsToTest,
  runLimits,
  tallyRows,
  thinness,
  thresholdProblems,
  type MatchOption,
  type TierTally,
} from "@/lib/match/tiers/thin";
import { loadThinThresholds, saveThinThresholds, suggestSectorSetups } from "@/lib/match/thin-match-server";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

async function requireAdmin() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  return { ok: true as const, supabase: createServiceClient() };
}

/** Saves the minimum Core funds and minimum funds in all tiers (one setting for every client). */
export async function saveThinThresholdsAction(input: { minCore: unknown; minTotal: unknown }): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const problems = thresholdProblems(input ?? { minCore: null, minTotal: null });
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };
  const saved = await saveThinThresholds(access.supabase, { minCore: Number(input.minCore), minTotal: Number(input.minTotal) });
  if (!saved.ok) return saved;
  revalidatePath("/admin/matching");
  return { ok: true };
}

export type TestedOption = {
  key: string;
  option: MatchOption;
  primaryLabel: string;
  secondaryLabels: string[];
  /** The AI's reason for the sectors; empty for the current setup. */
  rationale: string;
  current: boolean;
  tally: TierTally;
  meets: boolean;
};

/**
 * Asks the AI for other sector setups, then has the match engine count each
 * one with both stage reaches (nothing saved). The current setup comes first.
 */
export async function findMatchOptions(clientId: string): Promise<Result<{ options: TestedOption[] }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!UUID.test(String(clientId ?? ""))) return { ok: false, error: "Unknown client." };
  if (!isClaudeConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  const { supabase } = access;

  const [latest, state, thresholds] = await Promise.all([
    latestTierRun(supabase, clientId),
    loadProfileState(supabase, clientId),
    loadThinThresholds(supabase),
  ]);
  if (!latest.ok) return latest;
  if (!latest.value) return { ok: false, error: "Run the match first." };
  if (!state.ok) return state;
  if (!state.value) return { ok: false, error: "Fill the company profile first." };
  const run = await loadTierRun(supabase, clientId, latest.value.id);
  if (!run.ok) return run;
  const profile = await loadCompanyProfile(supabase, clientId, state.value);
  if (!profile.ok) return profile;
  const { index } = profile.value;
  const sectors = profile.value.profile.sectors;
  const primary = sectors.find((sector) => sector.role === "primary")?.nodeId ?? null;
  if (!primary) return { ok: false, error: "The company profile has no primary sector." };

  const suggested = await suggestSectorSetups(supabase, clientId, {
    tally: tallyRows(run.value.rows),
    limits: runLimits(run.value.rows),
    thresholds,
  });
  if (!suggested.ok) return suggested;

  const current: MatchOption = {
    primary,
    secondary: sectors.filter((sector) => sector.role === "secondary").map((sector) => sector.nodeId),
    stageReach: state.value.settings.stageReach,
  };
  const options = optionsToTest(current, suggested.value);
  const tested = await previewOptions(supabase, clientId, options);
  if (!tested.ok) return tested;

  const label = (id: string) => index.nodes.get(id)?.label ?? id;
  const sectorKey = (option: MatchOption) => [option.primary, ...option.secondary].join("|");
  const rationale = new Map(suggested.value.map((setup) => [[setup.primary, ...setup.secondary].join("|"), setup.rationale]));
  return {
    ok: true,
    options: tested.value.map(({ option, tally }) => ({
      key: [sectorKey(option), option.stageReach].join("|"),
      option,
      primaryLabel: label(option.primary),
      secondaryLabels: option.secondary.map(label),
      rationale: rationale.get(sectorKey(option)) ?? "",
      current: sectorKey(option) === sectorKey(current),
      tally,
      meets: !thinness(tally, thresholds).thin,
    })),
  };
}

/**
 * Applies one tested option: the sectors (a new profile version, with the
 * reason), the stage reach, then runs the match again so the Tiers tab
 * shows the result. Nothing is pushed.
 */
export async function applyMatchOption(
  clientId: string,
  option: MatchOption,
  rationale: string,
): Promise<Result<{ runId: string }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  if (!UUID.test(String(clientId ?? ""))) return { ok: false, error: "Unknown client." };
  const state = await loadProfileState(access.supabase, clientId);
  if (!state.ok) return state;
  if (!state.value) return { ok: false, error: "Fill the company profile first." };

  const primary = String(option?.primary ?? "");
  const secondary = Array.isArray(option?.secondary) ? option.secondary.map(String).filter(Boolean) : [];
  const stageReach = option?.stageReach === "next" ? "next" : "exact";
  const reason = String(rationale ?? "").trim();
  const profile = await loadCompanyProfile(access.supabase, clientId, state.value);
  if (!profile.ok) return profile;
  const sectors = profile.value.profile.sectors;
  const sameSectors =
    sectors.find((sector) => sector.role === "primary")?.nodeId === primary &&
    sectors
      .filter((sector) => sector.role === "secondary")
      .map((sector) => sector.nodeId)
      .sort()
      .join("|") === [...secondary].sort().join("|");
  if (!sameSectors) {
    const sectorsSaved = await updateSectors(clientId, {
      primary,
      secondary,
      rationale: `Thin match option: ${reason || "chosen to reach more funds that fit the company."}`,
    });
    if (!sectorsSaved.ok) return sectorsSaved;
  }

  if (state.value.settings.stageReach !== stageReach) {
    // Read again: updating the sectors saved the profile.
    const fresh = await loadProfileState(access.supabase, clientId);
    if (!fresh.ok) return fresh;
    if (!fresh.value) return { ok: false, error: "Fill the company profile first." };
    const saved = await saveProfileState(access.supabase, clientId, {
      answers: fresh.value.answers,
      settings: { ...fresh.value.settings, stageReach },
      source: "settings",
    });
    if (!saved.ok) return saved;
  }

  const ran = await runMatchForClient(clientId);
  if (!ran.ok) return ran;
  revalidatePath(matchPath(clientId, "tiers"));
  return { ok: true, runId: ran.runId };
}
