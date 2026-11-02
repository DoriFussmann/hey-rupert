// Step 2C: each confirmed investor checked against the Fund Database and the
// Step 1 shortlist. Pure module: matching an investor to Fund Database
// records, the Step 1 filter that removed a fund, and the buckets.

import { DRY_STEP_LABEL, passes, type DryData, type DryFund, type DryStep } from "../dry/core.ts";
import { investorKey, type Investor } from "./investors.ts";

export type DbFirm = { id: string; name: string; web: string };

/**
 * How an investor matched the Fund Database:
 * - website: the same website domain (one record).
 * - name: the same name, suffixes aside (one record).
 * - ambiguous: the same name or website as more than one record.
 * - similar: no exact match, but a record's name contains the investor's (or the reverse).
 * - none: nothing.
 */
export type MatchHow = "website" | "name" | "ambiguous" | "similar" | "none";

export type FirmMatch = { how: MatchHow; firmIds: string[] };

export function domainOf(url: string) {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

export type FirmIndex = { byDomain: Map<string, string[]>; byKey: Map<string, string[]>; keys: [string, string][] };

export function indexFirms(firms: DbFirm[]): FirmIndex {
  const byDomain = new Map<string, string[]>();
  const byKey = new Map<string, string[]>();
  const keys: [string, string][] = [];
  const add = (map: Map<string, string[]>, k: string, id: string) => {
    if (!k) return;
    const list = map.get(k);
    if (list) {
      if (!list.includes(id)) list.push(id);
    } else map.set(k, [id]);
  };
  for (const firm of firms) {
    add(byDomain, domainOf(firm.web), firm.id);
    const k = investorKey(firm.name);
    add(byKey, k, firm.id);
    if (k) keys.push([k, firm.id]);
  }
  return { byDomain, byKey, keys };
}

/** A name match settles automatically only from 4 characters. */
const SHORT_KEY = 4;
/** Similar names only count from 5 characters, so short keys don't match everything. */
const SIMILAR_MIN = 5;

export function matchInvestor(inv: Pick<Investor, "name" | "website">, index: FirmIndex): FirmMatch {
  const domain = inv.website ? domainOf(inv.website) : "";
  const byDomain = domain ? index.byDomain.get(domain) ?? [] : [];
  if (byDomain.length === 1) return { how: "website", firmIds: byDomain };
  const key = investorKey(inv.name);
  const byKey = key ? index.byKey.get(key) ?? [] : [];
  if (byDomain.length > 1 || byKey.length > 1) {
    return { how: "ambiguous", firmIds: Array.from(new Set([...byDomain, ...byKey])) };
  }
  // A very short name key (most of the name was "Capital", "Ventures"…) is too weak to settle on its own.
  if (byKey.length === 1) return key.length >= SHORT_KEY ? { how: "name", firmIds: byKey } : { how: "similar", firmIds: byKey };
  if (key.length >= SIMILAR_MIN) {
    const similar = index.keys.filter(([k]) => k.length >= SIMILAR_MIN && k !== key && (k.includes(key) || key.includes(k))).map(([, id]) => id);
    const unique = Array.from(new Set(similar)).slice(0, 5);
    if (unique.length) return { how: "similar", firmIds: unique };
  }
  return { how: "none", firmIds: [] };
}

export type SavedStepChoice = { step: DryStep; chosen: string[] };

/** The first Step 1 filter a fund fails, with the fund's own values for it. Null when it passes them all. */
export function firstFailure(data: DryData, fund: DryFund, steps: SavedStepChoice[]) {
  for (const s of steps) {
    if (passes(data, fund, s.step, s.chosen)) continue;
    return { step: s.step, label: DRY_STEP_LABEL[s.step], fundValues: fundValues(data, fund, s.step) };
  }
  return null;
}

export function fundValues(data: DryData, fund: DryFund, step: DryStep): string {
  const list = (options: { label: string }[], at: number[]) => at.map((i) => options[i]?.label ?? "").filter(Boolean).join(", ");
  switch (step) {
    case "financing":
      return list(data.options.financing, fund.fin) || "none stated";
    case "stage":
      return list(data.options.stage, fund.stage) || "none stated";
    case "geography":
      return fund.geo.map((i) => data.labels.geo[i]).join(", ") || "none stated";
    case "sector":
      return fund.sector.map((i) => data.labels.sector[i]).join(", ") || "none stated";
  }
}

/** The admin's decision on one investor. */
export type InvestorDecision = {
  /** The Fund Database record it is, chosen by the admin; null: it is not in the database. Absent: the automatic match stands. */
  firmId?: string | null;
  /** For a fund in the database but not in the shortlist. */
  action?: "bring_back" | "leave_out";
  /** Parked for later: out of the queue, back in the "Not sure" pile. Any real decision clears it. */
  unsure?: boolean;
  /** The investor's correct website, from the admin's research. Matching uses it. */
  website?: string;
  /** Why, and whether it is a lesson for Rupert (the database or the taxonomy needs fixing), not just this client. */
  note?: string;
  lesson?: boolean;
  by: string | null;
  at: string;
};

/** A website found for an investor by Find websites, for the admin to accept. */
export type WebsiteSuggestion = {
  website: string;
  confidence: "high" | "medium" | "low";
  foundIn: string;
  portfolioUrl: string;
  note: string;
  link: "live" | "broken" | "unchecked";
  at: string;
};

export type Bucket = "confirm" | "in_list" | "not_in_list" | "missing_fund" | "missing_angel" | "added";

export const BUCKET_LABEL: Record<Bucket, string> = {
  confirm: "Needs your confirmation",
  in_list: "In the database and the shortlist",
  not_in_list: "In the database, not in the shortlist",
  missing_fund: "Not in the database: funds",
  missing_angel: "Not in the database: angels",
  added: "Added to the database (Rupert)",
};

/** A fund added by Try and Add to DB, as the check shows it. */
export type AddedSummary = { id: string; firmId: string; status: "pending" | "approved" | "rejected"; contacts: number; website: string };

/** What happens to a fund in the database but not in the shortlist, unless the admin decides otherwise. */
export type Action = "bring_back" | "leave_out";

/**
 * The default. Removed only by the sector filter, it backed a direct
 * competitor: brought back only when it also lists one of the client's own
 * sectors (in practice its secondary sectors, since the primary failed),
 * by exact label. Otherwise, and when removed by stage, geography or
 * financing: left out.
 */
export function defaultAction(failure: { step: DryStep } | null, clientOverlap: string[] = []): Action {
  return failure?.step === "sector" && clientOverlap.length > 0 ? "bring_back" : "leave_out";
}

export type CheckRow = {
  investor: Investor;
  match: FirmMatch;
  /** The record it is, once settled (automatic or the admin's). */
  firmId: string | null;
  firmName: string | null;
  /** The record's website in the Fund Database. */
  firmWeb: string | null;
  bucket: Bucket;
  /** For not_in_list: the Step 1 filter that removed it. */
  failure: ReturnType<typeof firstFailure>;
  /** Candidate records to choose from, for confirm. */
  candidates: { id: string; name: string; web: string }[];
  decision: InvestorDecision | null;
  /** Marked "Not sure" by the admin: decide later. */
  unsure: boolean;
  /** For not_in_list: the action that applies (the admin's, or the default) and whether it is the default. */
  action: Action | null;
  defaulted: boolean;
  /** For a sector failure: the fund's sectors that are the client's (e.g. its secondary) or the competitors' it backed. */
  overlap: { client: string[]; competitor: string[] };
  /** When Try and Add to DB added it: the added fund. */
  added: AddedSummary | null;
  /** Find websites' suggestion, and the database record with that website, if exactly one. */
  suggestion: (WebsiteSuggestion & { firm: { id: string; name: string } | null; firmCount: number }) | null;
};

export function checkInvestors(input: {
  investors: Investor[];
  firms: DbFirm[];
  data: DryData;
  steps: SavedStepChoice[];
  shortlist: Set<string>;
  decisions: Record<string, InvestorDecision>;
  /** The client's sector labels (primary and secondary). */
  clientSectors?: string[];
  /** Each competitor's sector labels, by competitor id. */
  competitorSectors?: Record<string, string[]>;
  suggestions?: Record<string, WebsiteSuggestion>;
  /** Funds added from this landscape, by investor id (any status but rejected). */
  added?: Record<string, AddedSummary>;
}): CheckRow[] {
  const index = indexFirms(input.firms);
  const firmById = new Map(input.firms.map((f) => [f.id, f]));
  const fundById = new Map(input.data.funds.map((f) => [f.id, f]));
  return input.investors.map((original) => {
    const decision = input.decisions[original.id] ?? null;
    const investor = decision?.website ? { ...original, website: decision.website } : original;
    // The admin's website is their research: it alone decides (one record with it, or none).
    const byAdminSite = decision?.website ? index.byDomain.get(domainOf(decision.website)) ?? [] : null;
    const match: FirmMatch = byAdminSite
      ? byAdminSite.length === 1
        ? { how: "website", firmIds: byAdminSite }
        : byAdminSite.length > 1
          ? { how: "ambiguous", firmIds: byAdminSite }
          : { how: "none", firmIds: [] }
      : matchInvestor(investor, index);
    let firmId: string | null = null;
    let bucket: Bucket;
    if (decision && decision.firmId !== undefined) firmId = decision.firmId && firmById.has(decision.firmId) ? decision.firmId : null;
    else if (match.how === "website" || match.how === "name") firmId = match.firmIds[0];
    const settled = (decision && decision.firmId !== undefined) || match.how === "website" || match.how === "name" || match.how === "none";
    let failure: CheckRow["failure"] = null;
    let fundSectors: string[] = [];
    // Added by Rupert: its own group, whatever the matching says now. That covers the investor that was
    // added, and any other investor that matches a fund added for this client (e.g. a partner of it).
    const ownAdded = input.added?.[original.id] ?? null;
    const viaFirm = firmId ? Object.values(input.added ?? {}).find((a) => a.firmId === firmId && a.status !== "rejected") ?? null : null;
    const added = ownAdded && ownAdded.status !== "rejected" ? ownAdded : viaFirm;
    if (added && added.status !== "rejected") bucket = "added";
    else if (!settled) bucket = "confirm";
    else if (!firmId) bucket = investor.kind === "angel" ? "missing_angel" : "missing_fund";
    else if (input.shortlist.has(firmId)) bucket = "in_list";
    else {
      bucket = "not_in_list";
      const fund = fundById.get(firmId);
      failure = fund ? firstFailure(input.data, fund, input.steps) : null;
      fundSectors = fund ? fund.sector.map((i) => input.data.labels.sector[i]).filter(Boolean) : [];
    }
    const lower = (list: string[]) => new Set(list.map((x) => x.toLowerCase()));
    const clientSet = lower(input.clientSectors ?? []);
    const competitorSet = lower(investor.backed.flatMap((b) => input.competitorSectors?.[b.competitorId] ?? []));
    const overlap = {
      client: fundSectors.filter((x) => clientSet.has(x.toLowerCase())),
      competitor: fundSectors.filter((x) => competitorSet.has(x.toLowerCase())),
    };
    const action: Action | null = bucket === "not_in_list" ? decision?.action ?? defaultAction(failure, overlap.client) : null;
    return {
      investor,
      match,
      firmId,
      firmName: firmId ? firmById.get(firmId)?.name ?? null : null,
      firmWeb: firmId ? firmById.get(firmId)?.web || null : null,
      bucket,
      failure,
      candidates: match.firmIds.map((id) => firmById.get(id)).filter((f): f is DbFirm => !!f),
      decision,
      added: added ?? ownAdded,
      action,
      unsure: !!decision?.unsure && (bucket === "confirm" || (bucket === "not_in_list" && !decision?.action)),
      defaulted: bucket === "not_in_list" && !decision?.action,
      overlap,
      suggestion: (() => {
        const sug = input.suggestions?.[original.id];
        if (!sug?.website) return null;
        const ids = index.byDomain.get(domainOf(sug.website)) ?? [];
        const one = ids.length === 1 ? firmById.get(ids[0]) : undefined;
        return { ...sug, firm: one ? { id: one.id, name: one.name } : null, firmCount: ids.length };
      })(),
    };
  });
}
