import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { buildDryData, type DryStep } from "@/lib/match/dry/core";
import { matchDataSnapshot } from "@/lib/match/tiers/server";
import { addedForLandscape, fillAddedFields, labelLists, type FilledFields } from "@/lib/match/added/server";
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

/** 3A: an added investor with missing fields, its current values and the choices. */
export type FillItem = {
  addedId: string;
  name: string;
  kind: "fund" | "angel";
  website: string;
  missing: AddedCheck["missing"];
  stages: string[];
  geographies: string[];
  sectors: string[];
};

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
  const byId = new Map(Object.values(addedFunds).map((f) => [f.id, f]));
  const fill: FillItem[] = roster.added
    .filter((a) => a.result === "missing")
    .map((a) => {
      const f = byId.get(a.addedId)!;
      return {
        addedId: a.addedId,
        name: a.name,
        kind: a.kind,
        website: f?.website ?? "",
        missing: a.missing,
        stages: f?.stages ?? [],
        geographies: f?.geographies ?? [],
        sectors: [...(f?.industries ?? []), ...(f?.verticals ?? [])],
      };
    });
  const lists = labelLists(index);
  return {
    ok: true as const,
    roster,
    fill,
    options: { stages: lists.stages, geographies: lists.geographies, sectors: [...lists.industries, ...lists.verticals].sort() },
    facts: { dryListId: dry.id, landscapeId: skipped ? null : land.value.id, dataVersion, exclusions, step2Skipped: skipped } as RosterFacts,
  };
}

function changes(saved: RosterFacts, now: RosterFacts): string[] {
  const out: string[] = [];
  if (saved.dryListId !== now.dryListId) out.push("Step 1 was confirmed again.");
  if (saved.landscapeId !== now.landscapeId) out.push("Step 2 was redone.");
  if (saved.dataVersion !== now.dataVersion) out.push("The Fund Database or the added investors changed.");
  if (saved.exclusions !== now.exclusions) out.push("The client's exclusions changed.");
  return out;
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
      changed: saved.value ? changes(saved.value.facts, built.facts) : [],
    },
  };
}

/** 3A: fills in an added investor's missing fields. */
export async function fillMissing(supabase: ServiceClient, clientId: string, addedId: string, fields: FilledFields): Promise<Result<null>> {
  const snapshot = await matchDataSnapshot(supabase, clientId);
  if (!snapshot.ok) return snapshot;
  const done = await fillAddedFields(supabase, snapshot.value.index, clientId, addedId, fields);
  return done.ok ? { ok: true, value: null } : done;
}

/** Confirms the Final Roster: recomputed on the server, saved, replacing the current one. */
export async function confirmRoster(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<SavedRoster>> {
  const built = await draft(supabase, clientId);
  if (!built.ok) return built;
  if ("blocked" in built) return { ok: false, error: built.blocked! };
  const { roster, facts } = built;
  if (roster.counts.addedMissing > 0) return { ok: false, error: `Fill in the missing fields first (${roster.counts.addedMissing} to go).` };
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
