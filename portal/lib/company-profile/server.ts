import "server-only";
import { buildProfile } from "@/lib/match/profile-server";
import type { MatchAnswers, MatchProfileState, MatchSettings } from "@/lib/match/shared";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { TaxIndex } from "@/lib/taxonomy/core";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import {
  answerList,
  answersBasis,
  applyAiClassification,
  fromEngineProfile,
  openBuildProblems,
  reconcile,
  sectorAnswers,
  validateProfile,
  type AiClassification,
  type ClassSource,
  type CompanyProfile,
  type ProfileIssue,
  type Readiness,
  type VersionSource,
} from "@/lib/company-profile/core";
import { interviewGuide } from "@/lib/company-profile/prompt";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const PROFILE_MIGRATION_MISSING =
  "Company profile versions are not set up in the database yet. Run portal/supabase/company_profiles.sql in Supabase.";

function tableError(message: string, code?: string) {
  if (code === "42P01" || code === "PGRST205" || /company_profile_versions/.test(message)) return PROFILE_MIGRATION_MISSING;
  return message;
}

// ---------------------------------------------------------------------------
// From the saved answers

/** The canonical profile behind saved answers, as the current engine reads them. */
export function deriveFromAnswers(
  answers: MatchAnswers,
  settings: MatchSettings,
  index: TaxIndex,
  meta: { interviewAt: string | null; source: ClassSource },
): CompanyProfile {
  const built = buildProfile(answers, settings);
  const industries = answers.core_industry;
  return fromEngineProfile(
    built.profile,
    {
      existingInvestors: answerList(answers.existing_investors),
      alreadyPitched: answerList(answers.already_pitched),
      noGo: answerList(answers.no_go),
      competitors: answerList(answers.competitors),
      explicitIndustries: Array.isArray(industries) && industries.length > 0,
      hqState: typeof answers.hq_state === "string" ? answers.hq_state : "",
    },
    index,
    { basis: answersBasis(answers), interviewAt: meta.interviewAt, source: meta.source, converterWarnings: built.warnings },
  );
}

/** The engine's sector answers for a profile's sectors, merged into the saved answers. */
export function answersWithSectors(answers: MatchAnswers, profile: CompanyProfile, index: TaxIndex) {
  const { verticals, industries, unusable } = sectorAnswers(profile, index);
  const next: MatchAnswers = { ...answers };
  if (verticals.length > 0) next.core_vertical = verticals;
  else delete next.core_vertical;
  if (industries.length > 0) next.core_industry = industries;
  else delete next.core_industry;
  return { answers: next, unusable };
}

/**
 * Builds the profile from the intake: the AI's classification, checked
 * against the taxonomy and the founder's own words, on top of the answers.
 * Returns answers whose sector fields follow the classification.
 */
export function profileFromIntake(input: {
  answers: MatchAnswers;
  settings: MatchSettings;
  index: TaxIndex;
  classification: AiClassification;
  transcript: string;
  interviewAt: string;
}) {
  const base = deriveFromAnswers(input.answers, input.settings, input.index, { interviewAt: input.interviewAt, source: "ai" });
  const applied = applyAiClassification(base, input.classification, input.index, input.transcript);
  const { answers, unusable } = answersWithSectors(input.answers, applied.profile, input.index);
  return { profile: applied.profile, problems: applied.problems, answers, unusable };
}

// ---------------------------------------------------------------------------
// Versions

export type ProfileVersion = {
  version: number;
  profile: CompanyProfile;
  readiness: Readiness;
  source: VersionSource;
  taxonomyRevision: number;
  note: string;
  createdBy: string | null;
  createdAt: string;
};

function asVersion(row: Record<string, unknown>): ProfileVersion {
  return {
    version: Number(row.version),
    profile: row.profile as CompanyProfile,
    readiness: (["blocked", "limited", "ready"].includes(String(row.readiness)) ? row.readiness : "blocked") as Readiness,
    source: String(row.source) as VersionSource,
    taxonomyRevision: Number(row.taxonomy_revision ?? 0),
    note: String(row.note ?? ""),
    createdBy: row.created_by != null ? String(row.created_by) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export async function loadVersions(supabase: ServiceClient, clientId: string, limit = 20): Promise<Result<ProfileVersion[]>> {
  const { data, error } = await supabase
    .from("company_profile_versions")
    .select("*")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: (data ?? []).map(asVersion) };
}

/**
 * Saves a new version; never overwrites one. Problems found while building
 * (from the AI's output) are stored with it, so the review shows them later.
 */
export async function saveVersion(
  supabase: ServiceClient,
  clientId: string,
  input: { profile: CompanyProfile; index: TaxIndex; source: VersionSource; actor: string | null; note?: string; problems: ProfileIssue[] },
): Promise<Result<ProfileVersion>> {
  const profile: CompanyProfile & { buildProblems?: ProfileIssue[] } = {
    ...input.profile,
    provenance: { ...input.profile.provenance, taxonomyRevision: input.index.taxonomy.revision },
    buildProblems: openBuildProblems(input.profile, input.problems),
  };
  const { readiness } = validateProfile(profile, input.index, profile.buildProblems);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const latest = await loadVersions(supabase, clientId, 1);
    if (!latest.ok) return latest;
    const version = (latest.value[0]?.version ?? 0) + 1;
    const { data, error } = await supabase
      .from("company_profile_versions")
      .insert({
        client_id: clientId,
        version,
        profile,
        readiness,
        source: input.source,
        taxonomy_revision: input.index.taxonomy.revision,
        note: (input.note ?? "").slice(0, 500),
        created_by: input.actor,
      })
      .select("*")
      .single();
    if (!error && data) return { ok: true, value: asVersion(data) };
    if (error?.code !== "23505") return { ok: false, error: tableError(error?.message ?? "The profile version was not saved.", error?.code) };
  }
  return { ok: false, error: "Someone else saved the profile at the same time. Reload and try again." };
}

export type CurrentProfile = {
  profile: CompanyProfile;
  /** Problems recorded when the profile was built (e.g. an invalid AI category). */
  buildProblems: ProfileIssue[];
  version: ProfileVersion | null;
  /** The saved answers changed after the latest version (edited before this feature, or elsewhere). */
  outOfSync: boolean;
};

/**
 * The client's current canonical profile: the latest version, brought in line
 * with the saved answers if they changed since; or, with no version yet, the
 * legacy profile derived from the answers. Nothing is written here.
 */
export async function currentProfile(
  supabase: ServiceClient,
  clientId: string,
  state: MatchProfileState,
  index: TaxIndex,
  actor: string | null = null,
): Promise<Result<CurrentProfile>> {
  const versions = await loadVersions(supabase, clientId, 1);
  if (!versions.ok) return versions;
  const latest = versions.value[0] ?? null;
  const derived = deriveFromAnswers(state.answers, state.settings, index, {
    interviewAt: state.sourceInterviewAt,
    source: "legacy",
  });
  if (!latest) return { ok: true, value: { profile: derived, buildProblems: [], version: null, outOfSync: false } };
  const stored = latest.profile as CompanyProfile & { buildProblems?: ProfileIssue[] };
  const buildProblems = openBuildProblems(stored, stored.buildProblems ?? []);
  if (stored.provenance?.basis === derived.provenance.basis) {
    return { ok: true, value: { profile: stored, buildProblems, version: latest, outOfSync: false } };
  }
  const merged = reconcile(stored, derived, actor);
  return { ok: true, value: { profile: merged, buildProblems, version: latest, outOfSync: true } };
}

/** The interview guide text, with the sector names when the taxonomy is available. */
export async function loadInterviewGuide(supabase: ServiceClient) {
  const taxonomy = await loadTaxonomy(supabase);
  return interviewGuide(taxonomy.ok ? taxonomy.value : null);
}

/**
 * The profile Phase 3 matches on, by category id. Built from the latest
 * version (or the legacy profile), with its readiness and open issues.
 */
export async function loadCompanyProfile(
  supabase: ServiceClient,
  clientId: string,
  state: MatchProfileState,
): Promise<Result<CurrentProfile & { index: TaxIndex }>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const current = await currentProfile(supabase, clientId, state, taxonomy.value);
  if (!current.ok) return current;
  return { ok: true, value: { ...current.value, index: taxonomy.value } };
}

/**
 * After the profile fields were edited: a new version that keeps evidence and
 * decisions for unchanged categories and records changed ones as the admin's.
 */
export async function versionAfterEdit(
  supabase: ServiceClient,
  clientId: string,
  before: MatchProfileState | null,
  after: MatchProfileState,
  index: TaxIndex,
  actor: string | null,
): Promise<Result<ProfileVersion>> {
  let previous: CompanyProfile | null = null;
  let problems: ProfileIssue[] = [];
  if (before) {
    const current = await currentProfile(supabase, clientId, before, index, actor);
    if (!current.ok) return current;
    previous = current.value.profile;
    problems = current.value.buildProblems;
  }
  const derived = deriveFromAnswers(after.answers, after.settings, index, {
    interviewAt: after.sourceInterviewAt,
    source: "legacy",
  });
  const profile = reconcile(previous, derived, actor);
  return saveVersion(supabase, clientId, { profile, index, source: "admin_edit", actor, problems, note: "Profile fields edited." });
}
