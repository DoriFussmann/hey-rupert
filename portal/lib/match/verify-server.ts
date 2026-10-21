import "server-only";
import { callClaudeAgent, isClaudeConfigured, webSearchTool, type ClaudeUsage } from "@/lib/anthropic";
import { findEmail, isHunterConfigured, verifyEmail } from "@/lib/hunter";
import type { Firm, RankedContact } from "@/lib/match/engine/index.mjs";
import {
  VERIFY_MIGRATION_MISSING,
  loadChecksForFirms,
  loadCorrections,
  loadDecisions,
  verifyTableError,
  type CheckBrief,
  type Correction,
  type Decision,
} from "@/lib/match/corrections-server";
import { MATCH_MIGRATION_MISSING, selectAll } from "@/lib/match/db-server";
import { matchEngine } from "@/lib/match/engine-setting";
import {
  buildView,
  rankedContactId,
  runClientMatch,
  storeMatch,
} from "@/lib/match/run-server";
import { TIERS, type MatchEngine } from "@/lib/match/shared";
import { TIER_INFO, TIER_KEYS } from "@/lib/match/tiers/core";
import { liveFourTier } from "@/lib/match/tiers/server";
import {
  CLAUDE_USD_PER_MTOK_IN,
  CLAUDE_USD_PER_MTOK_OUT,
  DEFAULT_MS_PER_BATCH,
  DEFAULT_USD_PER_CONTACT,
  EMAIL_PATTERN,
  USD_PER_SEARCH,
  VERIFY_BATCH_SIZE,
  VERIFY_FRESH_DAYS,
  ESTIMATE_MIN_CHECKS,
  ROLE_MAX_SEARCHES,
  VERIFY_LABEL,
  VERIFY_MODES,
  VERIFY_PIPELINE,
  ZERO_COST,
  addCost,
  contactId,
  contactKeyOf,
  emailKey,
  failedStep,
  finalStatus,
  needsStep,
  personNameOf,
  safeUrl,
  stepsComplete,
  suggestFor,
  type ActionInput,
  type BatchDone,
  type CheckCost,
  type CheckSteps,
  type ContactResult,
  type CorrectionRow,
  type Evidence,
  type FlaggedChoice,
  type FlaggedContact,
  type LeadRow,
  type MailboxStep,
  type RoleStep,
  type RunState,
  type RunStats,
  type ScopeCount,
  type TierLimits,
  type StepNumber,
  type Suggestion,
  type VerifyContact,
  type VerifyOverview,
  type VerifyEstimate,
  type VerifyMode,
  type VerifyScope,
  type VerifyStatus,
} from "@/lib/match/verify";
import type { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const FRESH_MS = VERIFY_FRESH_DAYS * 24 * 60 * 60 * 1000;
/** Each Claude step must answer well inside the 5-minute request limit. */
const CLAUDE_STEP_TIMEOUT_MS = 110_000;
const ID_CHUNK = 200;

function nowIso() {
  return new Date().toISOString();
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function domainOf(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

const WEBMAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);

// ---------------------------------------------------------------------------
// Contacts in each scope

/** One listed fund as verification sees it: its tier, record and ranked contacts. */
type ScopeFund = { tier: string; firm: Firm; seq: RankedContact[]; ranked: RankedContact[] };

/**
 * What verification checks for a client, from the engine in use: the funds
 * in its tiers (rejected ones left out), in outreach order, with stored checks,
 * corrections and this client's decisions.
 */
type ScopeSource = {
  engine: MatchEngine;
  tiers: { key: string; label: string }[];
  funds: ScopeFund[];
  checks: Map<string, CheckBrief>;
  corrections: Map<string, Correction>;
  decisions: Map<string, Decision>;
};

/** Runs the engine in use for the client and lists what verification can check. */
async function loadScope(supabase: ServiceClient, clientId: string): Promise<Result<ScopeSource>> {
  const engine = await matchEngine(supabase);
  if (engine === "four_tier") {
    const live = await liveFourTier(supabase, clientId);
    if (!live.ok) return live;
    const { run, tiers } = live.value;
    const funds: ScopeFund[] = [];
    for (const outcome of tiers.outcomes) {
      if (outcome.status !== "tiered" || outcome.rejected || outcome.representedBy || !outcome.tier) continue;
      const source = tiers.live.get(outcome);
      if (source) funds.push({ tier: outcome.tier, firm: source.firm, seq: source.seq, ranked: source.ranked });
    }
    // A confirmed duplicate's contacts can sit under another FirmID: load every record's checks.
    const fids = Array.from(new Set(funds.flatMap((fund) => fund.ranked.map((contact) => contact.fid))));
    const checks = await loadChecksForFirms(supabase, fids);
    if (!checks.ok) return checks;
    return {
      ok: true,
      value: {
        engine,
        tiers: TIER_KEYS.map((key) => ({ key, label: TIER_INFO[key].label })),
        funds,
        checks: checks.value,
        corrections: run.corrections,
        decisions: run.decisions,
      },
    };
  }
  const run = await runClientMatch(supabase, clientId);
  if (!run.ok) return run;
  return {
    ok: true,
    value: {
      engine,
      tiers: TIERS.map(({ key, label }) => ({ key, label })),
      funds: run.value.out.results
        .filter((result) => !result.rejected)
        .map((result) => ({ tier: result.tier, firm: result.f, seq: result.seq, ranked: result.ranked })),
      checks: run.value.checks,
      corrections: run.value.corrections,
      decisions: run.value.decisions,
    },
  };
}

function toVerifyContact(fund: ScopeFund, contact: RankedContact): VerifyContact {
  return {
    id: rankedContactId(contact),
    // The record the contact is stored under: checks and decisions are kept per FirmID.
    firmId: contact.fid,
    key: contactKeyOf(contact),
    firmName: fund.firm.name,
    firmWebsite: fund.firm.web,
    firmCity: [fund.firm.city, fund.firm.country].filter(Boolean).join(", "),
    name: personNameOf(contact),
    first: contact.first,
    last: contact.last,
    title: contact.title,
    email: contact.email,
    seq: contact.seq ?? null,
    tier: fund.tier,
  };
}

type ScopeList = { contacts: VerifyContact[]; noEmail: Record<string, number> };

function noEmailCounts(source: ScopeSource): Record<string, number> {
  return Object.fromEntries(source.tiers.map(({ key }) => [key, 0]));
}

/**
 * Contacts per mode, in outreach order (tier, fit, then rank at the fund):
 * everyone with an email, or only each fund's Primary and Backup.
 */
function collectScopes(source: ScopeSource): Record<VerifyMode, ScopeList> {
  const lists: Record<VerifyMode, ScopeList> = {
    all: { contacts: [], noEmail: noEmailCounts(source) },
    sequence: { contacts: [], noEmail: noEmailCounts(source) },
  };
  const seen: Record<VerifyMode, Set<string>> = { all: new Set(), sequence: new Set() };
  const add = (mode: VerifyMode, fund: ScopeFund, contact: RankedContact) => {
    const item = toVerifyContact(fund, contact);
    if (seen[mode].has(item.id)) return;
    seen[mode].add(item.id);
    lists[mode].contacts.push(item);
  };

  for (const fund of source.funds) {
    const investing = fund.ranked.filter((contact) => contact.role !== "ops");
    // Primary and Backup first, then everyone else at the fund by rank.
    for (const contact of fund.seq) add("all", fund, contact);
    for (const contact of investing) if (contact.email) add("all", fund, { ...contact, seq: undefined });
    lists.all.noEmail[fund.tier] = (lists.all.noEmail[fund.tier] ?? 0) + investing.filter((contact) => !contact.email).length;
    for (const contact of fund.seq) add("sequence", fund, contact);
  }
  return lists;
}

/** One mode's contacts for one tier, in outreach order. */
function tierContacts(list: ScopeList, tier: string) {
  return list.contacts.filter((contact) => contact.tier === tier);
}

function isFresh(source: ScopeSource, contact: VerifyContact) {
  const check = source.checks.get(contact.id);
  if (!check?.status || !check.checkedAt || check.hadError) return false;
  if (emailKey(check.email) !== emailKey(contact.email)) return false;
  return Date.now() - Date.parse(check.checkedAt) < FRESH_MS;
}

/** Flagged as removed (for another client) and not decided for this one. */
function flagOf(source: ScopeSource, contact: VerifyContact): Correction | null {
  const fix = source.corrections.get(contact.id);
  if (fix?.flag !== "removed") return null;
  return source.decisions.has(contact.id) ? null : fix;
}

// ---------------------------------------------------------------------------
// Stored checks and runs

type CheckRow = {
  firm_id: string;
  email_key: string;
  email: string;
  status: VerifyStatus | null;
  steps: CheckSteps | null;
  suggestion: Suggestion | null;
  /** Not kept in a run's stored results. */
  cost?: Partial<CheckCost> | null;
  checked_at: string | null;
};

async function loadCheckRows(
  supabase: ServiceClient,
  contacts: VerifyContact[],
): Promise<Result<Map<string, CheckRow>>> {
  const wanted = new Set(contacts.map((contact) => contact.id));
  const firmIds = Array.from(new Set(contacts.map((contact) => contact.firmId)));
  const rows = new Map<string, CheckRow>();
  for (let i = 0; i < firmIds.length; i += ID_CHUNK) {
    const loaded = await selectAll<CheckRow>((from, to) =>
      supabase
        .from("contact_checks")
        .select("firm_id, email_key, email, status, steps, suggestion, cost, checked_at")
        .in("firm_id", firmIds.slice(i, i + ID_CHUNK))
        .order("firm_id")
        .order("email_key")
        .range(from, to),
    );
    if (!loaded.ok) return { ok: false, error: loadError(loaded.error) };
    for (const row of loaded.rows) {
      const id = contactId(row.firm_id, row.email_key);
      if (wanted.has(id)) rows.set(id, row);
    }
  }
  return { ok: true, value: rows };
}

/**
 * selectAll reports any missing table as the Rupert Match migration; this
 * code only runs once matching works, so it is the verification migration.
 */
function loadError(error: string) {
  return error === MATCH_MIGRATION_MISSING ? VERIFY_MIGRATION_MISSING : verifyTableError(error);
}

function costOf(row: CheckRow | undefined): CheckCost {
  return addCost(ZERO_COST, row?.cost ?? {});
}

type RunRow = {
  id: string;
  client_id: string;
  scope: VerifyScope;
  contacts: VerifyContact[];
  reused: VerifyContact[];
  batch_size: number;
  batches: number;
  next_batch: number;
  status: "active" | "done" | "cancelled";
  stats: Partial<RunStats> | null;
  created_at: string;
  finished_at: string | null;
};

function statsOf(row: RunRow): RunStats {
  return {
    usd: Number(row.stats?.usd ?? 0),
    searches: Number(row.stats?.searches ?? 0),
    hunter: Number(row.stats?.hunter ?? 0),
    ms: Number(row.stats?.ms ?? 0),
  };
}

async function loadRunRow(supabase: ServiceClient, runId: string, clientId: string): Promise<Result<RunRow>> {
  const { data, error } = await supabase
    .from("verification_runs")
    .select("*")
    .eq("id", runId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return { ok: false, error: verifyTableError(error.message, error.code) };
  if (!data) return { ok: false, error: "This verification run no longer exists." };
  return { ok: true, value: data as RunRow };
}

/** Whether a stored check belongs to this run (finished after it started, same email). */
function doneInRun(row: CheckRow | undefined, contact: VerifyContact, startedAt: string) {
  return Boolean(
    row?.checked_at &&
      row.status &&
      emailKey(row.email) === emailKey(contact.email) &&
      Date.parse(row.checked_at) >= Date.parse(startedAt),
  );
}

function inProgress(row: CheckRow | undefined, contact: VerifyContact) {
  return Boolean(row && !row.checked_at && emailKey(row.email) === emailKey(contact.email));
}

/** A run contact's stored check, only when it was made by this run. */
function ownRow(row: CheckRow | undefined, contact: VerifyContact, startedAt: string) {
  return inProgress(row, contact) || doneInRun(row, contact, startedAt) ? row : undefined;
}

function toResult(
  contact: VerifyContact,
  row: CheckRow | undefined,
  reused: boolean,
  decisions: Map<string, Decision>,
  corrections: Map<string, Correction>,
): ContactResult {
  const sameEmail = row ? emailKey(row.email) === emailKey(contact.email) : false;
  const fix = corrections.get(contact.id);
  return {
    contact,
    status: sameEmail && row?.checked_at ? row.status : null,
    steps: sameEmail ? row?.steps ?? {} : {},
    suggestion: sameEmail && row?.checked_at ? row.suggestion : null,
    checkedAt: sameEmail ? row?.checked_at ?? null : null,
    reused,
    decision: decisions.get(contact.id)?.decision ?? null,
    corrected: Boolean(fix && (fix.email || fix.first_name || fix.last_name || fix.title || fix.flag === "left_firm")),
  };
}

/** A run's stored results, by contact id. */
async function loadRunResults(supabase: ServiceClient, runId: string): Promise<Result<Map<string, CheckRow>>> {
  const loaded = await selectAll<CheckRow>((from, to) =>
    supabase
      .from("verification_results")
      .select("firm_id, email_key, email, status, steps, suggestion, checked_at")
      .eq("run_id", runId)
      .order("firm_id")
      .order("email_key")
      .range(from, to),
  );
  if (!loaded.ok) return { ok: false, error: loadError(loaded.error) };
  return { ok: true, value: new Map(loaded.rows.map((item) => [contactId(item.firm_id, item.email_key), item])) };
}

/** Keeps these results with the run, so its summary does not change later. */
async function storeRunResults(
  supabase: ServiceClient,
  runId: string,
  items: { contact: VerifyContact; row: CheckRow | undefined }[],
  reused: boolean,
): Promise<string | null> {
  const values = items
    .filter((item) => item.row?.status && item.row.checked_at)
    .map(({ contact, row }) => ({
      run_id: runId,
      firm_id: contact.firmId,
      email_key: contact.key,
      email: row!.email,
      status: row!.status,
      steps: row!.steps ?? {},
      suggestion: row!.suggestion,
      checked_at: row!.checked_at,
      reused,
    }));
  if (values.length === 0) return null;
  const { error } = await supabase
    .from("verification_results")
    .upsert(values, { onConflict: "run_id,firm_id,email_key" });
  return error ? verifyTableError(error.message, error.code) : null;
}

async function runState(
  supabase: ServiceClient,
  row: RunRow,
  run?: Pick<ScopeSource, "decisions" | "corrections">,
): Promise<Result<RunState>> {
  const contacts = Array.isArray(row.contacts) ? row.contacts : [];
  const reused = Array.isArray(row.reused) ? row.reused : [];
  const closed = contacts.slice(0, Math.min(contacts.length, row.next_batch * row.batch_size));
  // The batch in progress reads the live checks; closed batches their stored results.
  const current = row.status === "active" ? batchContacts(row, row.next_batch) : [];
  const [stored, live] = await Promise.all([loadRunResults(supabase, row.id), loadCheckRows(supabase, current)]);
  if (!stored.ok) return stored;
  if (!live.ok) return live;

  let decisions = run?.decisions;
  let corrections = run?.corrections;
  if (!decisions || !corrections) {
    const [loadedDecisions, loadedCorrections] = await Promise.all([
      loadDecisions(supabase, row.client_id),
      loadCorrections(supabase),
    ]);
    if (!loadedDecisions.ok) return loadedDecisions;
    if (!loadedCorrections.ok) return loadedCorrections;
    decisions = loadedDecisions.value;
    corrections = loadedCorrections.value;
  }
  const decided = decisions;
  const fixes = corrections;

  const results: ContactResult[] = [
    ...closed.map((contact) => toResult(contact, stored.value.get(contact.id), false, decided, fixes)),
    ...current.map((contact) =>
      toResult(contact, ownRow(live.value.get(contact.id), contact, row.created_at), false, decided, fixes),
    ),
    ...reused.map((contact) => toResult(contact, stored.value.get(contact.id), true, decided, fixes)),
  ];
  return {
    ok: true,
    value: {
      id: row.id,
      scope: row.scope,
      batchSize: row.batch_size,
      batches: row.batches,
      nextBatch: row.next_batch,
      status: row.status,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      stats: statsOf(row),
      contacts,
      results,
    },
  };
}

async function latestRun(
  supabase: ServiceClient,
  clientId: string,
  status: "active" | "done",
): Promise<Result<RunRow | null>> {
  const { data, error } = await supabase
    .from("verification_runs")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: verifyTableError(error.message, error.code) };
  return { ok: true, value: (data as RunRow | null) ?? null };
}

/** Checks read to measure the average cost. */
const ESTIMATE_SAMPLE = 300;

/**
 * Average cost per check (from process-2 checks only, once there are enough)
 * and time per batch, from earlier runs.
 */
async function loadEstimate(supabase: ServiceClient): Promise<VerifyEstimate> {
  const [checks, runs] = await Promise.all([
    supabase
      .from("contact_checks")
      .select("cost")
      .not("checked_at", "is", null)
      .order("checked_at", { ascending: false })
      .limit(ESTIMATE_SAMPLE),
    supabase
      .from("verification_runs")
      .select("stats, next_batch")
      .gt("next_batch", 0)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const costs = ((checks.data ?? []) as { cost: Partial<CheckCost> | null }[])
    .filter((row) => Number(row.cost?.pipeline) === VERIFY_PIPELINE)
    .map((row) => Number(row.cost?.usd ?? 0))
    .filter((value) => value > 0);
  const batches = ((runs.data ?? []) as { stats: Partial<RunStats> | null; next_batch: number }[]).reduce(
    (sum, row) => ({ ms: sum.ms + Number(row.stats?.ms ?? 0), n: sum.n + Number(row.next_batch ?? 0) }),
    { ms: 0, n: 0 },
  );
  const measured = costs.length >= ESTIMATE_MIN_CHECKS;
  return {
    usdPerContact: measured ? costs.reduce((sum, value) => sum + value, 0) / costs.length : DEFAULT_USD_PER_CONTACT,
    msPerBatch: batches.n > 0 && batches.ms > 0 ? batches.ms / batches.n : DEFAULT_MS_PER_BATCH,
    measured,
    sample: costs.length,
  };
}

// ---------------------------------------------------------------------------
// Overview (the start screen)

export async function loadVerifyOverview(
  supabase: ServiceClient,
  clientId: string,
): Promise<Result<VerifyOverview>> {
  const [run, active, done] = await Promise.all([
    loadScope(supabase, clientId),
    latestRun(supabase, clientId, "active"),
    latestRun(supabase, clientId, "done"),
  ]);
  if (!run.ok) return run;
  if (!active.ok) return active;
  if (!done.ok) return done;

  const lists = collectScopes(run.value);
  const counts = {} as Record<VerifyMode, Record<string, ScopeCount>>;
  const flagged = new Map<string, FlaggedContact>();
  for (const mode of VERIFY_MODES) {
    counts[mode] = {};
    for (const { key: tier } of run.value.tiers) {
      let order = "";
      tierContacts(lists[mode], tier).forEach((contact, position) => {
        const flag = flagOf(run.value, contact);
        if (flag) {
          order += "f";
          const entry = flagged.get(contact.id) ?? {
            contact,
            reason: flag.flag_reason ?? "Removed",
            flaggedAt: flag.updated_at,
            positions: {},
          };
          entry.positions[mode] = position;
          flagged.set(contact.id, entry);
        } else {
          order += isFresh(run.value, contact) ? "r" : "c";
        }
      });
      counts[mode][tier] = { total: order.length, order, noEmail: lists[mode].noEmail[tier] ?? 0 };
    }
  }

  const activeState = active.value ? await runState(supabase, active.value, run.value) : null;
  if (activeState && !activeState.ok) return activeState;
  const doneState = done.value ? await runState(supabase, done.value, run.value) : null;
  if (doneState && !doneState.ok) return doneState;

  return {
    ok: true,
    value: {
      engine: run.value.engine,
      tiers: run.value.tiers,
      counts,
      flagged: Array.from(flagged.values()),
      estimate: await loadEstimate(supabase),
      claudeReady: isClaudeConfigured(),
      hunterReady: isHunterConfigured(),
      activeRun: activeState?.value ?? null,
      lastRun: doneState?.value ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Decisions and the stored match

async function saveDecision(
  supabase: ServiceClient,
  clientId: string,
  contact: VerifyContact,
  decision: "keep" | "remove",
  status: string | null,
  by: string | null,
) {
  const { error } = await supabase.from("contact_decisions").upsert(
    {
      client_id: clientId,
      firm_id: contact.firmId,
      email_key: contact.key,
      decision,
      status,
      decided_by: by,
      decided_at: nowIso(),
    },
    { onConflict: "client_id,firm_id,email_key" },
  );
  return error ? verifyTableError(error.message, error.code) : null;
}

/**
 * Re-runs the engine in use after contact decisions. On the current engine the
 * Match page's stored match is refreshed, so it shows who moved up. Four-tier
 * runs are permanent: the next saved run picks the decisions up.
 */
async function refreshMatch(supabase: ServiceClient, clientId: string, engine: MatchEngine): Promise<Result<ScopeSource>> {
  if (engine === "current") {
    const run = await runClientMatch(supabase, clientId);
    if (!run.ok) return run;
    await storeMatch(supabase, clientId, buildView(run.value));
  }
  return loadScope(supabase, clientId);
}

// ---------------------------------------------------------------------------
// Start a run

export async function startVerificationRun(
  supabase: ServiceClient,
  clientId: string,
  mode: VerifyMode,
  limits: TierLimits,
  choices: { id: string; choice: FlaggedChoice }[],
  by: string | null,
): Promise<Result<RunState>> {
  if (!VERIFY_MODES.includes(mode)) return { ok: false, error: "Unknown choice of contacts." };
  let run = await loadScope(supabase, clientId);
  if (!run.ok) return run;

  // Decide the flagged contacts first: removing one moves the next person up.
  // "Check again" needs nothing saved: an undecided flagged contact is checked.
  const listed = new Map(collectScopes(run.value).all.contacts.map((contact) => [contact.id, contact]));
  let decided = false;
  for (const { id, choice } of choices) {
    const contact = listed.get(String(id));
    if (!contact || !flagOf(run.value, contact)) continue;
    if (choice !== "keep" && choice !== "remove") continue;
    const error = await saveDecision(supabase, clientId, contact, choice, "flagged", by);
    if (error) return { ok: false, error };
    decided = true;
  }
  if (decided) {
    run = await refreshMatch(supabase, clientId, run.value.engine);
    if (!run.ok) return run;
  }

  const toCheck: VerifyContact[] = [];
  const reused: VerifyContact[] = [];
  // Flagged contacts still undecided ("Check again") are checked like the rest.
  // Each tier's limit keeps its first contacts in outreach order.
  const list = collectScopes(run.value)[mode];
  for (const { key: tier } of run.value.tiers) {
    const limit = limits[tier] ?? null;
    const contacts = tierContacts(list, tier);
    for (const contact of limit === null ? contacts : contacts.slice(0, limit)) {
      if (!flagOf(run.value, contact) && isFresh(run.value, contact)) reused.push(contact);
      else toCheck.push(contact);
    }
  }
  if (toCheck.length === 0 && reused.length === 0) {
    return { ok: false, error: "There are no contacts with an email to check in these tiers." };
  }

  const { error: cancelError } = await supabase
    .from("verification_runs")
    .update({ status: "cancelled", updated_at: nowIso() })
    .eq("client_id", clientId)
    .eq("status", "active");
  if (cancelError) return { ok: false, error: verifyTableError(cancelError.message, cancelError.code) };

  const batches = Math.ceil(toCheck.length / VERIFY_BATCH_SIZE);
  const at = nowIso();
  const { data, error } = await supabase
    .from("verification_runs")
    .insert({
      client_id: clientId,
      scope: mode,
      contacts: toCheck,
      reused,
      batch_size: VERIFY_BATCH_SIZE,
      batches,
      next_batch: 0,
      status: batches === 0 ? "done" : "active",
      stats: { usd: 0, searches: 0, hunter: 0, ms: 0 },
      started_by: by,
      created_at: at,
      updated_at: at,
      finished_at: batches === 0 ? at : null,
    })
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, error: verifyTableError(error?.message ?? "The run was not saved.", error?.code) };
  }
  const created = data as RunRow;
  const reusedRows = await loadCheckRows(supabase, reused);
  if (!reusedRows.ok) return reusedRows;
  const storeError = await storeRunResults(
    supabase,
    created.id,
    reused.map((contact) => ({ contact, row: reusedRows.value.get(contact.id) })),
    true,
  );
  if (storeError) return { ok: false, error: storeError };
  return runState(supabase, created, run.value);
}

// ---------------------------------------------------------------------------
// The steps: "At the firm?" (Claude with web search), then Hunter's mailbox check

const EVIDENCE_SCHEMA = {
  type: "array",
  maxItems: 3,
  items: {
    type: "object",
    properties: {
      url: { type: "string", description: "A page from your search results." },
      note: { type: "string", description: "What the page shows, in a few words." },
    },
    required: ["url", "note"],
  },
};

function cleanEvidence(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return { url: safeUrl(record.url), note: text(record.note, 200) };
    })
    .filter((item) => item.url)
    .slice(0, 3);
}

function usageCost(usage: ClaudeUsage): Partial<CheckCost> {
  return {
    usd:
      (usage.inputTokens * CLAUDE_USD_PER_MTOK_IN) / 1_000_000 +
      (usage.outputTokens * CLAUDE_USD_PER_MTOK_OUT) / 1_000_000 +
      usage.webSearches * USD_PER_SEARCH,
    searches: usage.webSearches,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

function personBlock(contact: VerifyContact) {
  return [
    `Person: ${contact.name}`,
    `Title in our database: ${contact.title || "(none)"}`,
    `Firm: ${contact.firmName}`,
    `Firm website: ${contact.firmWebsite || "(none)"}`,
    `Firm location: ${contact.firmCity || "(unknown)"}`,
  ].join("\n");
}

const ROLE_SYSTEM = `You check whether a person in an investor database still works at the firm listed for them, and in what role. Use web search. The firm's own team page and public LinkedIn profiles are the best sources; recent press, portfolio announcements and conference bios also help.

Rules:
- Rely only on pages you actually found in search results. Never guess or invent a URL.
- Make sure a page is about this person: the same name AND this firm, or a clearly matching career. A person with the same name elsewhere is not evidence.
- Prefer the most recent source. When sources disagree, trust the most recent dated one.
- confirmed: a source shows them at this firm in an investing role (for example general partner, managing partner, partner, managing director, principal, vice president, director, associate, analyst, venture partner, investment manager, scout, or a founder of the fund).
- role_changed: they are at this firm but in a non-investing role (for example operations, finance, legal, marketing, investor relations, platform, talent, office or admin).
- left_firm: a source shows they left this firm or now work elsewhere. Give the new firm, its website and their new title when a source shows them.
- not_found: no reliable source either way.

Report through the report_role tool. The summary is one plain sentence.`;

const ROLE_TOOL = {
  name: "report_role",
  description: "Report whether the person is at the firm, and in what role.",
  input_schema: {
    type: "object",
    properties: {
      result: { type: "string", enum: ["confirmed", "role_changed", "left_firm", "not_found"] },
      current_title: { type: "string", description: "Their current title, if a source shows it." },
      new_firm: { type: "string", description: "Only for left_firm: the firm they are at now." },
      new_firm_website: { type: "string", description: "Only for left_firm: that firm's website." },
      new_title: { type: "string", description: "Only for left_firm: their title there." },
      summary: { type: "string" },
      evidence: EVIDENCE_SCHEMA,
    },
    required: ["result", "summary", "evidence"],
  },
};

const ROLE_RESULTS = new Set(["confirmed", "role_changed", "left_firm", "not_found"]);

async function stepRole(contact: VerifyContact): Promise<{ step: RoleStep; cost: Partial<CheckCost> }> {
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: ROLE_SYSTEM,
    content: [{ type: "text", text: personBlock(contact) }],
    tool: ROLE_TOOL,
    serverTools: [webSearchTool(ROLE_MAX_SEARCHES)],
    requireServerTools: true,
    maxTokens: 2000,
    timeoutMs: CLAUDE_STEP_TIMEOUT_MS,
  });
  const cost = usageCost(result.usage);
  const empty = { currentTitle: "", newFirm: "", newFirmWebsite: "", newTitle: "", evidence: [] };
  if (!result.ok) {
    return { step: { result: "error", summary: text(result.reason, 300), ...empty }, cost };
  }
  const input = result.input;
  const value = String(input.result ?? "");
  if (!ROLE_RESULTS.has(value)) {
    return { step: { result: "error", summary: "Claude returned an unreadable answer.", ...empty }, cost };
  }
  const left = value === "left_firm";
  return {
    step: {
      result: value as RoleStep["result"],
      currentTitle: text(input.current_title, 200),
      newFirm: left ? text(input.new_firm, 200) : "",
      newFirmWebsite: left ? safeUrl(input.new_firm_website) || text(input.new_firm_website, 200).replace(/\s/g, "") : "",
      newTitle: left ? text(input.new_title, 200) : "",
      summary: text(input.summary, 400),
      evidence: cleanEvidence(input.evidence),
    },
    cost,
  };
}

const MAILBOX_SUMMARY: Record<MailboxStep["result"], string> = {
  valid: "Hunter: the mailbox accepts mail.",
  invalid: "Hunter: the mailbox does not exist.",
  accept_all: "Hunter: the mail server accepts every address, so this one can't be confirmed.",
  webmail: "Hunter: a personal webmail address; it can't be tied to the firm.",
  disposable: "Hunter: a disposable address.",
  unknown: "Hunter could not reach a verdict.",
  error: "",
};

async function stepMailbox(contact: VerifyContact): Promise<{ step: MailboxStep; cost: Partial<CheckCost> }> {
  if (!isHunterConfigured()) {
    return {
      step: { result: "error", score: null, summary: "Hunter is not set up (HUNTER_API_KEY).", suggestedEmail: "" },
      cost: {},
    };
  }
  const verified = await verifyEmail(contact.email);
  if (!verified.ok) {
    return { step: { result: "error", score: null, summary: verified.reason, suggestedEmail: "" }, cost: {} };
  }
  const { status, score } = verified.value;
  let hunter = 1;
  let suggestedEmail = "";
  if (status === "invalid" || status === "disposable") {
    const emailDomain = domainOf(contact.email.split("@")[1] ?? "");
    const domain = domainOf(contact.firmWebsite) || (WEBMAIL.has(emailDomain) ? "" : emailDomain);
    const found = await findEmail({ domain, firstName: contact.first, lastName: contact.last });
    if (found.ok && found.value && emailKey(found.value.email) !== emailKey(contact.email)) {
      suggestedEmail = found.value.email.trim().slice(0, 254);
      hunter += 1;
    }
  }
  return { step: { result: status, score, summary: MAILBOX_SUMMARY[status], suggestedEmail }, cost: { hunter } };
}

// ---------------------------------------------------------------------------
// Running a batch, one step at a time

function batchContacts(row: RunRow, batch: number) {
  return row.contacts.slice(batch * row.batch_size, (batch + 1) * row.batch_size);
}

async function saveCheck(
  supabase: ServiceClient,
  contact: VerifyContact,
  steps: CheckSteps,
  cost: CheckCost,
  finish: boolean,
) {
  const status = finish ? finalStatus(steps) : null;
  const row: CheckRow & { had_error: boolean } = {
    firm_id: contact.firmId,
    email_key: contact.key,
    email: contact.email,
    status,
    steps,
    suggestion: status ? suggestFor(status, steps) : null,
    cost: { ...cost, pipeline: VERIFY_PIPELINE },
    had_error: Boolean(failedStep(steps)),
    checked_at: finish ? nowIso() : null,
  };
  const { error } = await supabase
    .from("contact_checks")
    .upsert({ ...row, updated_at: nowIso() }, { onConflict: "firm_id,email_key" });
  return error ? { ok: false as const, error: verifyTableError(error.message, error.code) } : { ok: true as const, row };
}

/**
 * Runs one step for every contact of a batch, in parallel, and saves the
 * result. Safe to repeat: finished steps are not run again.
 */
export async function runVerificationStep(
  supabase: ServiceClient,
  clientId: string,
  runId: string,
  batch: number,
  step: StepNumber,
): Promise<Result<ContactResult[]>> {
  const loaded = await loadRunRow(supabase, runId, clientId);
  if (!loaded.ok) return loaded;
  const row = loaded.value;
  if (row.status !== "active") return { ok: false, error: "This run is not active." };
  if (!Number.isInteger(batch) || batch < 0 || batch >= row.batches) return { ok: false, error: "Unknown batch." };
  const contacts = batchContacts(row, batch);
  const rows = await loadCheckRows(supabase, contacts);
  if (!rows.ok) return rows;

  const saved = new Map<string, CheckRow>();
  const errors: string[] = [];
  await Promise.all(
    contacts.map(async (contact) => {
      const current = rows.value.get(contact.id);
      if (doneInRun(current, contact, row.created_at)) {
        saved.set(contact.id, current!);
        return;
      }
      const resuming = inProgress(current, contact);
      if (step !== 1 && !resuming) return;
      const steps: CheckSteps = resuming ? { ...(current!.steps ?? {}) } : {};
      let cost = resuming ? costOf(current) : { ...ZERO_COST };
      if (needsStep(steps, step)) {
        if (step === 1) {
          const done = await stepRole(contact);
          steps.role = done.step;
          cost = addCost(cost, done.cost);
        } else {
          const done = await stepMailbox(contact);
          steps.mailbox = done.step;
          cost = addCost(cost, done.cost);
        }
      }
      const result = await saveCheck(supabase, contact, steps, cost, stepsComplete(steps));
      if (!result.ok) errors.push(result.error);
      else saved.set(contact.id, result.row);
    }),
  );
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const decisions = await loadDecisions(supabase, clientId);
  if (!decisions.ok) return decisions;
  return {
    ok: true,
    value: contacts.map((contact) => toResult(contact, saved.get(contact.id), false, decisions.value, new Map())),
  };
}

/** Closes a batch: finishes partial checks, adds the cost, moves to the next batch. */
export async function finishVerificationBatch(
  supabase: ServiceClient,
  clientId: string,
  runId: string,
  batch: number,
  ms: number,
): Promise<Result<BatchDone>> {
  const loaded = await loadRunRow(supabase, runId, clientId);
  if (!loaded.ok) return loaded;
  const row = loaded.value;
  if (!Number.isInteger(batch) || batch < 0 || batch >= row.batches) return { ok: false, error: "Unknown batch." };
  const contacts = batchContacts(row, batch);
  if (row.status !== "active" || batch !== row.next_batch) return batchDone(supabase, row, contacts);

  const rows = await loadCheckRows(supabase, contacts);
  if (!rows.ok) return rows;
  let cost = { ...ZERO_COST };
  const finished: { contact: VerifyContact; row: CheckRow | undefined }[] = [];
  for (const contact of contacts) {
    let current = ownRow(rows.value.get(contact.id), contact, row.created_at);
    if (current) cost = addCost(cost, costOf(current));
    // A check stopped by an error after step 1 is finished with what it has.
    // One without any step stays unchecked, so the next run checks it.
    if (current && !current.checked_at && current.steps?.role) {
      const result = await saveCheck(supabase, contact, current.steps, costOf(current), true);
      if (!result.ok) return result;
      current = result.row;
    }
    finished.push({ contact, row: current });
  }
  const storeError = await storeRunResults(supabase, row.id, finished, false);
  if (storeError) return { ok: false, error: storeError };

  const stats = statsOf(row);
  const nextBatch = batch + 1;
  const done = nextBatch >= row.batches;
  const at = nowIso();
  const { data, error } = await supabase
    .from("verification_runs")
    .update({
      next_batch: nextBatch,
      status: done ? "done" : "active",
      finished_at: done ? at : null,
      updated_at: at,
      stats: {
        usd: Math.round((stats.usd + cost.usd) * 10_000) / 10_000,
        searches: stats.searches + cost.searches,
        hunter: stats.hunter + cost.hunter,
        ms: stats.ms + Math.max(0, Math.min(Number(ms) || 0, 30 * 60 * 1000)),
      },
    })
    .eq("id", row.id)
    .eq("next_batch", batch)
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, error: verifyTableError(error?.message ?? "The batch was not saved.", error?.code) };
  }
  return batchDone(supabase, data as RunRow, contacts);
}

async function batchDone(
  supabase: ServiceClient,
  row: RunRow,
  contacts: VerifyContact[],
): Promise<Result<BatchDone>> {
  const [stored, decisions] = await Promise.all([
    loadRunResults(supabase, row.id),
    loadDecisions(supabase, row.client_id),
  ]);
  if (!stored.ok) return stored;
  if (!decisions.ok) return decisions;
  return {
    ok: true,
    value: {
      nextBatch: row.next_batch,
      status: row.status,
      stats: statsOf(row),
      results: contacts.map((contact) =>
        toResult(contact, stored.value.get(contact.id), false, decisions.value, new Map()),
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Actions on problem contacts

function cleanName(value: unknown) {
  return text(value, 100);
}

export async function applyVerificationActions(
  supabase: ServiceClient,
  clientId: string,
  items: ActionInput[],
  by: string | null,
): Promise<Result<{ id: string; decision: "keep" | "remove" | null; corrected: boolean }[]>> {
  const run = await loadScope(supabase, clientId);
  if (!run.ok) return run;
  const contacts = new Map(collectScopes(run.value).all.contacts.map((contact) => [contact.id, contact]));
  const wanted = items
    .map((item) => ({ item, contact: contacts.get(String(item?.id ?? "")) }))
    .filter((entry): entry is { item: ActionInput; contact: VerifyContact } => Boolean(entry.contact));
  if (wanted.length === 0) {
    return { ok: false, error: "These contacts are no longer in this client's match. Re-run the match and try again." };
  }
  const checks = await loadCheckRows(supabase, wanted.map((entry) => entry.contact));
  if (!checks.ok) return checks;

  const updated: { id: string; decision: "keep" | "remove" | null; corrected: boolean }[] = [];
  for (const { item, contact } of wanted) {
    const check = checks.value.get(contact.id);
    const status = check?.status ?? null;
    const base = {
      firm_id: contact.firmId,
      email_key: contact.key,
      firm_name: contact.firmName,
      person_name: contact.name,
      from_client: clientId,
      updated_by: by,
      updated_at: nowIso(),
    };
    const upsert = async (values: Record<string, unknown>) => {
      const { error } = await supabase
        .from("contact_corrections")
        .upsert({ ...base, ...values }, { onConflict: "firm_id,email_key" });
      return error ? verifyTableError(error.message, error.code) : null;
    };

    let error: string | null = null;
    let decision: "keep" | "remove" | null = null;
    let corrected = false;
    switch (item.action) {
      case "keep":
        error = await saveDecision(supabase, clientId, contact, "keep", status, by);
        decision = "keep";
        break;
      case "remove": {
        error = await saveDecision(supabase, clientId, contact, "remove", status, by);
        decision = "remove";
        const fix = run.value.corrections.get(contact.id);
        if (!error && fix?.flag !== "left_firm") {
          error = await upsert({
            flag: "removed",
            flag_reason: status ? VERIFY_LABEL[status] : "Removed",
          });
        }
        break;
      }
      case "update_email": {
        const email = text(item.email, 254);
        if (!EMAIL_PATTERN.test(email)) {
          error = `${contact.name}: enter a valid email address.`;
          break;
        }
        error = await upsert({ email });
        corrected = true;
        break;
      }
      case "update_name": {
        const firstName = cleanName(item.firstName);
        const lastName = cleanName(item.lastName);
        if (!firstName && !lastName) {
          error = `${contact.name}: enter a first or last name.`;
          break;
        }
        error = await upsert({
          first_name: firstName || null,
          last_name: lastName || null,
          title: text(item.title, 200) || null,
        });
        corrected = true;
        break;
      }
      case "update_firm": {
        const newFirm = text(item.newFirm, 200);
        if (!newFirm) {
          error = `${contact.name}: enter the firm they moved to.`;
          break;
        }
        const website = text(item.newFirmWebsite, 300).replace(/\s/g, "");
        error = await upsert({ flag: "left_firm", flag_reason: `Moved to ${newFirm}` });
        if (!error) {
          const { error: leadError } = await supabase.from("contact_leads").upsert(
            {
              person_name: contact.name,
              title: text(item.title, 200),
              email: null,
              new_firm: newFirm,
              new_firm_website: website || null,
              from_firm_id: contact.firmId,
              from_firm_name: contact.firmName,
              old_email: contact.email,
              evidence: check?.steps?.role?.evidence ?? [],
              status: "new",
              from_client: clientId,
              created_by: by,
              updated_at: nowIso(),
            },
            { onConflict: "from_firm_id,old_email" },
          );
          if (leadError) error = verifyTableError(leadError.message, leadError.code);
        }
        corrected = true;
        break;
      }
      default:
        error = `${contact.name}: unknown action.`;
    }
    if (error) return { ok: false, error };
    updated.push({ id: contact.id, decision, corrected });
  }

  // The current engine's Match page shows who moved up; four-tier runs are permanent.
  if (run.value.engine === "current") {
    const refreshed = await refreshMatch(supabase, clientId, "current");
    if (!refreshed.ok) return refreshed;
  }
  return { ok: true, value: updated };
}

// ---------------------------------------------------------------------------
// Fund Database page: corrections, flags and leads

export async function loadCorrectionRows(
  supabase: ServiceClient,
  liveContacts: { fid: string; email: string }[] | null,
): Promise<Result<CorrectionRow[]>> {
  const { data, error } = await supabase
    .from("contact_corrections")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) return { ok: false, error: verifyTableError(error.message, error.code) };
  const present = liveContacts
    ? new Set(liveContacts.filter((contact) => contact.email).map((contact) => contactId(contact.fid, emailKey(contact.email))))
    : null;
  const order = { left_firm: 0, removed: 1 } as Record<string, number>;
  const rows = ((data ?? []) as (Correction & { firm_id: string })[]).map(
    (row): CorrectionRow => ({
      firmId: row.firm_id,
      key: row.email_key,
      firmName: row.firm_name,
      personName: row.person_name,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      title: row.title,
      flag: row.flag,
      flagReason: row.flag_reason,
      note: row.note,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
      inDatabase: present ? present.has(contactId(row.firm_id, row.email_key)) : true,
    }),
  );
  rows.sort((a, b) => (order[a.flag ?? ""] ?? 2) - (order[b.flag ?? ""] ?? 2) || b.updatedAt.localeCompare(a.updatedAt));
  return { ok: true, value: rows };
}

export async function loadLeadRows(supabase: ServiceClient): Promise<Result<LeadRow[]>> {
  const { data, error } = await supabase
    .from("contact_leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return { ok: false, error: verifyTableError(error.message, error.code) };
  const rank = { new: 0, added: 1, dismissed: 2 } as Record<string, number>;
  const rows = ((data ?? []) as Record<string, unknown>[]).map(
    (row): LeadRow => ({
      id: String(row.id),
      personName: String(row.person_name ?? ""),
      title: String(row.title ?? ""),
      email: row.email != null ? String(row.email) : null,
      newFirm: String(row.new_firm ?? ""),
      newFirmWebsite: row.new_firm_website != null ? String(row.new_firm_website) : null,
      fromFirmName: String(row.from_firm_name ?? ""),
      oldEmail: String(row.old_email ?? ""),
      evidence: cleanEvidence(row.evidence),
      note: row.note != null ? String(row.note) : null,
      status: row.status === "added" || row.status === "dismissed" ? row.status : "new",
      createdAt: String(row.created_at ?? ""),
    }),
  );
  rows.sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.localeCompare(a.createdAt));
  return { ok: true, value: rows };
}

export async function saveCorrection(
  supabase: ServiceClient,
  firmId: string,
  key: string,
  input: { email?: string; firstName?: string; lastName?: string; title?: string; note?: string },
  by: string | null,
): Promise<string | null> {
  const email = text(input.email, 254);
  if (email && !EMAIL_PATTERN.test(email)) return "Enter a valid email address, or leave it empty.";
  const { data, error } = await supabase
    .from("contact_corrections")
    .update({
      email: email || null,
      first_name: cleanName(input.firstName) || null,
      last_name: cleanName(input.lastName) || null,
      title: text(input.title, 200) || null,
      note: text(input.note, 1000) || null,
      updated_by: by,
      updated_at: nowIso(),
    })
    .eq("firm_id", firmId)
    .eq("email_key", key)
    .select("firm_id");
  if (error) return verifyTableError(error.message, error.code);
  if (!data || data.length === 0) return "This correction no longer exists.";
  return null;
}

/** Clears the flag; drops the row when no fix is left on it. */
export async function clearCorrectionFlag(
  supabase: ServiceClient,
  firmId: string,
  key: string,
  by: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("contact_corrections")
    .update({ flag: null, flag_reason: null, updated_by: by, updated_at: nowIso() })
    .eq("firm_id", firmId)
    .eq("email_key", key)
    .select("email, first_name, last_name, title, note");
  if (error) return verifyTableError(error.message, error.code);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (row && !row.email && !row.first_name && !row.last_name && !row.title && !row.note) {
    return deleteCorrection(supabase, firmId, key);
  }
  return null;
}

export async function deleteCorrection(supabase: ServiceClient, firmId: string, key: string): Promise<string | null> {
  const { error } = await supabase
    .from("contact_corrections")
    .delete()
    .eq("firm_id", firmId)
    .eq("email_key", key);
  return error ? verifyTableError(error.message, error.code) : null;
}

export async function setLeadStatus(
  supabase: ServiceClient,
  id: string,
  status: LeadRow["status"],
): Promise<string | null> {
  if (!["new", "added", "dismissed"].includes(status)) return "Unknown status.";
  const { error } = await supabase
    .from("contact_leads")
    .update({ status, updated_at: nowIso() })
    .eq("id", id);
  return error ? verifyTableError(error.message, error.code) : null;
}
