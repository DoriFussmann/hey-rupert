import "server-only";
import { randomUUID } from "node:crypto";
import type { FundDb, SiteResult } from "@/lib/match/engine/index.mjs";
import { applyCorrections, loadChecksForFirms } from "@/lib/match/corrections-server";
import { selectAll } from "@/lib/match/db-server";
import { runClientMatch } from "@/lib/match/run-server";
import { loadSites } from "@/lib/match/sites-server";
import { matchingProfile, validateProfile } from "@/lib/company-profile/core";
import { loadCompanyProfile } from "@/lib/company-profile/server";
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
} from "@/lib/match/tiers/core";
import { compareRuns, type Comparison, type StoredResult } from "@/lib/match/tiers/compare";
import { duplicateFlags, findDuplicates, type DuplicateReport } from "@/lib/match/tiers/duplicates";
import { legacyRows, tierRows, type ResultRow } from "@/lib/match/tiers/record";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const TIERS_MIGRATION_MISSING =
  "Four-tier matching is not set up in the database yet. Run portal/supabase/match_tiers.sql in Supabase.";

function tiersError(message: string, code?: string) {
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
  if (!loaded.ok) return { ok: false, error: tiersError(loaded.error) };
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
  if (!loaded.ok) return { ok: false, error: tiersError(loaded.error) };
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

/**
 * Runs both engines for a client on the same Fund Database version, profile
 * and settings, and saves both runs under one comparison id. Nothing on the
 * live Match page changes: the current engine's saved view is not touched.
 */
export async function runComparison(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<{ comparisonId: string }>> {
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, company_name, is_match_sandbox")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client not found." };

  const legacy = await runClientMatch(supabase, clientId);
  if (!legacy.ok) return legacy;
  const run = legacy.value;

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
  const dupes = findDuplicates(db, index);

  const input = { db, index, profile, legacy: run.profile, suppressed, rejected, fofExceptions: fof.value, duplicates: duplicateFlags(dupes) };
  let tiers: TierRun;
  try {
    tiers = runTiers({ ...input, sites: null });
    // Same condition as the current engine's run: websites are only checked when siteN > 0.
    if (run.profile.siteN > 0) {
      const take = run.profile.siteN + 20;
      const ids = new Set<string>();
      for (const tier of TIER_KEYS) {
        tiers.outcomes
          .filter((o) => o.status === "tiered" && o.tier === tier && !o.rejected)
          .slice(0, take)
          .forEach((o) => ids.add(o.firmId));
      }
      const missing = db.firms.filter((firm) => ids.has(firm.id) && !run.sites[firm.id]);
      let sites: Record<string, SiteResult> = { ...run.sites };
      if (missing.length) {
        const more = await loadSites(supabase, missing);
        if (!more.ok) return more;
        sites = { ...sites, ...more.sites };
      }
      tiers = runTiers({ ...input, sites });
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The four-tier run failed." };
  }

  const comparisonId = randomUUID();
  const label = (id: string | null) => (id ? index.nodes.get(id)?.label ?? id : null);
  const common = {
    client_id: clientId,
    client_name: String(client.company_name ?? ""),
    is_sandbox: client.is_match_sandbox === true,
    comparison_id: comparisonId,
    profile_version: version?.version ?? null,
    taxonomy_revision: index.taxonomy.revision,
    fund_db_version: run.live.version.id,
    fund_db_file: run.live.version.fileName,
    ran_by: actor,
  };
  const profileInputs = {
    primarySector: { id: profile.primarySector, label: label(profile.primarySector) },
    secondarySectors: profile.secondarySectors.map((id) => ({ id, label: label(id) })),
    stage: { id: profile.stage, label: label(profile.stage) },
    hqCountry: { id: profile.hqCountry, label: label(profile.hqCountry) },
    hqState: { id: profile.hqState, label: label(profile.hqState) },
    firmTypes: profile.firmTypes.map((id) => ({ id, label: label(id) })),
    financing: profile.financing.map((id) => ({ id, label: label(id) })),
    readiness,
    unconfirmed: profile.unconfirmed.map((id) => ({ id, label: label(id) })),
    warnings: profileWarnings(issues),
    relationships: edgeSummary(index),
    legacyProfile: { stage: run.profile.stage, verticals: run.profile.verticals, industries: run.profile.industries, country: run.profile.country, usRegion: run.profile.usRegion },
  };
  const settings = { filters: run.profile.filters, siteN: run.profile.siteN, dropDead: run.profile.dropDead, waveSize: run.profile.waveSize, tune: run.profile.tune };

  const legacyCounts = { ...run.out.counts, funnel: run.out.funnel, deadRemoved: run.out.deadRemoved.length, qualifiedBullseye: run.out.qualifiedBullseye, wave: run.out.wave };
  const savedLegacy = await saveRun(
    supabase,
    { ...common, engine: "legacy", rules_version: "legacy", profile_inputs: profileInputs, settings, counts: legacyCounts },
    legacyRows(run.out, db),
  );
  if (!savedLegacy.ok) return savedLegacy;
  const savedTiers = await saveRun(
    supabase,
    { ...common, engine: "tiers", rules_version: RULES_VERSION, profile_inputs: profileInputs, settings, counts: tiers.counts },
    tierRows(tiers),
  );
  if (!savedTiers.ok) return savedTiers;
  return { ok: true, value: { comparisonId } };
}

export type ComparisonView = {
  legacy: RunHeader;
  tiers: RunHeader;
  complete: boolean;
  comparison: Comparison;
};

export type RunListItem = RunHeader & { saved: number };

/** The client's saved runs, newest first. For the sandbox: only since its last reset. */
export async function listRuns(supabase: ServiceClient, clientId: string, limit = 40): Promise<Result<{ runs: RunListItem[]; since: string | null }>> {
  const { data: reset } = await supabase
    .from("match_sandbox_resets")
    .select("reset_at")
    .eq("client_id", clientId)
    .order("reset_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const since = reset?.reset_at ? String(reset.reset_at) : null;
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

/** A saved comparison, rebuilt from its stored results only. */
export async function loadComparison(supabase: ServiceClient, clientId: string, comparisonId: string): Promise<Result<ComparisonView>> {
  const { data, error } = await supabase.from("match_runs").select("*").eq("client_id", clientId).eq("comparison_id", comparisonId);
  if (error) return { ok: false, error: tiersError(error.message, error.code) };
  const headers = (data ?? []).map(asHeader);
  const legacy = headers.find((h) => h.engine === "legacy");
  const tiers = headers.find((h) => h.engine === "tiers");
  if (!legacy || !tiers) return { ok: false, error: "This comparison is incomplete: one of its runs was not saved." };
  const [oldRows, newRows] = await Promise.all([loadResults(supabase, legacy.id), loadResults(supabase, tiers.id)]);
  if (!oldRows.ok) return oldRows;
  if (!newRows.ok) return newRows;
  return {
    ok: true,
    value: {
      legacy,
      tiers,
      complete: oldRows.value.length === legacy.resultsExpected && newRows.value.length === tiers.resultsExpected,
      comparison: compareRuns(oldRows.value, newRows.value),
    },
  };
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
