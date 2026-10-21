import "server-only";
import RME, {
  type Flag,
  type FundDb,
  type MatchProfile,
  type MatchResult,
  type RankedContact,
  type RunOutput,
  type SiteResult,
  type Tier,
} from "@/lib/match/engine/index.mjs";
import {
  applyCorrections,
  loadChecksForFirms,
  loadCorrections,
  loadDecisions,
  type CheckBrief,
  type Correction,
  type Decision,
} from "@/lib/match/corrections-server";
import { unmatchedExclusionEntries } from "@/lib/match/exclusion-warnings";
import { emailKey as outreachEmailKey, firmsToKeep } from "@/lib/match/outreach-dedupe";
import { loadLiveDb, selectAll, type LiveDb } from "@/lib/match/db-server";
import { buildProfile, canRun, loadProfileState, matchBasis } from "@/lib/match/profile-server";
import { loadSites } from "@/lib/match/sites-server";
import {
  LEVEL_LABEL,
  SITE_LABEL,
  TIERS,
  TIER_TO_FIT,
  dropSectorFocus,
  firmTypeLabel,
  type ContactBrief,
  type Count,
  type FirmContact,
  type FirmDetail,
  type FirmRow,
  type MatchProfileState,
  type MatchView,
  type Review,
  type SiteState,
  type TierSummary,
} from "@/lib/match/shared";
import {
  VERIFY_LABEL,
  contactId,
  contactKeyOf,
  emailKey,
  personNameOf,
  type VerifyState,
} from "@/lib/match/verify";
import {
  websiteHref,
  type InvestorListPayload,
  type InvestorListSummary,
  type InvestorRow,
} from "@/lib/setup";
import type { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type MatchRun = {
  live: LiveDb;
  state: MatchProfileState;
  profile: MatchProfile;
  out: RunOutput;
  reviews: Map<string, Review>;
  hidden: { id: string; name: string; reason: string }[];
  sites: Record<string, SiteResult>;
  /** When each loaded website result was checked. */
  checkedAt: Record<string, string>;
  /** Fixes and flags applied on top of the Fund Database, by contact id. */
  corrections: Map<string, Correction>;
  /** This client's keep / remove decisions, by contact id. */
  decisions: Map<string, Decision>;
  /** Stored verification checks for the contacts at these funds, by contact id. */
  checks: Map<string, CheckBrief>;
};

/** A contact's id: FirmID + original email key. */
export function rankedContactId(contact: RankedContact) {
  return contactId(contact.fid, contactKeyOf(contact));
}

/** The contact's verification state; a check of an older email does not count. */
export function verifyStateOf(run: MatchRun, contact: RankedContact): VerifyState {
  if (!contact.email) return "unverified";
  const check = run.checks.get(rankedContactId(contact));
  if (!check?.status || !check.checkedAt) return "unverified";
  return emailKey(check.email) === emailKey(contact.email) ? check.status : "unverified";
}

/** When the contact's current email was checked, or null. */
export function verifiedAtOf(run: MatchRun, contact: RankedContact): string | null {
  return verifyStateOf(run, contact) === "unverified"
    ? null
    : run.checks.get(rankedContactId(contact))?.checkedAt ?? null;
}

/** Investing contacts with an email: what "contacts identified" counts. */
function investingPeople(result: MatchResult) {
  return result.ranked.filter((contact) => contact.email && contact.role !== "ops").length;
}

/**
 * The funds the engine will check, in its own order: the first `siteN`
 * per tier before the Bullseye cap, skipping rejected ones. A few extra are
 * included so nothing it looks up is missing.
 */
export function siteCandidates(out: RunOutput, db: FundDb, siteN: number) {
  if (siteN <= 0) return [];
  const take = siteN + 20;
  const byTier: Record<Tier, MatchResult[]> = { bullseye: [], match: [], expansion: [] };
  const overflow: MatchResult[] = [];
  for (const result of out.results) {
    if (result.rejected) continue;
    if (result.overflow) overflow.push(result);
    else byTier[result.tier].push(result);
  }
  byTier.bullseye.push(...overflow);
  const ids = new Set<string>();
  for (const tier of Object.keys(byTier) as Tier[]) {
    byTier[tier].slice(0, take).forEach((result) => ids.add(result.f.id));
  }
  return db.firms.filter((firm) => ids.has(firm.id));
}

async function loadReviews(supabase: ServiceClient, clientId: string) {
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

async function loadHidden(supabase: ServiceClient) {
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

function asSavedView(value: unknown): MatchView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as MatchView;
  if (!view.ranAt || !Array.isArray(view.rows)) return null;
  return view;
}

/** The last saved match, without running the engine. Null when none has been stored. */
export async function loadStoredMatch(
  supabase: ServiceClient,
  clientId: string,
): Promise<{ view: MatchView; stale: boolean } | null> {
  const [{ data, error }, loaded] = await Promise.all([
    supabase.from("match_profiles").select("settings").eq("client_id", clientId).maybeSingle(),
    loadProfileState(supabase, clientId),
  ]);
  if (error || !data) return null;
  const settings =
    data.settings && typeof data.settings === "object"
      ? (data.settings as Record<string, unknown>)
      : null;
  const saved = settings?.last_match;
  if (!saved || typeof saved !== "object") return null;

  const current =
    loaded.ok && loaded.value ? matchBasis(loaded.value.answers, loaded.value.settings) : "";
  const record = saved as Record<string, unknown>;
  // Current shape: { view, basis }. An older blob is the view itself and has no basis.
  if ("view" in record) {
    const view = asSavedView(record.view);
    if (!view) return null;
    return { view, stale: record.basis !== current };
  }
  const view = asSavedView(saved);
  if (!view) return null;
  return { view, stale: true };
}

/** Remembers a run on the profile so the Match page can reopen it. */
export async function storeMatch(
  supabase: ServiceClient,
  clientId: string,
  view: MatchView,
) {
  const [{ data, error }, loaded] = await Promise.all([
    supabase.from("match_profiles").select("settings").eq("client_id", clientId).maybeSingle(),
    loadProfileState(supabase, clientId),
  ]);
  if (error || !data) return;
  const settings =
    data.settings && typeof data.settings === "object"
      ? (data.settings as Record<string, unknown>)
      : {};
  const storedView = view.ranAt ? view : { ...view, ranAt: new Date().toISOString() };
  const basis =
    loaded.ok && loaded.value ? matchBasis(loaded.value.answers, loaded.value.settings) : "";
  await supabase
    .from("match_profiles")
    .update({ settings: { ...settings, last_match: { view: storedView, basis } } })
    .eq("client_id", clientId);
}

/** Runs the engine for a client: live database, profile, reviews, websites. */
export async function runClientMatch(
  supabase: ServiceClient,
  clientId: string,
): Promise<Result<MatchRun>> {
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

  const rejected: Record<string, string> = {};
  loadedReviews.reviews.forEach((review, firmId) => {
    if (review.status === "no") rejected[firmId] = review.reason || "Rejected";
  });
  const suppressed: Record<string, string> = {};
  loadedHidden.hidden.forEach((item) => {
    suppressed[item.id] = item.reason || "Hidden for all clients";
  });

  const corrections = loadedCorrections.value;
  const decisions = loadedDecisions.value;
  const db = applyCorrections(live.value.db, corrections, decisions);
  let out = RME.run(db, profile, { suppressed, rejected });
  let sites: Record<string, SiteResult> = {};
  let checkedAt: Record<string, string> = {};
  if (profile.siteN > 0) {
    const candidates = siteCandidates(out, db, profile.siteN);
    const loadedSites = await loadSites(supabase, candidates);
    if (!loadedSites.ok) return loadedSites;
    sites = loadedSites.sites;
    checkedAt = loadedSites.checkedAt;
    out = RME.run(db, profile, { suppressed, rejected, sites });
  }

  const loadedChecks = await loadChecksForFirms(
    supabase,
    out.results.map((result) => result.f.id),
  );
  if (!loadedChecks.ok) return loadedChecks;

  return {
    ok: true,
    value: {
      live: live.value,
      state,
      profile,
      out,
      reviews: loadedReviews.reviews,
      hidden: loadedHidden.hidden,
      sites,
      checkedAt,
      corrections,
      decisions,
      checks: loadedChecks.value,
    },
  };
}

// ---------------------------------------------------------------------------
// View for the Match page

function brief(run: MatchRun, contact: RankedContact | undefined): ContactBrief | null {
  if (!contact) return null;
  return {
    name: personNameOf(contact),
    title: contact.title,
    role: contact.roleLabel,
    verify: verifyStateOf(run, contact),
    verifiedAt: verifiedAtOf(run, contact),
  };
}

function hqOf(result: MatchResult) {
  const firm = result.f;
  return [firm.city, firm.country === "United States" ? firm.state : firm.country]
    .filter(Boolean)
    .join(", ");
}

function siteState(result: MatchResult): SiteState | null {
  return result.site ? (result.site.st as SiteState) : null;
}

/** The engine can add the same flag twice (database and website check). */
function uniqueFlags(flags: Flag[]) {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    if (seen.has(flag.text)) return false;
    seen.add(flag.text);
    return true;
  });
}

function toRow(run: MatchRun, result: MatchResult): FirmRow {
  const flags = uniqueFlags(result.A.flags);
  return {
    id: result.f.id,
    name: result.f.name,
    type: firmTypeLabel(result.f.type),
    hq: hqOf(result),
    loc: result.loc,
    year: result.f.year,
    web: websiteHref(result.f.web),
    people: investingPeople(result),
    tier: result.tier,
    overflow: Boolean(result.overflow),
    score: result.score,
    stage: result.st.s,
    sector: result.se.s,
    geo: result.ge.s,
    conf: result.A.confLabel,
    confValue: result.A.conf,
    pros: result.pros.slice(0, 3),
    con: result.cons[0] ?? null,
    highFlags: flags.filter((flag) => flag.sev === "high").map((flag) => flag.text),
    flagCount: flags.length,
    site: siteState(result),
    near: result.nearPeople,
    primary: brief(run, result.seq[0]),
    backup: brief(run, result.seq[1]),
    rejected: Boolean(result.rejected),
    review: run.reviews.get(result.f.id) ?? null,
  };
}

function countBy<T>(items: T[], key: (item: T) => string, limit?: number): Count[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  const sorted = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  if (!limit || sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit).reduce((sum, item) => sum + item.count, 0);
  return [...sorted.slice(0, limit), { label: "Other", count: rest }];
}

function fitBand(score: number) {
  if (score >= 90) return "90+";
  if (score >= 80) return "80–89";
  if (score >= 70) return "70–79";
  return "Under 70";
}

function inOrder(counts: Count[], order: string[]): Count[] {
  return order.map((label) => ({
    label,
    count: counts.find((item) => item.label === label)?.count ?? 0,
  }));
}

function geoLabel(profile: MatchProfile) {
  if (profile.country === "United States") {
    return profile.usRegion ? `US · ${profile.usRegion}` : "the US";
  }
  return profile.country;
}

function coreSector(profile: MatchProfile) {
  return profile.verticals[0] || profile.industries[0] || "your sector";
}

function n(value: number) {
  return value.toLocaleString("en-US");
}

function replyText(run: MatchRun) {
  const { out, profile } = run;
  const inTier = out.counts.bullseye + out.counts.match + out.counts.expansion;
  return [
    `Quick numbers for ${profile.name || "you"}: our database covers ${n(out.funnel.total)} funds.`,
    `${n(out.funnel.stage)} invest at or next to ${profile.stage}, ${n(out.funnel.sector)} of those have a link to ${coreSector(profile)}, and ${n(out.funnel.geo)} cover ${geoLabel(profile)}.`,
    `After our quality checks, ${n(inTier)} are a fit: ${n(out.counts.bullseye)} in the first wave, ${n(out.counts.match)} strong fits and ${n(out.counts.expansion)} worth approaching later, with ${n(peopleIdentified(out))} named investors across them.`,
  ].join(" ");
}

function peopleIdentified(out: RunOutput) {
  return out.results
    .filter((result) => !result.rejected)
    .reduce((sum, result) => sum + investingPeople(result), 0);
}

function tierSummary(run: MatchRun, tier: Tier, rows: FirmRow[]): TierSummary {
  const { out, profile } = run;
  const level = profile.tune[tier];
  const inTier = rows.filter((row) => row.tier === tier);
  const live = inTier.filter((row) => !row.rejected);
  const siteStats = Object.entries(out.siteStats[tier] ?? {})
    .map(([status, count]) => ({ label: SITE_LABEL[status as SiteState] ?? status, count }))
    .sort((a, b) => b.count - a.count);
  return {
    key: tier,
    count: out.counts[tier],
    level,
    rules: RME.rulesText(tier, level, profile),
    byType: countBy(live, (row) => row.type),
    byHq: countBy(live, (row) => row.loc, 8),
    fitBands: inOrder(countBy(live, (row) => fitBand(row.score)), ["90+", "80–89", "70–79", "Under 70"]),
    confBands: inOrder(countBy(live, (row) => row.conf), ["High", "Medium", "Low"]),
    siteStats,
    deadRemoved: out.deadRemoved
      .filter((result) => result.tier === tier)
      .map((result) => ({
        id: result.f.id,
        name: result.f.name,
        why: result.site && "why" in result.site ? result.site.why ?? "" : "",
      })),
    audit: {
      total: inTier.length,
      approved: inTier.filter((row) => row.review?.status === "ok").length,
      rejected: inTier.filter((row) => row.review?.status === "no").length,
    },
  };
}

export function buildView(run: MatchRun): MatchView {
  const { out, profile, live } = run;
  const rows = out.results.map((result) => toRow(run, result));
  const inTier = out.counts.bullseye + out.counts.match + out.counts.expansion;
  const core = coreSector(profile);
  const notes = [
    out.funnel.excluded ? `${n(out.funnel.excluded)} excluded by the client's list` : "",
    out.funnel.suppressed ? `${n(out.funnel.suppressed)} hidden for all clients` : "",
    out.funnel.rejected ? `${n(out.funnel.rejected)} rejected for this client` : "",
    out.funnel.deadSite ? `${n(out.funnel.deadSite)} dropped for dead websites` : "",
  ].filter(Boolean);

  return {
    ranAt: new Date().toISOString(),
    database: {
      label: live.version.fileName,
      firms: live.db.firms.length,
      contacts: live.db.contacts.length,
    },
    header: [profile.name || "Client", profile.stage, core, geoLabel(profile)].join(" · "),
    people: peopleIdentified(out),
    counts: out.counts,
    qualifiedBullseye: out.qualifiedBullseye,
    wave: out.wave,
    funnel: [
      { label: "All funds in the database", count: out.funnel.total },
      { label: "Investor type fits", count: out.funnel.type },
      { label: "Instrument fits", count: out.funnel.instrument },
      { label: `Invests at or next to ${profile.stage}`, count: out.funnel.stage },
      { label: `Sector link to ${core}`, count: out.funnel.sector },
      { label: `Covers ${geoLabel(profile)}`, count: out.funnel.geo },
      { label: "After quality filters", count: out.funnel.geo - out.funnel.filtered },
      { label: "In a tier", count: inTier },
    ],
    funnelNotes: notes,
    tiers: {
      bullseye: tierSummary(run, "bullseye", rows),
      match: tierSummary(run, "match", rows),
      expansion: tierSummary(run, "expansion", rows),
    },
    rows,
    reply: replyText(run),
    fewBullseye: out.counts.bullseye < 20,
    hidden: run.hidden,
    siteN: out.siteN,
    unmatchedExclusions: unmatchedExclusionEntries(profile.exclusions, live.db.firms),
  };
}

// ---------------------------------------------------------------------------
// Firm detail

const FIT_MAX: Record<string, number> = {
  Stage: 20,
  Sector: 20,
  Geography: 14,
  "Thesis focus": 16,
  "Stage focus": 6,
  "Team near you": 6,
  "Reachable decision maker": 6,
  "Fund freshness": 6,
  "Vertical + industry": 6,
};

function contactOf(run: MatchRun, contact: RankedContact): FirmContact {
  return {
    id: rankedContactId(contact),
    name: personNameOf(contact),
    title: contact.title,
    role: contact.roleLabel,
    email: contact.email,
    phone: contact.phone,
    location: [contact.city, contact.country].filter(Boolean).join(", "),
    seq: null,
    why: contact.why,
    verify: verifyStateOf(run, contact),
    verifiedAt: verifiedAtOf(run, contact),
  };
}

export function buildDetail(run: MatchRun, firmId: string): FirmDetail | null {
  const result = run.out.results.find((item) => item.f.id === firmId);
  if (!result) return null;
  const firm = result.f;
  const sequence = new Map(result.seq.map((contact) => [rankedContactId(contact), contact.seq ?? null]));
  const site = run.sites[firm.id];
  return {
    row: toRow(run, result),
    why: result.why,
    pros: result.pros,
    cons: result.cons,
    verify: result.verify,
    flags: uniqueFlags(result.A.flags),
    fitParts: Object.entries(result.fit.parts).map(([label, value]) => ({
      label,
      value: Math.round(value * 10) / 10,
      max: FIT_MAX[label] ?? 6,
    })),
    checks: result.A.checks,
    site: site ? { ...site, url: firm.web } : null,
    siteState: siteState(result),
    firm: {
      website: firm.web,
      email: firm.email,
      phone: firm.phone,
      stages: firm.stages,
      verticals: firm.vert,
      industries: firm.ind,
      geography: firm.geo,
      offices: firm.offices.map((office) =>
        [office.city, office.country].filter(Boolean).join(", ") + (office.type ? ` (${office.type})` : ""),
      ),
    },
    contacts: result.ranked.map((contact) => {
      const item = contactOf(run, contact);
      return { ...item, seq: sequence.get(item.id) ?? null };
    }),
  };
}

// ---------------------------------------------------------------------------
// What goes to the client: funds and counts, never people

export const CLIENT_LIST_MAX = 3000;

const VC_LADDER = [
  "Pre-Seed",
  "Seed",
  "Series A",
  "Series B",
  "Series C and Beyond",
  "Growth Equity",
];

/** The stages a fund lists, as "Seed" or "Seed–Series A" when they sit next to each other. */
function stageRange(stages: string[]) {
  const listed = stages.map((stage) => stage.trim()).filter(Boolean);
  const ordered = VC_LADDER.filter((stage) => listed.includes(stage));
  const extra = listed.filter((stage) => !VC_LADDER.includes(stage));
  if (ordered.length >= 2 && extra.length === 0) {
    const indexes = ordered.map((stage) => VC_LADDER.indexOf(stage));
    const contiguous = indexes.every((index, i) => i === 0 || index === indexes[i - 1] + 1);
    if (contiguous) return `${ordered[0]}–${ordered[ordered.length - 1]}`;
  }
  const names = [...ordered, ...extra];
  return names.slice(0, 4).join(", ");
}

/** Up to 4 chips naming the values that matched. Not the generic why sentence. */
function fitReasons(result: MatchResult, stage: string) {
  const chips: string[] = [];
  if (result.st.s >= 1) {
    const label = stageRange(result.f.stages) || stage;
    if (label) chips.push(`Stage: ${label}`);
  }
  const sector = [...result.se.vMatch, ...result.se.iMatch].map((item) => item.trim()).filter(Boolean);
  if (sector.length > 0) chips.push(`Sector: ${sector.join(", ")}`);
  if (result.ge.s >= 0.8 && result.ge.how) {
    const how = result.ge.how;
    const geo = /across the US/i.test(how)
      ? "US-wide"
      : how.replace(/^invests in /i, "").replace(/^covers /i, "");
    if (geo) chips.push(`Geo: ${geo}`);
  }
  return chips.slice(0, 4);
}

export function buildClientList(run: MatchRun): Result<InvestorListPayload> {
  const kept = run.out.results.filter((result) => !result.rejected);
  if (kept.length === 0) return { ok: false, error: "No funds in the tiers to send." };
  if (kept.length > CLIENT_LIST_MAX) {
    return {
      ok: false,
      error: `${n(kept.length)} funds is more than the investor list holds (${n(CLIENT_LIST_MAX)}). Tighten Match or Expansion first.`,
    };
  }

  const rows: InvestorRow[] = kept.map((result) => {
    const people = investingPeople(result);
    const firm = result.f;
    const location = [firm.city, firm.country === "United States" ? firm.state : firm.country]
      .filter(Boolean)
      .join(", ");
    const checkSize =
      result.site && "check" in result.site && result.site.check ? String(result.site.check).trim() : "";
    const stages = firm.stages.filter(Boolean).slice(0, 4).join(", ");
    const reasons = fitReasons(result, run.profile.stage);
    const generic = /right stage, your core sector, your geography, and a focused thesis/i.test(result.why);
    return {
      id: firm.id.trim().slice(0, 200),
      fund_name: firm.name,
      contact:
        people > 0
          ? `${people} investing contact${people === 1 ? "" : "s"} identified`
          : "Contacts being confirmed",
      contact_count: people,
      details: [firmTypeLabel(firm.type), hqOf(result), firm.year ? `Founded ${firm.year}` : ""]
        .filter(Boolean)
        .join(" · "),
      fund_type: firmTypeLabel(firm.type),
      location: location || undefined,
      check_size: checkSize || undefined,
      stage_focus: stages || undefined,
      website: websiteHref(firm.web) || undefined,
      tier: TIER_TO_FIT[result.tier],
      why: generic ? "" : dropSectorFocus(result.why),
      reasons: reasons.length > 0 ? reasons : undefined,
      comments: result.overflow ? "Bullseye-grade; planned for the second wave." : "",
    };
  });

  const summary: InvestorListSummary = {
    generated_at: new Date().toISOString(),
    tiers: TIERS.map(({ key }) => {
      const inTier = kept.filter((result) => result.tier === key);
      const types = new Map<string, { funds: number; contacts: number }>();
      for (const result of inTier) {
        const label = firmTypeLabel(result.f.type);
        const entry = types.get(label) ?? { funds: 0, contacts: 0 };
        entry.funds += 1;
        entry.contacts += investingPeople(result);
        types.set(label, entry);
      }
      return {
        tier: TIER_TO_FIT[key],
        funds: inTier.length,
        contacts: inTier.reduce((sum, result) => sum + investingPeople(result), 0),
        by_type: Array.from(types.entries())
          .map(([label, value]) => ({ label, ...value }))
          .sort((a, b) => b.funds - a.funds),
      };
    }),
  };

  return {
    ok: true,
    value: {
      rows,
      source_file: `Rupert Match · ${new Date().toISOString().slice(0, 10)}`,
      summary,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal export rows (admin only)

/** Statuses the default export leaves out, unless kept for this client. */
const KNOWN_PROBLEMS = new Set<VerifyState>(["email_bad", "left_firm", "role_changed", "not_found"]);

/**
 * Contacts the default export keeps: everyone except known problems (Email
 * bad, Left firm, Role changed, Not found) that weren't kept for this client.
 * Not-yet-checked contacts stay in, marked "Not verified".
 */
function exportable(run: MatchRun, contact: RankedContact) {
  if (!KNOWN_PROBLEMS.has(verifyStateOf(run, contact))) return true;
  return run.decisions.get(rankedContactId(contact))?.decision === "keep";
}

function verifyText(run: MatchRun, contact: RankedContact) {
  const state = verifyStateOf(run, contact);
  const kept = state !== "clean" && run.decisions.get(rankedContactId(contact))?.decision === "keep";
  return VERIFY_LABEL[state] + (kept ? " (kept)" : "");
}

/**
 * Internal workbook rows. By default contacts with a known problem are left
 * out (see exportable); `includeAll` lists everyone.
 */
export function exportRows(run: MatchRun, { includeAll = false }: { includeAll?: boolean } = {}) {
  const { out, profile } = run;
  const summary: (string | number)[][] = [
    ["Client", profile.name],
    ["Stage", profile.stage],
    ["Raising", profile.raise],
    ["Verticals", profile.verticals.join(", ")],
    ["Industries", profile.industries.join(", ")],
    ["HQ", [profile.city, profile.usRegion, profile.country].filter(Boolean).join(", ")],
    ["Fund Database", run.live.version.fileName],
    ["Exported", new Date().toISOString().slice(0, 16).replace("T", " ")],
    [
      "Contacts",
      includeAll
        ? "Everyone (verified or not)"
        : "Everyone except known problems (Email bad, Left firm, Role changed, Not found) not kept",
    ],
    [],
    ["Tier", "Funds", "Tightness", "Rules"],
    ...TIERS.map(({ key, label }) => [
      label,
      out.counts[key],
      LEVEL_LABEL[profile.tune[key]],
      RME.rulesText(key, profile.tune[key], profile).join("; "),
    ]),
    [],
    ["Not in the database: check size, fund size, last deal date, portfolio conflicts. Verify before sending."],
  ];

  const outreachHeader = [
    "Tier", "Rank", "Fit", "Data confidence", "Review", "Review note", "Firm",
    "Firm type", "Firm HQ", "Website", "Firm email", "Sequence", "Name", "Title",
    "Role", "Email", "Phone", "Person city", "Verification", "Why this tier", "Fit reasons",
    "Watch-outs", "Verify", "Website check", "Website title", "Stated check size",
  ];
  const peopleHeader = [
    "Tier", "Firm", "Firm type", "Name", "Title", "Role", "Email", "Phone",
    "City", "Country", "Score", "Verification",
  ];
  const outreach: (string | number)[][] = [outreachHeader];
  const people: (string | number)[][] = [peopleHeader];
  const rank: Record<Tier, number> = { bullseye: 0, match: 0, expansion: 0 };
  let leftOut = 0;
  const listed = out.results.filter((result) => !result.rejected);
  const keep = firmsToKeep(
    listed.map((result) => ({
      id: result.f.id,
      web: result.f.web,
      contacts: investingPeople(result),
    })),
  );
  const seenOutreach = new Set<string>();
  const seenPeople = new Set<string>();
  let firmsRemoved = 0;
  let emailsSkipped = 0;

  for (const result of listed) {
    if (!keep.has(result.f.id)) {
      firmsRemoved += 1;
      continue;
    }
    rank[result.tier] += 1;
    const review = run.reviews.get(result.f.id);
    const tierLabel = TIERS.find((tier) => tier.key === result.tier)?.label ?? result.tier;
    const site = run.sites[result.f.id];
    const flags = uniqueFlags(result.A.flags).map((flag) => flag.text);
    const base = [
      tierLabel + (result.overflow ? " (wave 2)" : ""),
      rank[result.tier],
      result.score,
      result.A.confLabel,
      review ? (review.status === "ok" ? "Approved" : "Rejected") : "",
      review?.note ?? "",
      result.f.name,
      firmTypeLabel(result.f.type),
      hqOf(result),
      result.f.web,
      result.f.email,
    ];
    const tail = [
      result.why,
      result.pros.join("; "),
      [...result.cons, ...flags].join("; "),
      result.verify.join("; "),
      site ? SITE_LABEL[site.st] : "",
      site?.title ?? "",
      site?.check ?? "",
    ];
    const kept = result.seq.filter((contact) => includeAll || exportable(run, contact));
    leftOut += result.seq.length - kept.length;
    const sequence = kept.length > 0 ? kept : [undefined];
    for (const contact of sequence) {
      const key = outreachEmailKey(contact?.email ?? "");
      if (key && seenOutreach.has(key)) {
        emailsSkipped += 1;
        continue;
      }
      if (key) seenOutreach.add(key);
      outreach.push([
        ...base,
        contact?.seq ?? "",
        contact ? personNameOf(contact) : "",
        contact?.title ?? "",
        contact?.roleLabel ?? "",
        contact?.email ?? "",
        contact?.phone ?? "",
        contact?.city ?? "",
        contact ? verifyText(run, contact) : result.seq.length > 0 ? "No verified contact" : "",
        ...tail,
      ]);
    }
    for (const contact of result.ranked) {
      if (contact.role === "ops") continue;
      if (!includeAll && !exportable(run, contact)) continue;
      const key = outreachEmailKey(contact.email);
      if (key && seenPeople.has(key)) continue;
      if (key) seenPeople.add(key);
      people.push([
        tierLabel,
        result.f.name,
        firmTypeLabel(result.f.type),
        personNameOf(contact),
        contact.title,
        contact.roleLabel,
        contact.email,
        contact.phone,
        contact.city,
        contact.country,
        contact.score,
        verifyText(run, contact),
      ]);
    }
  }

  if (!includeAll) {
    summary.push(
      [],
      [
        leftOut > 0
          ? `${n(leftOut)} Primary/Backup contacts left out: a known problem without a Keep decision. Use Export everything to include them.`
          : "No Primary/Backup contact has a known problem.",
      ],
    );
  }
  if (firmsRemoved > 0 || emailsSkipped > 0) {
    summary.push(
      [],
      [
        `${n(firmsRemoved)} fund${firmsRemoved === 1 ? "" : "s"} left out of outreach because ${firmsRemoved === 1 ? "it shares" : "they share"} a website with another fund on the list. ${n(emailsSkipped)} repeated email${emailsSkipped === 1 ? "" : "s"} left out.`,
      ],
    );
  }

  return { summary, outreach, people };
}
