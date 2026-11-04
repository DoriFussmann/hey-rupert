import "server-only";
import RME from "@/lib/match/engine/index.mjs";
import type { createServiceClient } from "@/lib/supabase/admin";
import { GENERALIST_KIND, mapFirm, type TaxIndex } from "@/lib/taxonomy/core";
import type { Firm, FundDb } from "@/lib/match/engine/index.mjs";
import { matchDataSnapshot } from "@/lib/match/tiers/server";
import { checkAgainstDatabase } from "@/lib/match/landscape/server";
import { sectorProfile, type ProfileEntry } from "@/lib/match/landscape/lookalike";
import { stageFromRound } from "@/lib/match/landscape/core";
import { confirmedRoster } from "@/lib/match/roster/server";
import { SOURCE_LABEL } from "@/lib/match/roster/core";
import {
  PLAN_INPUT_KEYS,
  planCapacity,
  planCounts,
  planInputProblems,
  SAME_STAGE_SEEDS_MIN,
  rankFunds,
  sameStage,
  tierRoster,
  waterfall,
  type ClientSubSectors,
  type PlanCapacity,
  type PlanCounts,
  type PlanFund,
  type PlanInputs,
  type Planned,
} from "./core.ts";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const PLAN_MIGRATION = "The Plan table is missing. Run portal/supabase/match_plans.sql in the Supabase SQL editor.";

function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /match_plans/.test(message) || message.toLowerCase().includes("schema cache") ? PLAN_MIGRATION : message;
}

/** What the Plan was built from: a change shows as "changed since confirmed". */
export type PlanFacts = { rosterId: string; dataVersion: string; taxonomyRevision: number; subSectors: ClientSubSectors };

export type SubSectorView = { role: "Primary sub-sector" | "Secondary sub-sector 1" | "Secondary sub-sector 2"; id: string | null; label: string; sector: string };

export type SavedPlan = {
  id: string;
  inputs: PlanInputs;
  capacity: PlanCapacity;
  counts: PlanCounts;
  planned: Planned[];
  /** Every ranked fund, in order, with its tier: Step 5 refills from here. */
  funds: PlanFund[];
  facts: PlanFacts;
  confirmedAt: string;
  confirmedBy: string | null;
};

export type PlanState =
  | { status: "blocked"; reason: string }
  | {
      status: "ready";
      funds: PlanFund[];
      subSectors: SubSectorView[];
      /** Competitor investors found in the database: the look-alike seeds. */
      seeds: number;
      /** The client's stage, and how many seeds backed a competitor at it. */
      clientStage: string;
      sameStageSeeds: number;
      /** The look-alike profile is built from the same-stage backers (else from every backer: too few at the stage). */
      seedsBasis: "same_stage" | "all";
      profile: ProfileEntry[];
      facts: PlanFacts;
      saved: SavedPlan | null;
      changed: string[];
    };

/** Usable contacts per firm: an email on file, not ops or an advisor (as 2D picks them). */
function contactCounts(db: FundDb): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of db.contacts) {
    if (!c.email?.trim()) continue;
    const role = RME.roleOf(c.title || "");
    if (role === "ops" || role === "advisor") continue;
    out.set(c.fid, (out.get(c.fid) ?? 0) + 1);
  }
  return out;
}

/** A firm's approved sub-sectors (industries and verticals), generalist marker left out. */
function subSectorsOf(firm: Firm, index: TaxIndex): string[] {
  const mapping = mapFirm(firm, index);
  return Array.from(
    new Set(
      mapping.tags
        .filter((t) => (t.field === "industry" || t.field === "vertical") && t.review === "approved" && index.nodes.get(t.nodeId)?.kind !== GENERALIST_KIND)
        .map((t) => t.nodeId),
    ),
  );
}

type Named = { id?: string | null; label?: string | null } | null | undefined;

async function draft(supabase: ServiceClient, clientId: string) {
  const roster = await confirmedRoster(supabase, clientId);
  if (!roster.ok) return roster;
  if (!roster.value) return { ok: true as const, blocked: "Opens once Step 3 is confirmed." };
  const snapshot = await matchDataSnapshot(supabase, clientId);
  if (!snapshot.ok) return snapshot;
  const { db, index, profileInputs, dataVersion } = snapshot.value;

  const primary = profileInputs.primarySector as Named;
  const secondary = ((profileInputs.secondarySectors as Named[]) ?? []).map((s) => s?.id ?? null);
  const subSectors: ClientSubSectors = { primary: primary?.id ?? null, secondary1: secondary[0] ?? null, secondary2: secondary[1] ?? null };
  const sectorOf = (id: string | null) => {
    let node = id ? index.nodes.get(id) : undefined;
    while (node && node.kind !== "group") node = node.parentId ? index.nodes.get(node.parentId) : undefined;
    return node?.label ?? "";
  };
  const view = (role: SubSectorView["role"], id: string | null): SubSectorView => ({ role, id, label: id ? index.nodes.get(id)?.label ?? id : "–", sector: sectorOf(id) });

  const firmById = new Map(db.firms.map((f) => [f.id, f]));
  const sectorsCache = new Map<string, string[]>();
  const sectors = (id: string) => {
    let s = sectorsCache.get(id);
    if (!s) {
      const firm = firmById.get(id);
      s = firm ? subSectorsOf(firm, index) : [];
      sectorsCache.set(id, s);
    }
    return s;
  };

  // The competitors' investors found in the database (2C), whether or not they made the Roster,
  // with the competitors each backed at the client's stage (the round's stage, read from its name).
  const clientStage = (profileInputs.stage as Named)?.label ?? "";
  const sameStageBy = new Map<string, Set<string>>();
  let seedIds: string[] = [];
  if (!roster.value.facts.step2Skipped) {
    const check = await checkAgainstDatabase(supabase, clientId);
    if (check.ok) {
      for (const row of check.value.rows) {
        const id = row.firmId ?? row.added?.firmId ?? null;
        if (!id || !firmById.has(id)) continue;
        seedIds.push(id);
        for (const b of row.investor.backed) {
          if (!sameStage(stageFromRound(b.round), clientStage)) continue;
          const set = sameStageBy.get(id) ?? new Set<string>();
          set.add(b.competitor);
          sameStageBy.set(id, set);
        }
      }
      seedIds = Array.from(new Set(seedIds));
    }
  }
  // Look-alikes of the same-stage backers, when there are enough of them; else of every backer.
  const sameStageSeeds = seedIds.filter((id) => sameStageBy.has(id));
  const seedsBasis: "same_stage" | "all" = sameStageSeeds.length >= SAME_STAGE_SEEDS_MIN ? "same_stage" : "all";
  const label = (id: string) => index.nodes.get(id)?.label ?? id;
  const profile = sectorProfile((seedsBasis === "same_stage" ? sameStageSeeds : seedIds).map((id) => ({ id, name: id, sectors: sectors(id).map(label) })));

  const contacts = contactCounts(db);
  const funds = tierRoster(
    index,
    subSectors,
    roster.value.entries.map((e) => ({
      firmId: e.firmId,
      name: e.name,
      website: e.website,
      source: SOURCE_LABEL[e.source],
      backed: e.backed,
      sameStage: Array.from(sameStageBy.get(e.firmId) ?? []).sort(),
      sectors: sectors(e.firmId),
      contacts: contacts.get(e.firmId) ?? 0,
    })),
    profile,
  );
  return {
    ok: true as const,
    funds,
    seeds: seedIds.length,
    clientStage,
    sameStageSeeds: sameStageSeeds.length,
    seedsBasis,
    profile: profile.slice(0, 10),
    subSectors: [view("Primary sub-sector", subSectors.primary), view("Secondary sub-sector 1", subSectors.secondary1), view("Secondary sub-sector 2", subSectors.secondary2)],
    facts: { rosterId: roster.value.id, dataVersion, taxonomyRevision: index.taxonomy.revision, subSectors } as PlanFacts,
  };
}

type SavedRow = {
  id: string;
  inputs: PlanInputs;
  capacity: PlanCapacity;
  counts: PlanCounts;
  planned: Planned[];
  funds: PlanFund[];
  facts: PlanFacts;
  confirmed_at: string;
  confirmed_by: string | null;
};

async function savedPlan(supabase: ServiceClient, clientId: string): Promise<Result<SavedPlan | null>> {
  const { data, error } = await supabase
    .from("match_plans")
    .select("id, inputs, capacity, counts, planned, funds, facts, confirmed_at, confirmed_by")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle<SavedRow>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      id: data.id,
      inputs: data.inputs,
      capacity: data.capacity,
      counts: data.counts,
      planned: data.planned ?? [],
      funds: data.funds ?? [],
      facts: data.facts,
      confirmedAt: data.confirmed_at,
      confirmedBy: data.confirmed_by,
    },
  };
}

/** What re-planning would change, in words: empty when the Roster's tiers, ranks and contacts are the ones confirmed. */
function changes(saved: SavedPlan, now: PlanFund[]): string[] {
  const key = (f: PlanFund) => `${f.firmId}|${f.tier}|${f.contacts}|${f.backed.join(",")}|${(f.sameStage ?? []).join(",")}|${f.lookAlike}|${f.focus}`;
  const before = new Set(saved.funds.map(key));
  const was = new Set(saved.funds.map((f) => f.firmId));
  const is = new Set(now.map((f) => f.firmId));
  const added = now.filter((f) => !was.has(f.firmId)).length;
  const removed = saved.funds.filter((f) => !is.has(f.firmId)).length;
  const moved = now.filter((f) => was.has(f.firmId) && !before.has(key(f))).length;
  const out: string[] = [];
  if (added) out.push(`${added.toLocaleString("en-US")} ${added === 1 ? "fund is" : "funds are"} new on the Roster.`);
  if (removed) out.push(`${removed.toLocaleString("en-US")} left the Roster.`);
  if (moved) out.push(`${moved.toLocaleString("en-US")} changed tier, contacts or ranking facts.`);
  return out;
}

export async function loadPlan(supabase: ServiceClient, clientId: string): Promise<Result<PlanState>> {
  const built = await draft(supabase, clientId);
  if (!built.ok) return built;
  if ("blocked" in built) return { ok: true, value: { status: "blocked", reason: built.blocked! } };
  const saved = await savedPlan(supabase, clientId);
  if (!saved.ok) return saved;
  return {
    ok: true,
    value: {
      status: "ready",
      funds: built.funds,
      subSectors: built.subSectors,
      seeds: built.seeds,
      clientStage: built.clientStage,
      sameStageSeeds: built.sameStageSeeds,
      seedsBasis: built.seedsBasis,
      profile: built.profile,
      facts: built.facts,
      saved: saved.value,
      changed: saved.value ? changes(saved.value, built.funds) : [],
    },
  };
}

/** Whole numbers only, each key once; anything else is a problem. */
export function cleanInputs(raw: unknown): PlanInputs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out = {} as PlanInputs;
  for (const key of PLAN_INPUT_KEYS) {
    const v = r[key];
    if (typeof v !== "number") return null;
    out[key] = v;
  }
  return out;
}

/** Confirms the Plan: recomputed on the server from the confirmed Roster, saved, replacing the current one. */
export async function confirmPlan(supabase: ServiceClient, clientId: string, inputs: PlanInputs, actor: string | null): Promise<Result<SavedPlan>> {
  const problems = planInputProblems(inputs);
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const built = await draft(supabase, clientId);
  if (!built.ok) return built;
  if ("blocked" in built) return { ok: false, error: built.blocked! };
  const funds = rankFunds(built.funds, inputs.contactsPerFund);
  const capacity = planCapacity(inputs);
  const w = waterfall(funds, capacity.contacts, inputs.contactsPerFund);
  if (w.plannedFunds < 1) return { ok: false, error: "Nothing to plan: no fund in the tiers has a contact." };
  const counts = planCounts(funds, w);
  const cleared = await supabase.from("match_plans").update({ cleared_at: new Date().toISOString(), cleared_by: actor }).eq("client_id", clientId).is("cleared_at", null);
  if (cleared.error) return { ok: false, error: tableError(cleared.error.message, cleared.error.code) };
  const { data, error } = await supabase
    .from("match_plans")
    .insert({
      client_id: clientId,
      roster_id: built.facts.rosterId,
      inputs,
      capacity,
      counts,
      planned: w.planned,
      fund_ids: w.planned.map((p) => p.firmId),
      funds,
      facts: built.facts,
      confirmed_by: actor,
    })
    .select("id, confirmed_at")
    .single<{ id: string; confirmed_at: string }>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return {
    ok: true,
    value: { id: data.id, inputs, capacity, counts, planned: w.planned, funds, facts: built.facts, confirmedAt: data.confirmed_at, confirmedBy: actor },
  };
}

/** Reopen: the confirmed Plan is set aside (kept on record). */
export async function reopenPlan(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<null>> {
  const { error } = await supabase.from("match_plans").update({ cleared_at: new Date().toISOString(), cleared_by: actor }).eq("client_id", clientId).is("cleared_at", null);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: null };
}
