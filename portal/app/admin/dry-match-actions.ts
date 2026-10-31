"use server";

import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { DRY_STEPS, buildDryData, expandStage, funnel, type DryData, type DryStep } from "@/lib/match/dry/core";
import { matchDataSnapshot } from "@/lib/match/tiers/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
type Named = { id: string | null } | null | undefined;
type ServiceClient = ReturnType<typeof createServiceClient>;

export type DryFacts = { fundDbVersion: string; taxonomyRevision: number; profileVersion: string };

export type SavedStep = { step: DryStep; chosen: string[]; chosenLabels: string[]; before: number; removed: number; left: number };

export type SavedDryList = {
  id: string;
  totalFunds: number;
  steps: SavedStep[];
  fundIds: string[];
  fundCount: number;
  facts: DryFacts;
  confirmedBy: string | null;
  confirmedAt: string;
};

const MIGRATION = "The Dry Match table is missing. Run portal/supabase/dry_match.sql in the Supabase SQL editor.";

function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /dry_match_lists/.test(message) || message.toLowerCase().includes("schema cache")
    ? MIGRATION
    : message;
}

async function access() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  return { ok: true as const, supabase: createServiceClient(), email: user.email ?? null };
}

const validId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);

/** The Dry Match data for a client, built from the same loading as Run match. */
async function build(supabase: ServiceClient, clientId: string): Promise<Result<{ data: DryData; facts: DryFacts }>> {
  const snapshot = await matchDataSnapshot(supabase, clientId);
  if (!snapshot.ok) return snapshot;
  const { db, index, common, profileInputs: p } = snapshot.value;
  const id = (value: unknown) => (value as Named)?.id ?? null;
  const data = buildDryData(db, index, {
    financing: ((p.financing as Named[]) ?? []).map(id).filter((v): v is string => !!v),
    stage: id(p.stage),
    hqCountry: id(p.hqCountry),
    primarySector: id(p.primarySector),
  });
  return {
    ok: true,
    data,
    facts: {
      fundDbVersion: String(common.fund_db_version ?? ""),
      taxonomyRevision: Number(common.taxonomy_revision ?? 0),
      profileVersion: common.profile_version == null ? "legacy" : String(common.profile_version),
    },
  };
}

type Row = {
  id: string;
  total_funds: number;
  steps: SavedStep[];
  fund_ids: string[];
  fund_count: number;
  fund_db_version: string | null;
  taxonomy_revision: number | null;
  profile_version: string | null;
  confirmed_by: string | null;
  confirmed_at: string;
};

async function currentList(supabase: ServiceClient, clientId: string): Promise<Result<{ saved: SavedDryList | null }>> {
  const { data, error } = await supabase
    .from("dry_match_lists")
    .select("id, total_funds, steps, fund_ids, fund_count, fund_db_version, taxonomy_revision, profile_version, confirmed_by, confirmed_at")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data) return { ok: true, saved: null };
  return {
    ok: true,
    saved: {
      id: data.id,
      totalFunds: data.total_funds,
      steps: data.steps,
      fundIds: data.fund_ids,
      fundCount: data.fund_count,
      facts: {
        fundDbVersion: data.fund_db_version ?? "",
        taxonomyRevision: Number(data.taxonomy_revision ?? 0),
        profileVersion: data.profile_version ?? "",
      },
      confirmedBy: data.confirmed_by,
      confirmedAt: data.confirmed_at,
    },
  };
}

/** The Dry Match for a client: the data to step through, and its confirmed list if there is one. Read only. */
export async function loadDryMatch(
  clientId: string,
): Promise<Result<{ data: DryData; facts: DryFacts; saved: SavedDryList | null }>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(clientId)) return { ok: false, error: "Unknown client." };
  try {
    const built = await build(a.supabase, clientId);
    if (!built.ok) return built;
    const saved = await currentList(a.supabase, clientId);
    if (!saved.ok) return saved;
    return { ok: true, data: built.data, facts: built.facts, saved: saved.saved };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The Dry Match data did not load." };
  }
}

/**
 * Saves the Dry Match Short List. The server recomputes the funnel from the
 * choices on the live data; nothing the browser counted is trusted.
 */
export async function confirmDryMatch(
  clientId: string,
  choices: Partial<Record<DryStep, string[]>>,
): Promise<Result<{ saved: SavedDryList }>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(clientId)) return { ok: false, error: "Unknown client." };
  try {
    const built = await build(a.supabase, clientId);
    if (!built.ok) return built;
    const { data, facts } = built;
    const clean: Partial<Record<DryStep, string[]>> = {};
    for (const step of DRY_STEPS) {
      const known = new Set(data.options[step].map((o) => o.id));
      const picked = Array.isArray(choices?.[step]) ? choices[step]!.filter((id) => typeof id === "string" && known.has(id)) : [];
      if (picked.length === 0) return { ok: false, error: `Confirm every step first: ${step} has no choice.` };
      clean[step] = Array.from(new Set(picked));
    }
    const steps = funnel(data, clean);
    const last = steps[steps.length - 1];
    const label = (step: DryStep, ids: string[]) => {
      const shown = step === "stage" ? expandStage(ids) : ids;
      return data.options[step].filter((o) => shown.includes(o.id)).map((o) => o.label);
    };
    const savedSteps: SavedStep[] = steps.map((s) => ({
      step: s.step,
      chosen: clean[s.step]!,
      chosenLabels: label(s.step, clean[s.step]!),
      before: s.before,
      removed: s.removed,
      left: s.left,
    }));
    // A new list replaces the current one.
    const cleared = await a.supabase
      .from("dry_match_lists")
      .update({ cleared_at: new Date().toISOString(), cleared_by: a.email })
      .eq("client_id", clientId)
      .is("cleared_at", null);
    if (cleared.error) return { ok: false, error: tableError(cleared.error.message, cleared.error.code) };
    const { data: row, error } = await a.supabase
      .from("dry_match_lists")
      .insert({
        client_id: clientId,
        total_funds: data.funds.length,
        steps: savedSteps,
        fund_ids: last.funds.map((f) => f.id),
        fund_count: last.left,
        fund_db_version: facts.fundDbVersion,
        taxonomy_revision: facts.taxonomyRevision,
        profile_version: facts.profileVersion,
        confirmed_by: a.email,
      })
      .select("id, confirmed_at")
      .single<{ id: string; confirmed_at: string }>();
    if (error) return { ok: false, error: tableError(error.message, error.code) };
    return {
      ok: true,
      saved: {
        id: row.id,
        totalFunds: data.funds.length,
        steps: savedSteps,
        fundIds: last.funds.map((f) => f.id),
        fundCount: last.left,
        facts,
        confirmedBy: a.email,
        confirmedAt: row.confirmed_at,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The list was not saved." };
  }
}

/** Start over: the current list is set aside (kept on record) and the steps open again. */
export async function startOverDryMatch(clientId: string): Promise<Result<object>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(clientId)) return { ok: false, error: "Unknown client." };
  const { error } = await a.supabase
    .from("dry_match_lists")
    .update({ cleared_at: new Date().toISOString(), cleared_by: a.email })
    .eq("client_id", clientId)
    .is("cleared_at", null);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true };
}
