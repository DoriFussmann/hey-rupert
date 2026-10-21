"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { DEFAULT_SETTINGS } from "@/lib/match/shared";
import { loadProfileState, saveProfileState } from "@/lib/match/profile-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { answersBasis, confirmWithFounder, setSectors } from "@/lib/company-profile/core";
import { answersWithSectors, currentProfile, saveVersion } from "@/lib/company-profile/server";
import { loadTaxonomy } from "@/lib/taxonomy/server";

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

function revalidateProfile(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath(`/admin/clients/${clientId}/profile`);
}

/** The saved profile, the taxonomy and the current canonical profile. */
async function load(clientId: string) {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const id = String(clientId ?? "");
  const [state, taxonomy] = await Promise.all([loadProfileState(access.supabase, id), loadTaxonomy(access.supabase)]);
  if (!state.ok) return { ok: false as const, error: state.error };
  if (!state.value) return { ok: false as const, error: "Fill the company profile first." };
  if (!taxonomy.ok) return { ok: false as const, error: taxonomy.error };
  const current = await currentProfile(access.supabase, id, state.value, taxonomy.value, access.email);
  if (!current.ok) return { ok: false as const, error: current.error };
  return { ok: true as const, access, id, state: state.value, index: taxonomy.value, current: current.value };
}

/**
 * Records that an admin confirmed a classification with the founder.
 * Path: "sector:<category id>", "stage", "hq_country" or "hq_state".
 */
export async function confirmClassification(clientId: string, path: string): Promise<Result<object>> {
  const loaded = await load(clientId);
  if (!loaded.ok) return loaded;
  const confirmed = confirmWithFounder(loaded.current.profile, String(path ?? ""), loaded.access.email, new Date().toISOString());
  if (!confirmed) return { ok: false, error: "That classification is not in the profile any more. Reload the page." };
  const saved = await saveVersion(loaded.access.supabase, loaded.id, {
    profile: confirmed,
    index: loaded.index,
    source: "admin_confirm",
    actor: loaded.access.email,
    problems: loaded.current.buildProblems,
    note: `Confirmed with founder: ${path}.`,
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  revalidateProfile(loaded.id);
  return { ok: true };
}

/**
 * Sets the sectors (primary plus up to two secondary) with the admin's
 * reason. The profile fields matching runs on follow, so the current engine
 * sees the same sectors.
 */
export async function updateSectors(
  clientId: string,
  input: { primary: string; secondary: string[]; rationale: string },
): Promise<Result<object>> {
  const loaded = await load(clientId);
  if (!loaded.ok) return loaded;
  const set = setSectors(
    loaded.current.profile,
    loaded.index,
    {
      primary: String(input?.primary ?? ""),
      secondary: Array.isArray(input?.secondary) ? input.secondary.map(String).filter(Boolean).slice(0, 3) : [],
      rationale: String(input?.rationale ?? ""),
    },
    loaded.access.email,
  );
  if (!set.ok) return set;

  const { answers, unusable } = answersWithSectors(loaded.state.answers, set.profile, loaded.index);
  const saved = await saveProfileState(loaded.access.supabase, loaded.id, {
    answers,
    settings: loaded.state.settings ?? DEFAULT_SETTINGS,
    source: "edit",
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  const version = await saveVersion(loaded.access.supabase, loaded.id, {
    profile: { ...set.profile, provenance: { ...set.profile.provenance, basis: answersBasis(saved.value.answers) } },
    index: loaded.index,
    source: "admin_edit",
    actor: loaded.access.email,
    problems: loaded.current.buildProblems,
    note: unusable.length > 0 ? `Sectors changed. Not usable by the current engine: ${unusable.join(", ")}.` : "Sectors changed.",
  });
  if (!version.ok) return { ok: false, error: version.error };
  revalidateProfile(loaded.id);
  return { ok: true };
}
