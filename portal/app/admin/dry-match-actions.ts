"use server";

import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { buildDryData, type DryData } from "@/lib/match/dry/core";
import { matchDataSnapshot } from "@/lib/match/tiers/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
type Named = { id: string | null } | null | undefined;

/**
 * The Dry Match data for a client: the corrected live Fund Database in
 * compact form, with the company's defaults. Same loading as Run match.
 * Read only: nothing is saved.
 */
export async function loadDryMatch(clientId: string): Promise<Result<{ data: DryData; facts: Record<string, string | number> }>> {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false, error: "Service role key is not configured." };
  if (typeof clientId !== "string" || !/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false, error: "Unknown client." };
  try {
    const snapshot = await matchDataSnapshot(createServiceClient(), clientId);
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
        profileVersion: common.profile_version == null ? "legacy" : Number(common.profile_version),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The Dry Match data did not load." };
  }
}
