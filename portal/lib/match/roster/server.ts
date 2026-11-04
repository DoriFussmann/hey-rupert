import "server-only";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import type { createServiceClient } from "@/lib/supabase/admin";
import { buildDryData, type DryStep } from "@/lib/match/dry/core";
import { matchDataSnapshot } from "@/lib/match/tiers/server";
import { addedForLandscape, dismissSuggestion, skipMissingFields, fillAddedFields, fillItems, labelLists, suggestMissingFields, type FilledFields } from "@/lib/match/added/server";
import type { AiSuggestion, FillItem } from "@/lib/match/added/core";
import { checkAgainstDatabase, currentLandscape } from "@/lib/match/landscape/server";
import type { CheckRow } from "@/lib/match/landscape/check";
import { buildRoster, type Roster, type RosterCounts, type RosterEntry, type ExclusionCheck, type AddedCheck } from "./core.ts";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ROSTER_MIGRATION = "The Final Roster table is missing. Run portal/supabase/final_roster.sql in the Supabase SQL editor.";

function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /final_rosters/.test(message) || message.toLowerCase().includes("schema cache")
    ? ROSTER_MIGRATION
    : message;
}

/** What the Roster was built from: a change to any of these shows as "changed since confirmed". */
export type RosterFacts = { dryListId: string; landscapeId: string | null; dataVersion: string; exclusions: string; step2Skipped: boolean };

export type RosterOptions = { stages: string[]; geographies: string[]; sectors: string[] };

export type SavedRoster = {
  id: string;
  entries: RosterEntry[];
  added: AddedCheck[];
  exclusions: ExclusionCheck[];
  counts: RosterCounts;
  facts: RosterFacts;
  confirmedAt: string;
  confirmedBy: string | null;
};

export type RosterState =
  | { status: "blocked"; reason: string }
  | {
      status: "ready";
      draft: Roster;
      facts: RosterFacts;
      fill: FillItem[];
      options: RosterOptions;
      saved: SavedRoster | null;
      /** What changed since the saved Roster was confirmed. */
      changed: string[];
    };

type SavedRow = {
  id: string;
  entries: RosterEntry[];
  added_checks: AddedCheck[];
  exclusion_checks: ExclusionCheck[];
  counts: RosterCounts;
  facts: RosterFacts;
  confirmed_at: string;
  confirmed_by: string | null;
};

async function savedRoster(supabase: ServiceClient, clientId: string): Promise<Result<SavedRoster | null>> {
  const { data, error } = await supabase
    .from("final_rosters")
    .select("id, entries, added_checks, exclusion_checks, counts, facts, confirmed_at, confirmed_by")
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
      entries: data.entries ?? [],
      added: data.added_checks ?? [],
      exclusions: data.exclusion_checks ?? [],
      counts: data.counts,
      facts: data.facts,
      confirmedAt: data.confirmed_at,
      confirmedBy: data.confirmed_by,
    },
  };
}

type Named = { label?: string | null } | null | undefined;

/** The Roster as it stands now, from the confirmed Steps 1 and 2 and the live database. Reads only. */
async function draft(supabase: ServiceClient, clientId: string) {
  const { data: dry, error: dryError } = await supabase
    .from("dry_match_lists")
    .select("id, steps, fund_ids")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; steps: { step: DryStep; chosen: string[] }[]; fund_ids: string[] }>();
  if (dryError) return { ok: false as const, error: dryError.message };
  if (!dry) return { ok: true as const, blocked: "Opens once Step 1 is confirmed." };
  const land = await currentLandscape(supabase, clientId);
  if (!land.ok) return land;
  if (!land.value || land.value.status !== "confirmed") return { ok: true as const, blocked: "Opens once Step 2 is done." };
  const skipped = land.value.competitors.length === 0;
  let rows: CheckRow[] = [];
  if (!skipped) {
    if (land.value.investorsStatus !== "confirmed") return { ok: true as const, blocked: "Opens once Step 2 is done (2B isn't confirmed)." };
    const check = await checkAgainstDatabase(supabase, clientId);
    if (!check.ok) return check;
    if (!check.value.confirmedAt) return { ok: true as const, blocked: "Opens once Step 2 is done (2C isn't confirmed)." };
    if (!check.value.addedConfirmedAt) return { ok: true as const, blocked: "Opens once Step 2 is done (2D isn't confirmed)." };
    rows = check.value.rows;
  }
  const snapshot = await matchDataSnapshot(supabase, clientId);
  if (!snapshot.ok) return snapshot;
  const { db, index, profileInputs, exclusions, dataVersion } = snapshot.value;
  const data = buildDryData(db, index, { financing: [], stage: null, hqCountry: null, primarySector: null });
  const addedFunds = skipped ? {} : await addedForLandscape(supabase, land.value.id);
  const clientSectors = [profileInputs.primarySector as Named, ...((profileInputs.secondarySectors as Named[]) ?? [])]
    .map((x) => x?.label ?? "")
    .filter(Boolean);
  const roster = buildRoster({
    data,
    firms: db.firms.map((f) => ({ id: f.id, name: f.name, web: f.web })),
    steps: dry.steps.map((s) => ({ step: s.step, chosen: s.chosen })),
    shortlist: dry.fund_ids,
    rows,
    added: Object.values(addedFunds).map((f) => ({ id: f.id, firmId: f.firmId, name: f.name, kind: f.kind, status: f.status })),
    clientSectors,
    exclusions,
  });
  // 3A: the added investors still missing a field, with every field shown.
  const waiting = new Set(roster.added.filter((x) => x.result === "missing").map((x) => x.addedId));
  const fill: FillItem[] = fillItems(index, Object.values(addedFunds)).filter((x) => waiting.has(x.addedId));
  const lists = labelLists(index);
  return {
    ok: true as const,
    roster,
    fill,
    options: { stages: lists.stages, geographies: lists.geographies, sectors: [...lists.industries, ...lists.verticals].sort() },
    facts: { dryListId: dry.id, landscapeId: skipped ? null : land.value.id, dataVersion, exclusions, step2Skipped: skipped } as RosterFacts,
  };
}

/**
 * What a rebuild would change, in words: empty when the Roster built now is
 * the one confirmed. Steps re-confirmed with the same result (a new Step 1
 * list with the same funds, Step 2 redone with the same outcome) change nothing.
 */
function changes(saved: SavedRoster, now: Roster): string[] {
  const key = (e: RosterEntry) => `${e.firmId}|${e.source}|${e.backed.join(",")}`;
  const before = new Set(saved.entries.map(key));
  const after = new Set(now.entries.map(key));
  const ids = (list: RosterEntry[]) => new Set(list.map((e) => e.firmId));
  const was = ids(saved.entries);
  const is = ids(now.entries);
  const added = Array.from(is).filter((id) => !was.has(id)).length;
  const removed = Array.from(was).filter((id) => !is.has(id)).length;
  const retagged = now.entries.filter((e) => was.has(e.firmId) && !before.has(key(e))).length;
  const out: string[] = [];
  if (added) out.push(`${added.toLocaleString("en-US")} ${added === 1 ? "investor" : "investors"} would be added.`);
  if (removed) out.push(`${removed.toLocaleString("en-US")} would be removed.`);
  if (retagged) out.push(`${retagged.toLocaleString("en-US")} would change source or competitor tag.`);
  const lines = (list: ExclusionCheck[]) => list.map((x) => `${x.line}|${x.result}|${x.firmId ?? ""}`).sort().join("\n");
  if (lines(saved.exclusions) !== lines(now.exclusions)) out.push("The client's exclusions changed.");
  return out.length || before.size === after.size ? out : ["The Roster would change."];
}

export async function loadRoster(supabase: ServiceClient, clientId: string): Promise<Result<RosterState>> {
  const built = await draft(supabase, clientId);
  if (!built.ok) return built;
  if ("blocked" in built) return { ok: true, value: { status: "blocked", reason: built.blocked! } };
  const saved = await savedRoster(supabase, clientId);
  if (!saved.ok) return saved;
  return {
    ok: true,
    value: {
      status: "ready",
      draft: built.roster,
      facts: built.facts,
      fill: built.fill,
      options: built.options,
      saved: saved.value,
      changed: saved.value ? changes(saved.value, built.roster) : [],
    },
  };
}

/** 3A: fills in (or accepts the AI's suggestion for) an added investor's missing fields. */
export async function fillMissing(supabase: ServiceClient, clientId: string, addedId: string, fields: FilledFields): Promise<Result<null>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const done = await fillAddedFields(supabase, taxonomy.value, clientId, addedId, fields);
  return done.ok ? { ok: true, value: null } : done;
}

/** 3A: Fill missing fields with AI, for a few investors at once. Each failure is reported; the rest go on. */
export async function suggestMissing(supabase: ServiceClient, clientId: string, addedIds: string[]): Promise<Result<{ done: number; problems: string[] }>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const results = await Promise.all(addedIds.map((id) => suggestMissingFields(supabase, taxonomy.value, id, clientId)));
  const problems = results.filter((r): r is { ok: false; error: string } => !r.ok).map((r) => r.error);
  return { ok: true, value: { done: results.length - problems.length, problems } };
}

export async function dismissMissing(supabase: ServiceClient, addedId: string): Promise<Result<null>> {
  return dismissSuggestion(supabase, addedId);
}

export async function skipMissing(supabase: ServiceClient, addedId: string, skip: boolean): Promise<Result<null>> {
  return skipMissingFields(supabase, addedId, skip);
}

export type { AiSuggestion };

/** Confirms the Final Roster: recomputed on the server, saved, replacing the current one. */
export async function confirmRoster(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<SavedRoster>> {
  const built = await draft(supabase, clientId);
  if (!built.ok) return built;
  if ("blocked" in built) return { ok: false, error: built.blocked! };
  const { roster, facts } = built;
  const cleared = await supabase
    .from("final_rosters")
    .update({ cleared_at: new Date().toISOString(), cleared_by: actor })
    .eq("client_id", clientId)
    .is("cleared_at", null);
  if (cleared.error) return { ok: false, error: tableError(cleared.error.message, cleared.error.code) };
  const { data, error } = await supabase
    .from("final_rosters")
    .insert({
      client_id: clientId,
      dry_list_id: facts.dryListId,
      landscape_id: facts.landscapeId,
      entries: roster.entries,
      fund_ids: roster.entries.map((e) => e.firmId),
      added_checks: roster.added,
      exclusion_checks: roster.exclusions,
      counts: roster.counts,
      facts,
      confirmed_by: actor,
    })
    .select("id, confirmed_at")
    .single<{ id: string; confirmed_at: string }>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return {
    ok: true,
    value: {
      id: data.id,
      entries: roster.entries,
      added: roster.added,
      exclusions: roster.exclusions,
      counts: roster.counts,
      facts,
      confirmedAt: data.confirmed_at,
      confirmedBy: actor,
    },
  };
}

/** Reopen: the confirmed Roster is set aside (kept on record). */
export async function reopenRoster(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<null>> {
  const { error } = await supabase
    .from("final_rosters")
    .update({ cleared_at: new Date().toISOString(), cleared_by: actor })
    .eq("client_id", clientId)
    .is("cleared_at", null);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: null };
}

/** The confirmed Roster, for the download. */
export async function confirmedRoster(supabase: ServiceClient, clientId: string) {
  return savedRoster(supabase, clientId);
}
