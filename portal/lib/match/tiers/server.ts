import "server-only";
import { createHash } from "node:crypto";
import type { FundDb, SiteResult } from "@/lib/match/engine/index.mjs";
import { applyCorrections, loadChecksForFirms, loadDecisions } from "@/lib/match/corrections-server";
import { MATCH_MIGRATION_MISSING, loadLiveDb, selectAll } from "@/lib/match/db-server";
import type { PeopleStates } from "@/lib/match/list-snapshot";
import { buildProfile, loadProfileState, matchBasis } from "@/lib/match/profile-server";
import { loadMatchContext, type MatchContext } from "@/lib/match/run-server";
import type { MatchProfileState } from "@/lib/match/shared";
import { loadSites } from "@/lib/match/sites-server";
import { matchingProfile, validateProfile, type ProfileIssue, type Readiness } from "@/lib/company-profile/core";
import { currentProfile, loadCompanyProfile, loadVersions } from "@/lib/company-profile/server";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { websiteHref, type InvestorListPayload } from "@/lib/setup";
import type { createServiceClient } from "@/lib/supabase/admin";
import { findAlias, mapFirm, type TaxIndex } from "@/lib/taxonomy/core";
import {
  FUND_OF_FUNDS,
  RULES_VERSION,
  TIER_KEYS,
  blockedReason,
  profileWarnings,
  runTiers,
  type FofException,
  type TierRun,
  type TierRunInput,
} from "@/lib/match/tiers/core";
import type { StoredResult } from "@/lib/match/tiers/stored";
import { tallyCounts, type MatchOption, type TierTally } from "@/lib/match/tiers/thin";
import {
  appliedGroups,
  duplicateFlags,
  findDuplicates,
  identityProposals,
  resolveIdentities,
  type DuplicateReport,
  type IdentityDecision,
} from "@/lib/match/tiers/duplicates";
import { verifyStateOf, type ContactStates } from "@/lib/match/tiers/export";
import { tierRows, type ResultRow } from "@/lib/match/tiers/record";
import { firmsByRowKey, fourTierClientList, pushable, reachablePeople } from "@/lib/match/tiers/client-list";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const TIERS_MIGRATION_MISSING =
  "Four-tier matching is not set up in the database yet. Run portal/supabase/match_tiers.sql in Supabase.";
export const IDENTITY_MIGRATION_MISSING =
  "Identity decisions are not set up in the database yet. Run portal/supabase/match_identity.sql in Supabase.";

function tiersError(message: string, code?: string) {
  if (/match_identity/.test(message)) return IDENTITY_MIGRATION_MISSING;
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || /match_(runs|run_results|fof_|begin_run|add_results|sandbox_resets)/.test(message)) {
    return TIERS_MIGRATION_MISSING;
  }
  return message;
}

// ---------------------------------------------------------------------------
// Fund-of-funds exceptions

export type FofRecord = FofException & {
  firmName: string;
  proposedBy: string | null;
  proposedAt: string;
  reviewedAt: string | null;
};

function asFof(row: Record<string, unknown>): FofRecord {
  const status = String(row.status);
  return {
    firmId: String(row.firm_id),
    firmName: String(row.firm_name ?? ""),
    status: status === "approved" || status === "rejected" ? status : "needs_review",
    evidenceUrl: String(row.evidence_url ?? ""),
    evidenceNote: String(row.evidence_note ?? ""),
    rationale: String(row.rationale ?? ""),
    proposedBy: row.proposed_by != null ? String(row.proposed_by) : null,
    proposedAt: String(row.proposed_at ?? ""),
    reviewedBy: row.reviewed_by != null ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at != null ? String(row.reviewed_at) : null,
  };
}

export async function loadFofExceptions(supabase: ServiceClient): Promise<Result<Map<string, FofRecord>>> {
  const loaded = await selectAll<Record<string, unknown>>((from, to) =>
    supabase.from("match_fof_exceptions").select("*").order("firm_id").range(from, to),
  );
  if (!loaded.ok) return { ok: false, error: loaded.error === MATCH_MIGRATION_MISSING ? TIERS_MIGRATION_MISSING : tiersError(loaded.error) };
  return { ok: true, value: new Map(loaded.rows.map((row) => [String(row.firm_id), asFof(row)])) };
}

/** Funds of funds in the live database: firms whose financing maps to "Fund of funds". */
export function fundsOfFunds(db: FundDb, index: TaxIndex) {
  return db.firms.filter((firm) =>
    firm.fin.some((value) => findAlias(index, "financing", value)?.nodeIds.includes(FUND_OF_FUNDS)),
  );
}

export type FofInput = { firmId: string; firmName: string; evidenceUrl: string; evidenceNote: string; rationale: string };

export function validateFofInput(input: FofInput) {
  if (!input.firmId.trim()) return "Pick a fund.";
  if (input.evidenceUrl && !/^https?:\/\/\S+\.\S+/i.test(input.evidenceUrl)) return "The evidence link must start with http:// or https://.";
  if (input.evidenceNote.trim().length < 10) return "Describe the evidence of direct investment (10 characters or more).";
  if (input.rationale.trim().length < 20) return "Explain why it justifies an exception (20 characters or more).";
  return null;
}

/** Proposes (or re-proposes) an exception. It needs review before it counts. */
export async function proposeFofException(supabase: ServiceClient, input: FofInput, actor: string | null): Promise<Result<FofRecord>> {
  const invalid = validateFofInput(input);
  if (invalid) return { ok: false, error: invalid };
  const now = new Date().toISOString();
  const row = {
    firm_id: input.firmId.trim().slice(0, 200),
    firm_name: input.firmName.trim().slice(0, 300),
    evidence_url: input.evidenceUrl.trim().slice(0, 1000),
    evidence_note: input.evidenceNote.trim().slice(0, 2000),
    rationale: input.rationale.trim().slice(0, 2000),
    status: "needs_review",
    proposed_by: actor,
    proposed_at: now,
    reviewed_by: null,
    reviewed_at: null,
    updated_by: actor,
    updated_at: now,
  };
  const { data, error } = await supabase.from("match_fof_exceptions").upsert(row, { onConflict: "firm_id" }).select("*").single();
  if (error || !data) return { ok: false, error: tiersError(error?.message ?? "The exception was not saved.", error?.code) };
  return { ok: true, value: asFof(data) };
}

export async function reviewFofException(
  supabase: ServiceClient,
  firmId: string,
  decision: "approved" | "rejected",
  actor: string | null,
): Promise<Result<FofRecord>> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("match_fof_exceptions")
    .update({ status: decision, reviewed_by: actor, reviewed_at: now, updated_by: actor, updated_at: now })
    .eq("firm_id", firmId)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: tiersError(error.message, error.code) };
  if (!data) return { ok: false, error: "That exception no longer exists. Reload the page." };
  return { ok: true, value: asFof(data) };
}

// ---------------------------------------------------------------------------
// Duplicate report (read-only: computed on request, never stored)

export async function duplicateReport(supabase: ServiceClient, db: FundDb, index: TaxIndex): Promise<Result<DuplicateReport>> {
  const first = findDuplicates(db, index);
  const ids = Array.from(new Set(first.groups.flatMap((group) => group.members.map((m) => m.id))));
  const checks = await loadChecksForFirms(supabase, ids);
  if (!checks.ok) return { ok: false, error: checks.error };
  const verified = new Map<string, Record<string, number>>();
  checks.value.forEach((check, id) => {
    if (!check.status || !check.checkedAt) return;
    const firmId = id.slice(0, id.indexOf("|"));
    const counts = verified.get(firmId) ?? {};
    counts[check.status] = (counts[check.status] ?? 0) + 1;
    verified.set(firmId, counts);
  });
  return { ok: true, value: findDuplicates(db, index, verified) };
}

// ---------------------------------------------------------------------------
// Saved runs

export type RunHeader = {
  id: string;
  clientId: string;
  clientName: string;
  isSandbox: boolean;
  engine: "legacy" | "tiers";
  rulesVersion: string;
  comparisonId: string | null;
  profileVersion: number | null;
  profileInputs: Record<string, unknown>;
  taxonomyRevision: number;
  fundDbVersion: string;
  fundDbFile: string;
  settings: Record<string, unknown>;
  counts: Record<string, unknown>;
  resultsExpected: number;
  ranBy: string | null;
  ranAt: string;
};

function asHeader(row: Record<string, unknown>): RunHeader {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    clientName: String(row.client_name ?? ""),
    isSandbox: row.is_sandbox === true,
    engine: row.engine === "legacy" ? "legacy" : "tiers",
    rulesVersion: String(row.rules_version ?? ""),
    comparisonId: row.comparison_id != null ? String(row.comparison_id) : null,
    profileVersion: row.profile_version != null ? Number(row.profile_version) : null,
    profileInputs: (row.profile_inputs ?? {}) as Record<string, unknown>,
    taxonomyRevision: Number(row.taxonomy_revision ?? 0),
    fundDbVersion: String(row.fund_db_version ?? ""),
    fundDbFile: String(row.fund_db_file ?? ""),
    settings: (row.settings ?? {}) as Record<string, unknown>,
    counts: (row.counts ?? {}) as Record<string, unknown>,
    resultsExpected: Number(row.results_expected ?? 0),
    ranBy: row.ran_by != null ? String(row.ran_by) : null,
    ranAt: String(row.ran_at ?? ""),
  };
}

const RESULT_CHUNK = 500;

/** Saves a run and its results. Both are permanent once written. */
async function saveRun(supabase: ServiceClient, header: Record<string, unknown>, rows: ResultRow[]): Promise<Result<string>> {
  const begun = await supabase.rpc("match_begin_run", { p_run: header, p_expected: rows.length });
  if (begun.error || !begun.data) return { ok: false, error: tiersError(begun.error?.message ?? "The run was not saved.", begun.error?.code) };
  const id = String(begun.data);
  for (let i = 0; i < rows.length; i += RESULT_CHUNK) {
    const added = await supabase.rpc("match_add_results", { p_run_id: id, p_rows: rows.slice(i, i + RESULT_CHUNK) });
    if (added.error) {
      return { ok: false, error: `The run was only partly saved (${i} of ${rows.length} results): ${tiersError(added.error.message, added.error.code)} It is shown as incomplete.` };
    }
  }
  return { ok: true, value: id };
}

async function loadResults(supabase: ServiceClient, runId: string): Promise<Result<StoredResult[]>> {
  const loaded = await selectAll<Record<string, unknown>>((from, to) =>
    supabase
      .from("match_run_results")
      .select("firm_id, firm_name, status, tier, reason_codes, detail, score, position")
      .eq("run_id", runId)
      .order("position")
      .range(from, to),
  );
  if (!loaded.ok) return { ok: false, error: loaded.error === MATCH_MIGRATION_MISSING ? TIERS_MIGRATION_MISSING : tiersError(loaded.error) };
  return {
    ok: true,
    value: loaded.rows.map((row) => ({
      firmId: String(row.firm_id),
      firmName: String(row.firm_name ?? ""),
      status: String(row.status) as StoredResult["status"],
      tier: row.tier != null ? String(row.tier) : null,
      reasonCodes: Array.isArray(row.reason_codes) ? (row.reason_codes as string[]) : [],
      detail: (row.detail ?? {}) as Record<string, unknown>,
      score: row.score != null ? Number(row.score) : null,
      position: Number(row.position ?? 0),
    })),
  };
}

function edgeSummary(index: TaxIndex) {
  const edges = index.taxonomy.edges;
  const cannabis = edges.find((e) => e.fromId === "sector.cannabis" && e.toId === "sector.consumer_tech");
  return {
    approved: edges.filter((e) => e.review === "approved").length,
    rejected: edges.filter((e) => e.review === "rejected").length,
    needsReview: edges.filter((e) => e.review === "needs_review").length,
    cannabisConsumerTech: cannabis ? cannabis.review : "missing",
  };
}

// ---------------------------------------------------------------------------
// Identity decisions

function asDecision(row: Record<string, unknown>): IdentityDecision {
  return {
    groupKey: String(row.group_key),
    kind: row.kind === "offices" ? "offices" : "duplicate",
    status: row.status === "rejected" ? "rejected" : "confirmed",
    memberIds: Array.isArray(row.member_ids) ? (row.member_ids as string[]).map(String) : [],
    note: String(row.note ?? ""),
    decidedBy: row.decided_by != null ? String(row.decided_by) : null,
    decidedAt: row.decided_at != null ? String(row.decided_at) : null,
  };
}

export async function loadIdentityDecisions(supabase: ServiceClient): Promise<Result<IdentityDecision[]>> {
  const loaded = await selectAll<Record<string, unknown>>((from, to) =>
    supabase.from("match_identity_groups").select("*").order("group_key").range(from, to),
  );
  if (!loaded.ok) {
    // selectAll reports any missing table as Rupert Match's own setup message.
    return { ok: false, error: loaded.error === MATCH_MIGRATION_MISSING ? IDENTITY_MIGRATION_MISSING : tiersError(loaded.error) };
  }
  return { ok: true, value: loaded.rows.map(asDecision) };
}

/** The live database's identity groups with the admin decisions applied. */
export async function resolvedIdentities(supabase: ServiceClient, db: FundDb, index: TaxIndex) {
  const decisions = await loadIdentityDecisions(supabase);
  if (!decisions.ok) return decisions;
  const report = findDuplicates(db, index);
  return { ok: true as const, value: { report, resolved: resolveIdentities(identityProposals(report), decisions.value) } };
}

/**
 * Records an admin decision for a group as the live database shows it now:
 * the exact records, with their names, websites, countries and contacts.
 */
export async function decideIdentity(
  supabase: ServiceClient,
  input: { groupKey: string; status: "confirmed" | "rejected"; note: string },
  db: FundDb,
  index: TaxIndex,
  actor: string | null,
): Promise<Result<IdentityDecision>> {
  const proposal = identityProposals(findDuplicates(db, index)).find((p) => p.key === input.groupKey);
  if (!proposal) return { ok: false, error: "This group is no longer in the Fund Database. Reload the report." };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("match_identity_groups")
    .upsert(
      {
        group_key: proposal.key,
        kind: proposal.kind,
        level: proposal.level,
        status: input.status,
        member_ids: proposal.members.map((m) => m.id),
        evidence: { shared: proposal.shared, members: proposal.members },
        note: input.note.trim().slice(0, 1000),
        decided_by: actor,
        decided_at: now,
        updated_by: actor,
        updated_at: now,
      },
      { onConflict: "group_key" },
    )
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: tiersError(error?.message ?? "The decision was not saved.", error?.code) };
  return { ok: true, value: asDecision(data) };
}

// ---------------------------------------------------------------------------
// Readiness

export type ProfileReadiness = {
  readiness: Readiness;
  /** Fields a run can't do without (stage, sector, HQ country). */
  missing: string[];
  /** Points that block the run or make it Limited, with the field they concern. */
  issues: ProfileIssue[];
};

/**
 * Whether a client's profile can be matched: Ready, Limited (runs, with
 * warnings) or Blocked (can't run), and why. Reads the profile; changes nothing.
 */
export async function profileReadiness(supabase: ServiceClient, clientId: string): Promise<Result<ProfileReadiness>> {
  const state = await loadProfileState(supabase, clientId);
  if (!state.ok) return state;
  if (!state.value) return { ok: true, value: { readiness: "blocked", missing: ["Company profile"], issues: [] } };
  const loaded = await loadCompanyProfile(supabase, clientId, state.value);
  if (!loaded.ok) return loaded;
  return { ok: true, value: readinessOf(state.value, loaded.value.profile, loaded.value.index, loaded.value.buildProblems) };
}

function readinessOf(state: MatchProfileState, profile: Parameters<typeof validateProfile>[0], index: TaxIndex, problems: ProfileIssue[]): ProfileReadiness {
  const missing = buildProfile(state.answers, state.settings).gaps.map((gap) => gap.label);
  const { issues, readiness } = validateProfile(profile, index, problems);
  const shown = issues.filter((issue) => issue.severity === "blocking" || issue.severity === "limited");
  return { readiness: missing.length > 0 ? "blocked" : readiness, missing, issues: shown };
}

/** Readiness of several clients at once (the Clients list). A client that can't be read is left out. */
export async function readinessFor(supabase: ServiceClient, clientIds: string[]): Promise<Map<string, Readiness>> {
  const out = new Map<string, Readiness>();
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return out;
  await Promise.all(
    clientIds.map(async (id) => {
      const state = await loadProfileState(supabase, id);
      if (!state.ok) return;
      if (!state.value) {
        out.set(id, "blocked");
        return;
      }
      const current = await currentProfile(supabase, id, state.value, taxonomy.value);
      if (!current.ok) return;
      out.set(id, readinessOf(state.value, current.value.profile, taxonomy.value, current.value.buildProblems).readiness);
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Running

/**
 * A fingerprint of the profile answers and settings a run used. A run whose
 * fingerprint no longer matches can't be pushed: run the match again.
 */
export function profileBasis(state: MatchProfileState) {
  return createHash("sha256").update(matchBasis(state.answers, state.settings)).digest("hex").slice(0, 32);
}

type Prepared = {
  run: MatchContext;
  db: FundDb;
  index: TaxIndex;
  input: Omit<TierRunInput, "sites">;
  common: Record<string, unknown>;
  profileInputs: Record<string, unknown>;
  settings: Record<string, unknown>;
};

/** Everything both engines need for a client, loaded once. */
async function prepare(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<Prepared>> {
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, company_name, is_match_sandbox")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client not found." };

  const context = await loadMatchContext(supabase, clientId);
  if (!context.ok) return context;
  const run = context.value;

  const loaded = await loadCompanyProfile(supabase, clientId, run.state);
  if (!loaded.ok) return loaded;
  const { profile: canonical, buildProblems, version, index } = loaded.value;
  const { issues, readiness } = validateProfile(canonical, index, buildProblems);
  const blocked = blockedReason(readiness, issues);
  if (blocked) return { ok: false, error: blocked };
  const profile = { ...matchingProfile(canonical, index), issues, readiness };

  const db = applyCorrections(run.live.db, run.corrections, run.decisions);
  const rejected: Record<string, string> = {};
  run.reviews.forEach((review, firmId) => {
    if (review.status === "no") rejected[firmId] = review.reason || "Rejected";
  });
  const suppressed: Record<string, string> = {};
  run.hidden.forEach((item) => {
    suppressed[item.id] = item.reason || "Hidden for all clients";
  });
  const fof = await loadFofExceptions(supabase);
  if (!fof.ok) return fof;
  const identity = await resolvedIdentities(supabase, db, index);
  if (!identity.ok) return identity;
  const groups = appliedGroups(identity.value.resolved);
  const grouped = new Set(groups.flatMap((g) => g.memberIds));
  // Groups not applied stay as flags; nothing is merged without a decision.
  const flags = duplicateFlags(identity.value.report);
  grouped.forEach((id) => flags.delete(id));

  const label = (id: string | null) => (id ? index.nodes.get(id)?.label ?? id : null);
  return {
    ok: true,
    value: {
      run,
      db,
      index,
      input: {
        db,
        index,
        profile,
        legacy: run.profile,
        suppressed,
        rejected,
        fofExceptions: fof.value,
        duplicates: flags,
        identities: groups,
        stageReach: run.state.settings.stageReach,
      },
      common: {
        client_id: clientId,
        client_name: String(client.company_name ?? ""),
        is_sandbox: client.is_match_sandbox === true,
        profile_version: version?.version ?? null,
        taxonomy_revision: index.taxonomy.revision,
        fund_db_version: run.live.version.id,
        fund_db_file: run.live.version.fileName,
        ran_by: actor,
      },
      profileInputs: {
        primarySector: { id: profile.primarySector, label: label(profile.primarySector) },
        secondarySectors: profile.secondarySectors.map((id) => ({ id, label: label(id) })),
        stage: { id: profile.stage, label: label(profile.stage) },
        stageReach: run.state.settings.stageReach,
        hqCountry: { id: profile.hqCountry, label: label(profile.hqCountry) },
        hqState: { id: profile.hqState, label: label(profile.hqState) },
        firmTypes: profile.firmTypes.map((id) => ({ id, label: label(id) })),
        financing: profile.financing.map((id) => ({ id, label: label(id) })),
        readiness,
        unconfirmed: profile.unconfirmed.map((id) => ({ id, label: label(id) })),
        warnings: profileWarnings(issues),
        relationships: edgeSummary(index),
        legacyProfile: { stage: run.profile.stage, verticals: run.profile.verticals, industries: run.profile.industries, country: run.profile.country, usRegion: run.profile.usRegion },
      },
      settings: {
        filters: run.profile.filters,
        siteN: run.profile.siteN,
        dropDead: run.profile.dropDead,
        stageReach: run.state.settings.stageReach,
        waveSize: run.profile.waveSize,
        tune: run.profile.tune,
        basis: profileBasis(run.state),
        // The identity groups this run applied, with their decisions.
        identities: groups,
        fofExceptions: Array.from(fof.value.values()).filter((e) => e.status === "approved").map((e) => e.firmId),
      },
    },
  };
}

/** The four-tier run, with each tier's top funds checked against their stored website results. */
async function runFourTierEngine(supabase: ServiceClient, prepared: Prepared): Promise<Result<TierRun>> {
  const { run, db, input } = prepared;
  try {
    let tiers = runTiers({ ...input, sites: null });
    // Websites are only checked when the client's website check is on (siteN > 0).
    if (run.profile.siteN > 0) {
      const take = run.profile.siteN + 20;
      const ids = new Set<string>();
      for (const tier of TIER_KEYS) {
        tiers.outcomes
          .filter((o) => o.status === "tiered" && o.tier === tier && !o.rejected && !o.representedBy)
          .slice(0, take)
          .forEach((o) => ids.add(o.firmId));
      }
      let sites: Record<string, SiteResult> = {};
      const candidates = db.firms.filter((firm) => ids.has(firm.id));
      if (candidates.length) {
        const stored = await loadSites(supabase, candidates);
        if (!stored.ok) return stored;
        sites = stored.sites;
      }
      tiers = runTiers({ ...input, sites });
    }
    return { ok: true, value: tiers };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The four-tier run failed." };
  }
}

/**
 * A four-tier run, saved permanently: the Match page shows it, exports read it
 * back and Push to client sends it. Used by the Match page and the admin preview.
 */
export async function runFourTier(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<{ runId: string }>> {
  const prepared = await prepare(supabase, clientId, actor);
  if (!prepared.ok) return prepared;
  const tiers = await runFourTierEngine(supabase, prepared.value);
  if (!tiers.ok) return tiers;
  const { common, profileInputs, settings } = prepared.value;
  const saved = await saveRun(
    supabase,
    { ...common, engine: "tiers", rules_version: RULES_VERSION, profile_inputs: profileInputs, settings, counts: tiers.value.counts },
    tierRows(tiers.value),
  );
  if (!saved.ok) return saved;
  return { ok: true, value: { runId: saved.value } };
}

/**
 * The four-tier engine for a client, run now and not saved: verification uses
 * it, as the current engine's verification runs the current engine.
 */
export async function liveFourTier(supabase: ServiceClient, clientId: string): Promise<Result<{ run: MatchContext; tiers: TierRun }>> {
  const prepared = await prepare(supabase, clientId, null);
  if (!prepared.ok) return prepared;
  const tiers = await runFourTierEngine(supabase, prepared.value);
  if (!tiers.ok) return tiers;
  return { ok: true, value: { run: prepared.value.run, tiers: tiers.value } };
}

/**
 * What the match would give with other sectors or another stage reach: the
 * engine run once per option on the client's current data, nothing saved.
 * Website checks are left out, so tiers can be slightly larger than a saved
 * run's (a saved run drops dead websites from each tier's top funds).
 */
export async function previewOptions(
  supabase: ServiceClient,
  clientId: string,
  options: MatchOption[],
): Promise<Result<{ option: MatchOption; tally: TierTally }[]>> {
  const prepared = await prepare(supabase, clientId, null);
  if (!prepared.ok) return prepared;
  const { input } = prepared.value;
  try {
    const results = options.map((option) => {
      const tiers = runTiers({
        ...input,
        profile: { ...input.profile, primarySector: option.primary, secondarySectors: option.secondary },
        stageReach: option.stageReach,
        sites: null,
      });
      return { option, tally: tallyCounts(tiers.counts) };
    });
    return { ok: true, value: results };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The options could not be tested." };
  }
}

/** The sandbox's last reset, or null: runs before it are history only. */
async function lastReset(supabase: ServiceClient, clientId: string) {
  const { data } = await supabase
    .from("match_sandbox_resets")
    .select("reset_at")
    .eq("client_id", clientId)
    .order("reset_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.reset_at ? String(data.reset_at) : null;
}

/** The client's newest saved four-tier run (since the sandbox's last reset), or null. */
export async function latestTierRun(supabase: ServiceClient, clientId: string): Promise<Result<RunHeader | null>> {
  const since = await lastReset(supabase, clientId);
  let query = supabase
    .from("match_runs")
    .select("*")
    .eq("client_id", clientId)
    .eq("engine", "tiers")
    .order("ran_at", { ascending: false })
    .limit(1);
  if (since) query = query.gte("ran_at", since);
  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, error: tiersError(error.message, error.code) };
  return { ok: true, value: data ? asHeader(data) : null };
}

/**
 * Whether the company profile (its answers, settings or version) changed
 * since this run, so the match needs to run again before a push. The
 * profile-only part of staleReasons, without loading the Fund Database.
 */
export async function profileChangedSince(
  supabase: ServiceClient,
  clientId: string,
  header: RunHeader,
): Promise<Result<boolean>> {
  const [state, versions] = await Promise.all([loadProfileState(supabase, clientId), loadVersions(supabase, clientId, 1)]);
  if (!state.ok) return state;
  if (!versions.ok) return versions;
  const basisChanged = !header.settings.basis || !state.value || profileBasis(state.value) !== header.settings.basis;
  const versionChanged = (versions.value[0]?.version ?? null) !== header.profileVersion;
  return { ok: true, value: basisChanged || versionChanged };
}

/**
 * Why a saved run no longer reflects the client's data, in words. Empty when
 * it still does. A run with reasons can't be pushed: run the match again.
 */
export async function staleReasons(
  supabase: ServiceClient,
  clientId: string,
  header: RunHeader,
  rows: StoredResult[],
  /** The run row keys of a confirmed plan: only their reviews and hiding count. All tiered funds when absent. */
  planned?: Set<string>,
): Promise<Result<string[]>> {
  const [live, state, versions, reviews, hidden] = await Promise.all([
    loadLiveDb(supabase),
    loadProfileState(supabase, clientId),
    loadVersions(supabase, clientId, 1),
    selectAll<{ firm_id: string; status: string }>((from, to) =>
      supabase.from("match_reviews").select("firm_id, status").eq("client_id", clientId).order("firm_id").range(from, to),
    ),
    selectAll<{ firm_id: string }>((from, to) =>
      supabase.from("match_suppressions").select("firm_id").order("firm_id").range(from, to),
    ),
  ]);
  if (!live.ok) return { ok: false, error: live.error };
  if (!state.ok) return state;
  if (!versions.ok) return versions;
  if (!reviews.ok) return { ok: false, error: reviews.error };
  if (!hidden.ok) return { ok: false, error: hidden.error };

  const reasons: string[] = [];
  if (header.rulesVersion !== RULES_VERSION) {
    reasons.push(`This run used rules ${header.rulesVersion}; the engine now uses ${RULES_VERSION}.`);
  }
  if (live.value.version.id !== header.fundDbVersion) {
    reasons.push(`The Fund Database changed since this run (now ${live.value.version.fileName}).`);
  }
  if (!header.settings.basis) {
    reasons.push("This run was made before runs recorded the profile they used.");
  } else if (!state.value || profileBasis(state.value) !== header.settings.basis) {
    reasons.push("The company profile or the match settings changed since this run.");
  }
  const latestVersion = versions.value[0]?.version ?? null;
  if (latestVersion !== header.profileVersion) {
    reasons.push("A newer company profile version was saved since this run.");
  }
  const tiered = planned
    ? rows.filter((row) => planned.has(row.firmId))
    : rows.filter((row) => row.status === "tiered" && !row.detail.representedBy);
  const rejectedNow = new Set(reviews.rows.filter((row) => row.status === "no").map((row) => row.firm_id));
  const hiddenNow = new Set(hidden.rows.map((row) => row.firm_id));
  const baseId = (id: string) => id.replace(/#\d+$/, "");
  const reviewChanges = tiered.filter((row) => Boolean(row.detail.rejected) !== rejectedNow.has(baseId(row.firmId))).length;
  if (reviewChanges > 0) {
    reasons.push(`${reviewChanges} fund${reviewChanges === 1 ? " was" : "s were"} rejected or un-rejected for this client since this run.`);
  }
  const hiddenChanges = tiered.filter((row) => hiddenNow.has(baseId(row.firmId))).length;
  if (hiddenChanges > 0) {
    reasons.push(`${hiddenChanges} fund${hiddenChanges === 1 ? " was" : "s were"} hidden for all clients since this run.`);
  }
  return { ok: true, value: reasons };
}

/**
 * The founder's list from one saved four-tier run's confirmed campaign plan,
 * with the verification state of its contacts. `planned` is the plan's run
 * row keys. It refuses an incomplete run, a run that isn't the client's
 * newest, and a run that no longer reflects the client's data.
 */
export async function fourTierPushList(
  supabase: ServiceClient,
  clientId: string,
  runId: string,
  planned: Set<string>,
): Promise<Result<{ list: InvestorListPayload; people: PeopleStates }>> {
  const loaded = await loadTierRun(supabase, clientId, runId);
  if (!loaded.ok) return loaded;
  const { header, rows, complete } = loaded.value;
  if (!complete) return { ok: false, error: "This run is incomplete: not every result was saved. Run the match again." };
  const latest = await latestTierRun(supabase, clientId);
  if (!latest.ok) return latest;
  if (latest.value?.id !== header.id) return { ok: false, error: "A newer four-tier run exists for this client. Reload the page and push that one." };
  if (planned.size === 0) return { ok: false, error: "The campaign plan has no funds. Confirm a plan on the Plan tab." };
  const stale = await staleReasons(supabase, clientId, header, rows, planned);
  if (!stale.ok) return stale;
  if (stale.value.length > 0) return { ok: false, error: `${stale.value.join(" ")} Run the match again, then push.` };

  const live = await loadLiveDb(supabase);
  if (!live.ok) return { ok: false, error: live.error };
  const firms = firmsByRowKey(live.value.db.firms);
  const kept = rows.filter((row) => planned.has(row.firmId) && pushable(row));
  const listedFirms = kept.map((row) => firms.get(row.firmId)).filter((firm): firm is NonNullable<typeof firm> => Boolean(firm));
  const sites = await loadSites(supabase, listedFirms);
  if (!sites.ok) return sites;
  const checkSizes: Record<string, string> = {};
  for (const [id, site] of Object.entries(sites.sites)) {
    if ("check" in site && site.check) checkSizes[id] = String(site.check);
  }
  const stage = (header.profileInputs.stage as { label?: string } | undefined)?.label ?? "";
  const list = fourTierClientList({ id: header.id, rulesVersion: header.rulesVersion, ranAt: header.ranAt }, kept, firms, stage, checkSizes);
  if (!list.ok) return list;

  const fids = Array.from(new Set(kept.flatMap((row) => reachablePeople(row).map((person) => person.fid))));
  const states = await contactStates(supabase, clientId, fids);
  if (!states.ok) return states;
  const byRow = new Map(kept.map((row) => [row.firmId.trim().slice(0, 200), row]));
  const people: PeopleStates = (rowId) => {
    const row = byRow.get(rowId);
    return row ? reachablePeople(row).map((person) => verifyStateOf(person, states.value)) : undefined;
  };
  return { ok: true, value: { list: list.value, people } };
}

/** One saved four-tier run of a client, from its stored rows only. */
export async function loadTierRun(
  supabase: ServiceClient,
  clientId: string,
  runId: string,
): Promise<Result<{ header: RunHeader; rows: StoredResult[]; complete: boolean }>> {
  const { data, error } = await supabase.from("match_runs").select("*").eq("id", runId).eq("client_id", clientId).maybeSingle();
  if (error) return { ok: false, error: tiersError(error.message, error.code) };
  if (!data) return { ok: false, error: "That run does not exist for this client." };
  const header = asHeader(data);
  if (header.engine !== "tiers") return { ok: false, error: "That run is not a four-tier run." };
  const rows = await loadResults(supabase, header.id);
  if (!rows.ok) return rows;
  return { ok: true, value: { header, rows: rows.value, complete: rows.value.length === header.resultsExpected } };
}

/**
 * The website of each listed fund in a saved run, by run row key, from the
 * live Fund Database. Best effort: empty when the database can't be read.
 */
export async function runWebsites(supabase: ServiceClient, rows: StoredResult[]): Promise<Record<string, string>> {
  const live = await loadLiveDb(supabase);
  if (!live.ok) return {};
  const firms = firmsByRowKey(live.value.db.firms);
  const sites: Record<string, string> = {};
  for (const row of rows) {
    if (row.status !== "tiered" && row.status !== "generalist") continue;
    const href = websiteHref(firms.get(row.firmId)?.web);
    if (href) sites[row.firmId] = href;
  }
  return sites;
}

/** Contact verification and this client's keep/remove decisions, for exporting a saved run. */
export async function contactStates(supabase: ServiceClient, clientId: string, firmIds: string[]): Promise<Result<ContactStates>> {
  const [checks, decisions] = await Promise.all([loadChecksForFirms(supabase, firmIds), loadDecisions(supabase, clientId)]);
  if (!checks.ok) return { ok: false, error: checks.error };
  if (!decisions.ok) return { ok: false, error: decisions.error };
  const states: ContactStates = new Map();
  checks.value.forEach((check, id) => {
    states.set(id, { email: check.email, status: check.status && check.checkedAt ? check.status : null, checkedAt: check.checkedAt, decision: null });
  });
  decisions.value.forEach((decision, id) => {
    const current = states.get(id) ?? { email: "", status: null, checkedAt: null, decision: null };
    states.set(id, { ...current, decision: decision.decision });
  });
  return { ok: true, value: states };
}

export type RunListItem = RunHeader & { saved: number };

/** The client's saved runs, newest first. For the sandbox: only since its last reset. */
export async function listRuns(supabase: ServiceClient, clientId: string, limit = 40): Promise<Result<{ runs: RunListItem[]; since: string | null }>> {
  const since = await lastReset(supabase, clientId);
  let query = supabase.from("match_runs").select("*").eq("client_id", clientId).order("ran_at", { ascending: false }).limit(limit);
  if (since) query = query.gte("ran_at", since);
  const { data, error } = await query;
  if (error) return { ok: false, error: tiersError(error.message, error.code) };
  const headers = (data ?? []).map(asHeader);
  const runs: RunListItem[] = [];
  for (const header of headers) {
    const { count, error: countError } = await supabase
      .from("match_run_results")
      .select("firm_id", { count: "exact", head: true })
      .eq("run_id", header.id);
    if (countError) return { ok: false, error: tiersError(countError.message, countError.code) };
    runs.push({ ...header, saved: count ?? 0 });
  }
  return { ok: true, value: { runs, since } };
}

/** Funds of funds with their exception state, for the review panel. */
export function fofCandidates(db: FundDb, index: TaxIndex, exceptions: Map<string, FofRecord>) {
  return fundsOfFunds(db, index).map((firm) => {
    const mapping = mapFirm(firm, index);
    return {
      id: firm.id,
      name: firm.name,
      website: firm.web,
      location: [firm.city, firm.state, firm.country].filter(Boolean).join(", "),
      financing: firm.fin,
      type: firm.type,
      stages: firm.stages,
      alsoDirect: mapping.tags.some((tag) => tag.field === "financing" && tag.nodeId !== FUND_OF_FUNDS && tag.review === "approved"),
      exception: exceptions.get(firm.id) ?? null,
    };
  });
}
