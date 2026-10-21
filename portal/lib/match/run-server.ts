import "server-only";
import type { MatchProfile, RankedContact } from "@/lib/match/engine/index.mjs";
import {
  loadCorrections,
  loadDecisions,
  type Correction,
  type Decision,
} from "@/lib/match/corrections-server";
import { loadLiveDb, selectAll, type LiveDb } from "@/lib/match/db-server";
import { buildProfile, canRun, loadProfileState } from "@/lib/match/profile-server";
import type { MatchProfileState, Review } from "@/lib/match/shared";
import { contactId, contactKeyOf } from "@/lib/match/verify";
import type { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Everything a match for one client starts from: the live Fund Database, the
 * profile and its settings, this client's reviews and contact decisions, the
 * funds hidden for all clients and the contact fixes.
 */
export type MatchContext = {
  live: LiveDb;
  state: MatchProfileState;
  /** The profile as the engine's shared helpers read it: exclusions, filters, website check, contact ranking. */
  profile: MatchProfile;
  reviews: Map<string, Review>;
  hidden: { id: string; name: string; reason: string }[];
  /** Fixes and flags applied on top of the Fund Database, by contact id. */
  corrections: Map<string, Correction>;
  /** This client's keep / remove decisions, by contact id. */
  decisions: Map<string, Decision>;
};

/** A contact's id: FirmID + original email key. */
export function rankedContactId(contact: RankedContact) {
  return contactId(contact.fid, contactKeyOf(contact));
}

/** This client's fund reviews, by FirmID. */
export async function loadReviews(supabase: ServiceClient, clientId: string) {
  const loaded = await selectAll<{ firm_id: string; status: string; reason: string | null; note: string | null }>(
    (from, to) =>
      supabase
        .from("match_reviews")
        .select("firm_id, status, reason, note")
        .eq("client_id", clientId)
        .order("firm_id")
        .range(from, to),
  );
  if (!loaded.ok) return loaded;
  const reviews = new Map<string, Review>();
  for (const row of loaded.rows) {
    reviews.set(row.firm_id, {
      status: row.status === "no" ? "no" : "ok",
      reason: row.reason ?? "",
      note: row.note ?? "",
    });
  }
  return { ok: true as const, reviews };
}

/** Funds hidden for all clients, newest first. */
export async function loadHidden(supabase: ServiceClient) {
  const loaded = await selectAll<{ firm_id: string; firm_name: string; reason: string | null }>(
    (from, to) =>
      supabase
        .from("match_suppressions")
        .select("firm_id, firm_name, reason")
        .order("created_at", { ascending: false })
        .range(from, to),
  );
  if (!loaded.ok) return loaded;
  return {
    ok: true as const,
    hidden: loaded.rows.map((row) => ({
      id: row.firm_id,
      name: row.firm_name,
      reason: row.reason ?? "",
    })),
  };
}

/** Loads a client's match context. Refuses a profile without a stage, a sector and an HQ country. */
export async function loadMatchContext(
  supabase: ServiceClient,
  clientId: string,
): Promise<Result<MatchContext>> {
  const [live, loadedState, loadedReviews, loadedHidden, loadedCorrections, loadedDecisions] =
    await Promise.all([
      loadLiveDb(supabase),
      loadProfileState(supabase, clientId),
      loadReviews(supabase, clientId),
      loadHidden(supabase),
      loadCorrections(supabase),
      loadDecisions(supabase, clientId),
    ]);
  if (!live.ok) return live;
  if (!loadedState.ok) return loadedState;
  if (!loadedReviews.ok) return loadedReviews;
  if (!loadedHidden.ok) return loadedHidden;
  if (!loadedCorrections.ok) return loadedCorrections;
  if (!loadedDecisions.ok) return loadedDecisions;
  const state = loadedState.value;
  if (!state) return { ok: false, error: "Fill the company profile, then run the match." };

  const { profile } = buildProfile(state.answers, state.settings);
  if (!canRun(profile)) {
    return {
      ok: false,
      error: "The profile needs at least a stage, a sector and an HQ country to run.",
    };
  }
  return {
    ok: true,
    value: {
      live: live.value,
      state,
      profile,
      reviews: loadedReviews.reviews,
      hidden: loadedHidden.hidden,
      corrections: loadedCorrections.value,
      decisions: loadedDecisions.value,
    },
  };
}
