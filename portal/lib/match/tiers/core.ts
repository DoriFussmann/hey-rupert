// Four-tier matching engine (Phase 3). Pure module: no server code, so it
// runs in tests and in the UI.
//
// For each firm, in order:
//   1–3  client exclusions and funds hidden for all clients (as today)
//   4    firm type (as today); 4a funds of funds need an approved exception
//   5    financing (as today)
//   6    stage: the firm must list the company's stage
//   7    geography: the firm's stated geography must cover the HQ
//   8    the optional filters (as today)
//   9    generalists: their own group, outside the tiers
//   10   possible duplicates: flagged only (Sprint 3A)
//   11   sector tier, from approved relationships only
// Then the website check of each tier's top funds (as today).
//
// Every firm ends with exactly one status, and every decision records the
// codes and values behind it. Nothing here is written by an AI.

import RME, {
  type Contact,
  type Firm,
  type Flag,
  type FundDb,
  type MatchProfile,
  type RankedContact,
  type SiteResult,
} from "../engine/index.mjs";
import type { MatchingProfile, ProfileIssue, Readiness } from "../../company-profile/core.ts";
import {
  GENERALIST_KIND,
  US_NODE,
  findAlias,
  mapFirm,
  type FieldKey,
  type FirmMapping,
  type FirmTag,
  type Relation,
  type TaxEdge,
  type TaxIndex,
} from "../../taxonomy/core.ts";

/** Recorded with every run. Change it whenever a rule below changes. */
export const RULES_VERSION = "tiers-2026-10.2";

export const TIER_KEYS = ["core", "sphere", "tier3", "tier4"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

export const TIER_INFO: Record<TierKey, { label: string; description: string }> = {
  core: { label: "Core", description: "Direct match to the company's primary sector." },
  sphere: {
    label: "Sphere",
    description: "Immediate adjacency to the primary sector, or a direct match to a secondary sector.",
  },
  tier3: {
    label: "Tier 3",
    description: "Broader adjacency to the primary sector, or immediate adjacency to a secondary sector.",
  },
  tier4: {
    label: "Tier 4",
    description: "Weak but defensible link to the primary sector, or broader adjacency to a secondary sector.",
  },
};

export type Status = "tiered" | "excluded" | "unresolved" | "generalist";

export const STATUS_LABEL: Record<Status, string> = {
  tiered: "In a tier",
  excluded: "Excluded",
  unresolved: "Unresolved",
  generalist: "Generalist",
};

export const REASONS = {
  // Excluded
  client_exclusion: { status: "excluded", label: "Client exclusion" },
  hidden_all: { status: "excluded", label: "Hidden for all clients" },
  firm_type_missing: { status: "excluded", label: "Firm type not stated" },
  firm_type_unrecognized: { status: "excluded", label: "Firm type not mapped" },
  firm_type_mismatch: { status: "excluded", label: "Firm type not wanted" },
  fof_no_exception: { status: "excluded", label: "Fund of funds (no direct-investment evidence)" },
  financing_missing: { status: "excluded", label: "Financing not stated" },
  financing_unrecognized: { status: "excluded", label: "Financing not mapped" },
  financing_mismatch: { status: "excluded", label: "Financing not offered" },
  stage_one_off: { status: "excluded", label: "One stage off" },
  stage_mismatch: { status: "excluded", label: "Stage not invested in" },
  geo_outside: { status: "excluded", label: "Outside stated geography" },
  filter_platform: { status: "excluded", label: "Filter: no platforms (8+ stages)" },
  filter_decision_maker: { status: "excluded", label: "Filter: needs a decision maker" },
  filter_email: { status: "excluded", label: "Filter: needs an email" },
  filter_founded: { status: "excluded", label: "Filter: founded after" },
  filter_confidence: { status: "excluded", label: "Filter: minimum data confidence" },
  filter_near: { status: "excluded", label: "Filter: team near you only" },
  sector_not_stated: { status: "excluded", label: "No sector stated" },
  no_sector_link: { status: "excluded", label: "No approved sector link" },
  dead_website: { status: "excluded", label: "Website dead, parked or not investing" },
  // Unresolved
  stage_not_stated: { status: "unresolved", label: "Stage not stated" },
  stage_ambiguous: { status: "unresolved", label: "Stage ambiguous" },
  geo_not_stated: { status: "unresolved", label: "Geography not stated" },
  geo_ambiguous: { status: "unresolved", label: "Geography ambiguous" },
  geo_office_only: { status: "unresolved", label: "Office/person location only" },
  geo_company_state_unknown: { status: "unresolved", label: "Company state unknown" },
  geo_us_other_regions: { status: "unresolved", label: "US focus stated as other regions only" },
  sector_ambiguous: { status: "unresolved", label: "Sector mapping under review" },
  // Generalist
  generalist: { status: "generalist", label: "Generalist" },
} as const satisfies Record<string, { status: Status; label: string }>;

export type ReasonCode = keyof typeof REASONS;
export const REASON_CODES = Object.keys(REASONS) as ReasonCode[];

/** Notes on a fund that don't change its status. */
export type NoteCode =
  | "geo_review_note"
  | "stage_review_note"
  | "possible_duplicate"
  | "fof_exception"
  | "client_rejected"
  | "linked_record_rejected";

export const NOTE_LABEL: Record<NoteCode, string> = {
  geo_review_note: "Some geography values are unmapped or under review",
  stage_review_note: "Some stage values are unmapped or under review",
  possible_duplicate: "Possible duplicate",
  fof_exception: "Fund of funds with an approved direct-investment exception",
  client_rejected: "Rejected for this client",
  linked_record_rejected: "A linked record of the same firm is rejected for this client: decide before outreach",
};

export type Check = { result: "pass" | "fail" | "unresolved"; detail: string };

export type SectorLink = {
  tier: TierKey;
  role: "primary" | "secondary";
  companySector: string;
  companySectorLabel: string;
  firmSector: string;
  firmSectorLabel: string;
  /** The firm's provider value behind its sector. */
  firmRaw: string;
  firmField: FieldKey;
  relation: "same" | Relation;
  edgeId: string | null;
  rationale: string;
};

export type DuplicateFlag = { groupKey: string; level: string; otherIds: string[] };

export type FofException = {
  firmId: string;
  status: "needs_review" | "approved" | "rejected";
  evidenceUrl: string;
  evidenceNote: string;
  rationale: string;
  reviewedBy: string | null;
};

export type ContactBrief = { name: string; title: string; role: string; seq: string };

/** An investing contact of a listed fund, as the export needs it. `fid` is the record it comes from. */
export type PersonRecord = {
  fid: string;
  /** Original email key: verification results and keep/remove decisions are stored under fid + key. */
  key: string;
  name: string;
  title: string;
  role: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  score: number;
  seq: string;
};

/**
 * Records of one firm shown once per list. "duplicate": the same record twice
 * in the provider data, applied only after an admin confirms it. "offices":
 * one firm's offices in different countries, applied unless an admin rejects it.
 */
export type IdentityGroup = {
  key: string;
  kind: "duplicate" | "offices";
  level: string;
  memberIds: string[];
  status: "confirmed" | "auto";
  decidedBy: string | null;
  decidedAt: string | null;
};

export type IdentityMember = {
  firmId: string;
  name: string;
  country: string;
  status: Status;
  tier: TierKey | null;
  reason: ReasonCode | null;
  score: number | null;
  contacts: number;
  rejected: string | null;
  checks: FirmOutcome["checks"];
};

export type IdentityDetail = {
  key: string;
  kind: IdentityGroup["kind"];
  level: string;
  status: IdentityGroup["status"];
  decidedBy: string | null;
  decidedAt: string | null;
  /** How the shown record was chosen, in words. */
  derivation: string;
  members: IdentityMember[];
};

export const IDENTITY_RULE =
  "The record with the strongest outcome is shown (Core, Sphere, Tier 3, Tier 4, then generalist, unresolved, excluded; a client rejection ranks below the same tier); ties go to the higher fit score, then more contacts, then the lower FirmID.";

export type FirmOutcome = {
  firmId: string;
  /** 1 for the first row with this FirmID in the Fund Database, 2 for a repeat, and so on. */
  occurrence: number;
  name: string;
  status: Status;
  tier: TierKey | null;
  /** Why the firm has this status; the first is the deciding one. Empty when tiered. */
  reasons: ReasonCode[];
  notes: NoteCode[];
  checks: Partial<Record<"firmType" | "financing" | "stage" | "geography" | "sector", Check>>;
  sector: SectorLink | null;
  /** The firm's approved sectors (funds that reached the sector step). */
  firmSectors: { id: string; label: string; raw: string }[];
  /** Labels of every approved sector the firm lists, for any status (reconciliation and audit). */
  sectorTags: string[];
  generalistWhy: string | null;
  score: number | null;
  fitParts: Record<string, number> | null;
  confidence: number | null;
  contacts: ContactBrief[];
  flags: Flag[];
  pros: string[];
  site: string | null;
  rejected: string | null;
  duplicate: DuplicateFlag | null;
  fof: FofException | null;
  /** Investing contacts (listed and generalist funds only). */
  people: PersonRecord[];
  /** The group this record belongs to, when it is the record shown for it. */
  identity: IdentityDetail | null;
  /** When another record of the same firm is shown instead: that record's FirmID. Not counted. */
  representedBy: string | null;
};

export type TierCounts = {
  firms: number;
  tiers: Record<TierKey, number>;
  /** Tiered funds rejected for this client (not counted in tiers). */
  rejected: number;
  generalists: number;
  excluded: number;
  unresolved: number;
  reasons: Partial<Record<ReasonCode, number>>;
  /** Funds listing "Fund of funds" next to another financing type: checked like any fund. */
  fofWithOtherFinancing: number;
  /** Records shown through another record of the same firm (not counted elsewhere). */
  represented: number;
  /** Identity groups applied: confirmed duplicates and office groups. */
  identityGroups: number;
};

/** A listed or generalist fund's Fund Database record and ranked contacts. In memory only; never stored. */
export type LiveFirm = { firm: Firm; ranked: RankedContact[]; seq: RankedContact[] };

export type TierRun = {
  rulesVersion: string;
  outcomes: FirmOutcome[];
  counts: TierCounts;
  warnings: string[];
  /** For verification: each fund that reached the contact step. Not part of the saved run. */
  live: Map<FirmOutcome, LiveFirm>;
};

export type TierRunInput = {
  db: FundDb;
  index: TaxIndex;
  profile: MatchingProfile;
  /** The current engine's profile: exclusions, filters, contacts and website settings. */
  legacy: MatchProfile;
  suppressed?: Record<string, string>;
  rejected?: Record<string, string>;
  sites?: Record<string, SiteResult> | null;
  fofExceptions?: Map<string, FofException>;
  duplicates?: Map<string, DuplicateFlag>;
  /** Groups to show once per list (confirmed duplicates; office groups not rejected). */
  identities?: IdentityGroup[];
};

export const FUND_OF_FUNDS = "financing.fund_of_funds";
const DEFAULT_FINANCING = "financing.equity";

// ---------------------------------------------------------------------------
// Profile readiness

const EFFECT: Record<string, string> = {
  "Primary sector": "affects the sector tiers",
  "Secondary sector": "affects the sector tiers",
  "Secondary sectors": "affects the sector tiers",
  Stage: "affects the stage check",
  "HQ country": "affects the geography check",
  "HQ state": "affects the US regional geography check",
};

/** Null when the profile can run; otherwise why not. */
export function blockedReason(readiness: Readiness, issues: ProfileIssue[]) {
  if (readiness !== "blocked") return null;
  const blocking = issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.message);
  return `The company profile is blocked: ${blocking.join(" ") || "fix the classification first."}`;
}

/** Every unresolved or unconfirmed point of a Limited profile, with the check it affects. */
export function profileWarnings(issues: ProfileIssue[]) {
  return issues
    .filter((issue) => issue.severity === "limited")
    .map((issue) => `${issue.field}: ${issue.message} (${EFFECT[issue.field] ?? "review before outreach"})`);
}

// ---------------------------------------------------------------------------
// Taxonomy helpers

/** Every node that contains `id`: its parents and extra regions (memberOf), recursively. */
export function containers(index: TaxIndex, id: string): Set<string> {
  const out = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const node = index.nodes.get(queue.shift()!);
    if (!node) continue;
    const memberOf = Array.isArray(node.attrs.memberOf) ? (node.attrs.memberOf as unknown[]) : [];
    for (const parent of [node.parentId, ...memberOf]) {
      if (typeof parent === "string" && !out.has(parent)) {
        out.add(parent);
        queue.push(parent);
      }
    }
  }
  return out;
}

function label(index: TaxIndex, id: string | null) {
  return id ? index.nodes.get(id)?.label ?? id : "";
}

const RELATION_RANK: ("same" | Relation)[] = ["same", "equivalent", "immediate", "broad", "weak"];

/** The closest approved relationship from the company's sector to the firm's. */
export function approvedRelation(
  index: TaxIndex,
  from: string,
  to: string,
): { relation: "same" | Relation; edge: TaxEdge | null } | null {
  if (from === to) return { relation: "same", edge: null };
  const edges = (index.edgesByNode.get(from) ?? []).filter(
    (edge) =>
      edge.review === "approved" &&
      ((edge.fromId === from && edge.toId === to) || (!edge.directed && edge.fromId === to && edge.toId === from)),
  );
  if (edges.length === 0) return null;
  const best = [...edges].sort(
    (a, b) => RELATION_RANK.indexOf(a.relation) - RELATION_RANK.indexOf(b.relation) || a.id.localeCompare(b.id),
  )[0];
  return { relation: best.relation, edge: best };
}

const PRIMARY_TIER: Record<"same" | Relation, TierKey> = {
  same: "core",
  equivalent: "core",
  immediate: "sphere",
  broad: "tier3",
  weak: "tier4",
};

const SECONDARY_TIER: Record<"same" | Relation, TierKey | null> = {
  same: "sphere",
  equivalent: "sphere",
  immediate: "tier3",
  broad: "tier4",
  weak: null,
};

/** The tier a relationship gives, from the primary or a secondary sector. */
export function tierFor(role: "primary" | "secondary", relation: "same" | Relation): TierKey | null {
  return role === "primary" ? PRIMARY_TIER[relation] : SECONDARY_TIER[relation];
}

function tagsOf(mapping: FirmMapping, field: FieldKey) {
  return mapping.tags.filter((tag) => tag.field === field);
}

function unrecognized(mapping: FirmMapping, fields: FieldKey[]) {
  return mapping.issues.some(
    (issue) => fields.includes(issue.field) && (issue.kind === "unmapped" || issue.kind === "broken"),
  );
}

function approvedIds(tags: FirmTag[]) {
  return new Set(tags.filter((tag) => tag.review === "approved").map((tag) => tag.nodeId));
}

function joinRaw(values: string[]) {
  return values.length ? values.join("; ") : "none";
}

// ---------------------------------------------------------------------------
// Checks

function firmTypeCheck(firm: Firm, mapping: FirmMapping, allowed: Set<string>, index: TaxIndex) {
  if (!firm.type) return { code: "firm_type_missing" as const, check: { result: "fail", detail: "No firm type stated." } as Check };
  const ids = approvedIds(tagsOf(mapping, "firm_type"));
  if (ids.size === 0) {
    return {
      code: "firm_type_unrecognized" as const,
      check: { result: "fail", detail: `"${firm.type}" has no approved firm-type mapping.` } as Check,
    };
  }
  const hit = Array.from(ids).find((id) => allowed.has(id));
  if (!hit) {
    return {
      code: "firm_type_mismatch" as const,
      check: {
        result: "fail",
        detail: `${label(index, Array.from(ids)[0])} is not one of: ${Array.from(allowed).map((id) => label(index, id)).join(", ")}.`,
      } as Check,
    };
  }
  return { code: null, check: { result: "pass", detail: label(index, hit) } as Check };
}

function financingCheck(firm: Firm, mapping: FirmMapping, wanted: Set<string>, index: TaxIndex) {
  if (firm.fin.length === 0) {
    return { code: "financing_missing" as const, check: { result: "fail", detail: "No financing stated." } as Check };
  }
  const ids = approvedIds(tagsOf(mapping, "financing"));
  const hit = Array.from(ids).find((id) => wanted.has(id));
  if (hit) return { code: null, check: { result: "pass", detail: label(index, hit) } as Check };
  if (ids.size === 0 || unrecognized(mapping, ["financing"])) {
    return {
      code: "financing_unrecognized" as const,
      check: { result: "fail", detail: `None of "${joinRaw(firm.fin)}" maps to ${Array.from(wanted).map((id) => label(index, id)).join(" or ")}; some values are not mapped.` } as Check,
    };
  }
  return {
    code: "financing_mismatch" as const,
    check: { result: "fail", detail: `Offers ${Array.from(ids).map((id) => label(index, id)).join(", ")}, not ${Array.from(wanted).map((id) => label(index, id)).join(" or ")}.` } as Check,
  };
}

function ladderOf(index: TaxIndex, id: string) {
  const value = index.nodes.get(id)?.attrs.ladder;
  return typeof value === "number" ? value : null;
}

type StageResult = { code: ReasonCode | null; check: Check; note: boolean };

export function stageCheck(firm: Firm, mapping: FirmMapping, stage: string, index: TaxIndex): StageResult {
  const name = label(index, stage);
  if (firm.stages.length === 0) {
    return { code: "stage_not_stated", check: { result: "unresolved", detail: "No stage stated." }, note: false };
  }
  const tags = tagsOf(mapping, "stage");
  const approved = approvedIds(tags);
  const unclear = unrecognized(mapping, ["stage"]) || tags.some((tag) => tag.review !== "approved");
  if (approved.has(stage)) {
    const raw = tags.find((tag) => tag.nodeId === stage)?.raw ?? name;
    return { code: null, check: { result: "pass", detail: `Lists ${name} ("${raw}").` }, note: unclear };
  }
  if (unclear) {
    return {
      code: "stage_ambiguous",
      check: { result: "unresolved", detail: `${name} not among the approved stages; some of "${joinRaw(firm.stages)}" are unmapped or under review.` },
      note: false,
    };
  }
  const ladder = ladderOf(index, stage);
  const near = ladder == null ? [] : Array.from(approved).filter((id) => {
    const other = ladderOf(index, id);
    return other != null && Math.abs(other - ladder) === 1;
  });
  if (near.length) {
    return {
      code: "stage_one_off",
      check: { result: "fail", detail: `Lists ${near.map((id) => label(index, id)).join(", ")}, not ${name}.` },
      note: false,
    };
  }
  return { code: "stage_mismatch", check: { result: "fail", detail: `Does not list ${name}: "${joinRaw(firm.stages)}".` }, note: false };
}

type GeoResult = { code: ReasonCode | null; check: Check; note: boolean; scope: "national" | "regional" | "us_regional" | null };

/** Whether the firm's raw country (office, contact) is the company's HQ country. */
function sameCountry(index: TaxIndex, raw: string, country: string) {
  if (!raw) return false;
  const alias = findAlias(index, "hq_country", raw);
  return !!alias && alias.review === "approved" && alias.nodeIds.includes(country);
}

export function geographyCheck(
  firm: Firm,
  mapping: FirmMapping,
  contacts: Contact[],
  country: string,
  state: string | null,
  index: TaxIndex,
): GeoResult {
  const tags = tagsOf(mapping, "geography");
  const approved = tags.filter((tag) => tag.review === "approved");
  const unclear = unrecognized(mapping, ["geography"]) || tags.some((tag) => tag.review !== "approved");
  const countryUp = containers(index, country);
  const stateUp = state ? containers(index, state) : new Set<string>();
  const countryName = label(index, country);

  let best: GeoResult | null = null;
  for (const tag of approved) {
    const id = tag.nodeId;
    let scope: GeoResult["scope"] = null;
    if (id === country) scope = "national";
    else if (countryUp.has(id)) scope = "regional";
    else if (state && (id === state || stateUp.has(id))) scope = "us_regional";
    if (!scope) continue;
    const rank = { national: 0, us_regional: 1, regional: 2 }[scope];
    const current = best?.scope ? { national: 0, us_regional: 1, regional: 2 }[best.scope] : 99;
    if (rank < current) {
      const what = scope === "national" ? `Invests across ${countryName}` : scope === "us_regional" ? `Invests in ${label(index, id)}, which contains ${label(index, state)}` : `Invests in ${label(index, id)}, which contains ${countryName}`;
      best = { code: null, check: { result: "pass", detail: `${what} ("${tag.raw}").` }, note: unclear, scope };
    }
  }
  if (best) return best;

  if (firm.geo.length === 0) {
    return { code: "geo_not_stated", check: { result: "unresolved", detail: "No investment geography stated." }, note: false, scope: null };
  }
  if (unclear) {
    return {
      code: "geo_ambiguous",
      check: { result: "unresolved", detail: `Nothing approved covers ${countryName}; some of "${joinRaw(firm.geo)}" are unmapped or under review.` },
      note: false,
      scope: null,
    };
  }
  if (approved.length === 0) {
    return { code: "geo_not_stated", check: { result: "unresolved", detail: `Only values with no geographic meaning: "${joinRaw(firm.geo)}".` }, note: false, scope: null };
  }
  if (country === US_NODE) {
    const regions = approved.filter((tag) => index.nodes.get(tag.nodeId)?.kind === "us_region");
    if (regions.length) {
      const names = regions.map((tag) => label(index, tag.nodeId)).join(", ");
      if (!state) {
        return {
          code: "geo_company_state_unknown",
          check: { result: "unresolved", detail: `The fund lists US regions (${names}) and the company's state is unknown.` },
          note: false,
          scope: null,
        };
      }
      return {
        code: "geo_us_other_regions",
        check: { result: "unresolved", detail: `US focus stated as ${names}; ${label(index, state)} is not in them.` },
        note: false,
        scope: null,
      };
    }
  }
  const office = firm.offices.find((o) => sameCountry(index, o.country, country));
  const person = contacts.find((c) => sameCountry(index, c.country, country));
  if (office || person) {
    return {
      code: "geo_office_only",
      check: {
        result: "unresolved",
        detail: `${office ? `Office in ${office.city || countryName}` : `Team member in ${person!.city || countryName}`}, but stated geography is "${joinRaw(firm.geo)}".`,
      },
      note: false,
      scope: null,
    };
  }
  return { code: "geo_outside", check: { result: "fail", detail: `Stated geography "${joinRaw(firm.geo)}" does not cover ${countryName}.` }, note: false, scope: null };
}

/** The firm's best tier from the company's primary and secondary sectors. */
export function sectorTier(
  index: TaxIndex,
  primary: string,
  secondaries: string[],
  firmSectorTags: FirmTag[],
): SectorLink | null {
  let best: SectorLink | null = null;
  const companies: { id: string; role: "primary" | "secondary" }[] = [
    { id: primary, role: "primary" },
    ...secondaries.map((id) => ({ id, role: "secondary" as const })),
  ];
  const sorted = [...firmSectorTags].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  for (const company of companies) {
    for (const tag of sorted) {
      const rel = approvedRelation(index, company.id, tag.nodeId);
      if (!rel) continue;
      const tier = tierFor(company.role, rel.relation);
      if (!tier) continue;
      const better =
        !best ||
        TIER_KEYS.indexOf(tier) < TIER_KEYS.indexOf(best.tier) ||
        (tier === best.tier && company.role === "primary" && best.role === "secondary") ||
        (tier === best.tier && company.role === best.role && RELATION_RANK.indexOf(rel.relation) < RELATION_RANK.indexOf(best.relation));
      if (better) {
        best = {
          tier,
          role: company.role,
          companySector: company.id,
          companySectorLabel: label(index, company.id),
          firmSector: tag.nodeId,
          firmSectorLabel: label(index, tag.nodeId),
          firmRaw: tag.raw,
          firmField: tag.field,
          relation: rel.relation,
          edgeId: rel.edge?.id ?? null,
          rationale: rel.edge?.rationale ?? "Same sector.",
        };
      }
    }
  }
  return best;
}

function sectorText(link: SectorLink) {
  const how =
    link.relation === "same"
      ? `direct match to the ${link.role} sector ${link.companySectorLabel}`
      : `${link.relation} relationship from the ${link.role} sector ${link.companySectorLabel} to ${link.firmSectorLabel}`;
  return `${TIER_INFO[link.tier].label}: ${how} (firm lists "${link.firmRaw}").`;
}

// ---------------------------------------------------------------------------
// Fit score: orders funds within a tier. Same parts and weights as the
// current engine's score, fed by the canonical checks.

function fitScore(input: {
  firm: Firm;
  link: SectorLink | null;
  geoScope: GeoResult["scope"];
  focus: number;
  bothFields: boolean;
  seq: RankedContact[];
  nearPeople: number;
  localPeople: number;
}) {
  const { firm, link, seq } = input;
  const stageFocus = firm.stages.length <= 2 ? 1 : firm.stages.length === 3 ? 0.7 : firm.stages.length <= 5 ? 0.4 : 0.1;
  const prox = input.nearPeople ? 1 : input.localPeople ? 0.5 : 0;
  const access = !seq.length ? 0 : ["decision", "champion"].includes(seq[0].role) ? (seq.length > 1 ? 1 : 0.8) : 0.5;
  const fresh = !firm.year ? 0.3 : firm.year >= 2020 ? 1 : firm.year >= 2015 ? 0.7 : firm.year >= 2008 ? 0.4 : 0.2;
  const parts: Record<string, number> = {
    Stage: 20,
    Sector: 20 * (link ? (link.role === "primary" ? 1 : 0.8) : 0),
    Geography: 14 * (input.geoScope === "regional" ? 0.8 : 1),
    "Thesis focus": 16 * input.focus,
    "Stage focus": 6 * stageFocus,
    "Team near you": 6 * prox,
    "Reachable decision maker": 6 * access,
    "Fund freshness": 6 * fresh,
    "Both sector fields": 6 * (input.bothFields ? 1 : 0),
  };
  const total = Math.min(100, Math.round(Object.values(parts).reduce((a, b) => a + b, 0)));
  return { total, parts };
}

function focusOf(index: TaxIndex, company: string[], firmSectors: string[]) {
  if (firmSectors.length === 0) return 0;
  let direct = 0;
  let related = 0;
  for (const sector of firmSectors) {
    const rels = company.map((c) => approvedRelation(index, c, sector)).filter(Boolean);
    if (rels.some((rel) => rel!.relation === "same" || rel!.relation === "equivalent")) direct += 1;
    else if (rels.length) related += 1;
  }
  return Math.min(1, (direct + 0.5 * related) / firmSectors.length);
}

// ---------------------------------------------------------------------------
// The run

function emptyOutcome(firm: Firm, occurrence: number): FirmOutcome {
  return {
    firmId: firm.id,
    occurrence,
    name: firm.name,
    status: "excluded",
    tier: null,
    reasons: [],
    notes: [],
    checks: {},
    sector: null,
    firmSectors: [],
    sectorTags: [],
    generalistWhy: null,
    score: null,
    fitParts: null,
    confidence: null,
    contacts: [],
    flags: [],
    pros: [],
    site: null,
    rejected: null,
    duplicate: null,
    fof: null,
    people: [],
    identity: null,
    representedBy: null,
  };
}

function personName(c: { prefix: string; first: string; last: string }) {
  return [c.prefix, c.first, c.last].filter(Boolean).join(" ").trim() || "(no name)";
}

function peopleOf(ranked: RankedContact[]): PersonRecord[] {
  return ranked
    .filter((c) => c.role !== "ops")
    .map((c) => ({
      fid: c.fid,
      key: (c as RankedContact & { key?: string }).key ?? c.email.trim().toLowerCase(),
      name: personName(c),
      title: c.title,
      role: c.roleLabel,
      email: c.email,
      phone: c.phone,
      city: c.city,
      country: c.country,
      score: c.score,
      seq: c.seq ?? "",
    }));
}

function briefsOf(seq: RankedContact[]): ContactBrief[] {
  return seq.map((c) => ({ name: personName(c), title: c.title, role: c.roleLabel, seq: c.seq ?? "" }));
}

/** Lower is stronger. */
function outcomeRank(o: FirmOutcome) {
  if (o.status === "tiered") return TIER_KEYS.indexOf(o.tier!) + (o.rejected ? 0.5 : 0);
  return o.status === "generalist" ? 10 : o.status === "unresolved" ? 11 : 12;
}

function placeText(o: FirmOutcome) {
  if (o.status === "tiered") return TIER_INFO[o.tier!].label + (o.rejected ? " (rejected for this client)" : "");
  return o.status === "excluded" || o.status === "unresolved"
    ? `${STATUS_LABEL[o.status]}: ${REASONS[o.reasons[o.reasons.length - 1]]?.label ?? ""}`
    : STATUS_LABEL[o.status];
}

function lc(value: string) {
  return value.trim().toLowerCase();
}

/** Firm types the company wants: chosen ones, else the current engine's defaults for the stage. */
export function allowedFirmTypes(index: TaxIndex, profile: MatchingProfile) {
  if (profile.firmTypes.length) return new Set(profile.firmTypes);
  const ids = RME.defaultTypes(label(index, profile.stage))
    .flatMap((raw) => findAlias(index, "firm_type", raw)?.nodeIds ?? []);
  return new Set(ids);
}

export function runTiers(input: TierRunInput): TierRun {
  const { db, index, profile, legacy } = input;
  if (!profile.primarySector || !profile.stage || !profile.hqCountry) {
    throw new Error("The profile needs a primary sector, a stage and an HQ country.");
  }
  const primary = profile.primarySector;
  const secondaries = profile.secondarySectors;
  const companySectors = [primary, ...secondaries];
  const stage = profile.stage;
  const country = profile.hqCountry;
  const state = country === US_NODE ? profile.hqState : null;
  const allowedTypes = allowedFirmTypes(index, profile);
  const wantedFinancing = new Set(profile.financing.length ? profile.financing : [DEFAULT_FINANCING]);
  const suppressed = input.suppressed ?? {};
  const rejected = input.rejected ?? {};
  const fofExceptions = input.fofExceptions ?? new Map<string, FofException>();
  const duplicates = input.duplicates ?? new Map<string, DuplicateFlag>();
  const filters = { noPlatforms: false, needDecision: false, needEmail: false, foundedAfter: 0, minConf: 0, nearOnly: false, ...(legacy.filters ?? {}) };
  const exclusions = RME.parseExclusions(legacy.exclusions);

  const contactsByFirm = new Map<string, Contact[]>();
  for (const contact of db.contacts) {
    const list = contactsByFirm.get(contact.fid);
    if (list) list.push(contact);
    else contactsByFirm.set(contact.fid, [contact]);
  }
  const nameCount = new Map<string, number>();
  for (const firm of db.firms) nameCount.set(lc(firm.name), (nameCount.get(lc(firm.name)) ?? 0) + 1);

  const outcomes: FirmOutcome[] = [];
  let fofWithOtherFinancing = 0;
  const sources = new Map<FirmOutcome, { firm: Firm; contacts: Contact[] }>();
  const live = new Map<FirmOutcome, LiveFirm>();

  const occurrences = new Map<string, number>();
  for (const firm of db.firms) {
    const occurrence = (occurrences.get(firm.id) ?? 0) + 1;
    occurrences.set(firm.id, occurrence);
    const out = emptyOutcome(firm, occurrence);
    outcomes.push(out);
    sources.set(out, { firm, contacts: contactsByFirm.get(firm.id) ?? [] });
    const stop = (code: ReasonCode) => {
      out.status = REASONS[code].status;
      out.reasons.push(code);
    };
    out.duplicate = duplicates.get(firm.id) ?? null;
    if (out.duplicate) out.notes.push("possible_duplicate");

    // 1–3. Client exclusions and funds hidden for all clients, as today.
    const name = lc(firm.name);
    const domain = RME.domainOf(firm.web);
    if (exclusions.some((term) => term === name || (domain && term === domain) || (term.length > 3 && name.includes(term)))) {
      stop("client_exclusion");
      continue;
    }
    if (suppressed[firm.id]) {
      stop("hidden_all");
      continue;
    }

    const mapping = mapFirm(firm, index);
    out.sectorTags = Array.from(
      new Set(
        mapping.tags
          .filter((tag) => tag.dimension === "sector" && tag.review === "approved")
          .map((tag) => label(index, tag.nodeId)),
      ),
    );

    // 4. Firm type.
    const type = firmTypeCheck(firm, mapping, allowedTypes, index);
    out.checks.firmType = type.check;
    if (type.code) {
      stop(type.code);
      continue;
    }

    // 4a. A fund whose only financing is "Fund of funds" needs an approved
    // exception. Listed next to another financing type, it is checked like any fund.
    const financingIds = approvedIds(tagsOf(mapping, "financing"));
    const fofOnly =
      financingIds.has(FUND_OF_FUNDS) &&
      Array.from(financingIds).every((id) => id === FUND_OF_FUNDS) &&
      !unrecognized(mapping, ["financing"]);
    if (financingIds.has(FUND_OF_FUNDS) && !fofOnly) fofWithOtherFinancing += 1;
    if (fofOnly) {
      const exception = fofExceptions.get(firm.id) ?? null;
      out.fof = exception;
      if (exception?.status !== "approved") {
        out.checks.financing = {
          result: "fail",
          detail: exception
            ? `Fund of funds; its direct-investment exception is ${exception.status === "rejected" ? "rejected" : "awaiting review"}.`
            : "Only financing is \"Fund of funds\", with no direct-investment exception.",
        };
        stop("fof_no_exception");
        continue;
      }
      out.notes.push("fof_exception");
    }

    // 5. Financing.
    const financing = financingCheck(firm, mapping, wantedFinancing, index);
    out.checks.financing = financing.check;
    if (financing.code) {
      stop(financing.code);
      continue;
    }

    // 6. Stage.
    const st = stageCheck(firm, mapping, stage, index);
    out.checks.stage = st.check;
    if (st.note) out.notes.push("stage_review_note");
    if (st.code) {
      stop(st.code);
      continue;
    }

    // 7. Geography.
    const fc = contactsByFirm.get(firm.id) ?? [];
    const geo = geographyCheck(firm, mapping, fc, country, state, index);
    out.checks.geography = geo.check;
    if (geo.note) out.notes.push("geo_review_note");
    if (geo.code) {
      stop(geo.code);
      continue;
    }

    // 8. The optional filters, as today.
    const ranked = RME.rankContacts(firm, fc, legacy);
    const seq = RME.pickSequence(ranked);
    const assessed = RME.assess(firm, fc, seq, (nameCount.get(name) ?? 0) > 1);
    const nearPeople = fc.filter((c) => RME.isNear(c, legacy)).length;
    const localPeople = fc.filter((c) => sameCountry(index, c.country, country)).length;
    out.confidence = assessed.conf;
    out.flags = assessed.flags;
    out.contacts = briefsOf(seq);
    out.people = peopleOf(ranked);
    live.set(out, { firm, ranked, seq });
    const filter: ReasonCode | null =
      filters.noPlatforms && firm.stages.length >= 8
        ? "filter_platform"
        : filters.needDecision && !(seq[0] && ["decision", "champion"].includes(seq[0].role))
          ? "filter_decision_maker"
          : filters.needEmail && !seq.length
            ? "filter_email"
            : filters.foundedAfter && !(firm.year && firm.year >= filters.foundedAfter)
              ? "filter_founded"
              : filters.minConf && assessed.conf < filters.minConf
                ? "filter_confidence"
                : filters.nearOnly && !nearPeople
                  ? "filter_near"
                  : null;
    if (filter) {
      stop(filter);
      continue;
    }

    // 9. Generalists: their own group.
    const sectorTags = mapping.tags.filter(
      (tag) => tag.dimension === "sector" && index.nodes.get(tag.nodeId)?.kind !== GENERALIST_KIND,
    );
    const approvedSectors = sectorTags.filter((tag) => tag.review === "approved");
    out.firmSectors = approvedSectors
      .filter((tag, i) => approvedSectors.findIndex((other) => other.nodeId === tag.nodeId) === i)
      .map((tag) => ({ id: tag.nodeId, label: label(index, tag.nodeId), raw: tag.raw }));
    const sectorIds = out.firmSectors.map((s) => s.id);
    const scoreWith = (link: SectorLink | null) => {
      const related = approvedSectors.filter((tag) =>
        companySectors.some((c) => approvedRelation(index, c, tag.nodeId)),
      );
      const fit = fitScore({
        firm,
        link,
        geoScope: geo.scope,
        focus: focusOf(index, companySectors, sectorIds),
        bothFields: related.some((t) => t.field === "industry") && related.some((t) => t.field === "vertical"),
        seq,
        nearPeople,
        localPeople,
      });
      out.score = fit.total;
      out.fitParts = fit.parts;
    };
    if (mapping.generalist) {
      out.generalistWhy = mapping.generalistWhy;
      out.checks.sector = { result: "unresolved", detail: `Generalist: ${mapping.generalistWhy}.` };
      scoreWith(null);
      stop("generalist");
      continue;
    }

    // 11. Sector tier from approved relationships.
    if (firm.ind.length === 0 && firm.vert.length === 0) {
      out.checks.sector = { result: "fail", detail: "No industry or vertical stated." };
      stop("sector_not_stated");
      continue;
    }
    const link = sectorTier(index, primary, secondaries, approvedSectors);
    if (!link) {
      const unclear = unrecognized(mapping, ["industry", "vertical"]) || sectorTags.some((tag) => tag.review !== "approved");
      out.checks.sector = {
        result: unclear ? "unresolved" : "fail",
        detail: unclear
          ? "No approved link from the approved sectors; some sector values are unmapped or under review."
          : `No approved relationship from ${companySectors.map((id) => label(index, id)).join(", ")} to ${out.firmSectors.map((s) => s.label).join(", ") || "its sectors"}.`,
      };
      stop(unclear ? "sector_ambiguous" : "no_sector_link");
      continue;
    }
    out.sector = link;
    out.checks.sector = { result: "pass", detail: sectorText(link) };
    out.status = "tiered";
    out.tier = link.tier;
    scoreWith(link);
    if (rejected[firm.id]) {
      out.rejected = rejected[firm.id];
      out.notes.push("client_rejected");
    }
  }

  // Identity groups: each record was checked on its own; the firm is shown once.
  let identityGroups = 0;
  const byFirm = new Map(outcomes.filter((o) => o.occurrence === 1).map((o) => [o.firmId, o]));
  for (const group of input.identities ?? []) {
    const members = group.memberIds.map((id) => byFirm.get(id)).filter((o): o is FirmOutcome => !!o);
    if (members.length < 2 || members.some((m) => m.representedBy || m.identity)) continue;
    identityGroups += 1;
    const contactCount = (o: FirmOutcome) => sources.get(o)?.contacts.length ?? 0;
    const sorted = [...members].sort(
      (a, b) =>
        outcomeRank(a) - outcomeRank(b) ||
        (b.score ?? -1) - (a.score ?? -1) ||
        contactCount(b) - contactCount(a) ||
        a.firmId.localeCompare(b.firmId),
    );
    const shown = sorted[0];
    const runnerUp = sorted[1];
    const why =
      outcomeRank(shown) < outcomeRank(runnerUp)
        ? `strongest outcome (${placeText(shown)}; next: ${runnerUp.firmId}, ${placeText(runnerUp)})`
        : (shown.score ?? -1) > (runnerUp.score ?? -1)
          ? `same outcome (${placeText(shown)}), higher fit score (${shown.score} vs ${runnerUp.score ?? "–"})`
          : contactCount(shown) > contactCount(runnerUp)
            ? `same outcome and score, more contacts (${contactCount(shown)} vs ${contactCount(runnerUp)})`
            : "same outcome, score and contacts; lower FirmID";
    const memberRows: IdentityMember[] = members.map((m) => ({
      firmId: m.firmId,
      name: m.name,
      country: sources.get(m)?.firm.country ?? "",
      status: m.status,
      tier: m.tier,
      reason: m.reasons[m.reasons.length - 1] ?? null,
      score: m.score,
      contacts: contactCount(m),
      rejected: m.rejected ?? rejected[m.firmId] ?? null,
      checks: m.checks,
    }));
    shown.identity = {
      key: group.key,
      kind: group.kind,
      level: group.level,
      status: group.status,
      decidedBy: group.decidedBy,
      decidedAt: group.decidedAt,
      derivation: `Shown as ${shown.firmId}: ${why}. ${IDENTITY_RULE}`,
      members: memberRows,
    };
    for (const m of members) if (m !== shown) m.representedBy = shown.firmId;
    if (memberRows.some((m) => m.firmId !== shown.firmId && m.rejected)) shown.notes.push("linked_record_rejected");
    // A confirmed duplicate is one record twice: its contacts come from every
    // copy, each keeping the FirmID it is stored under. Offices keep their own.
    if (group.kind === "duplicate" && (shown.status === "tiered" || shown.status === "generalist")) {
      const source = sources.get(shown)!;
      const seen = new Set<string>();
      const union: Contact[] = [];
      for (const m of [shown, ...members.filter((x) => x !== shown)]) {
        for (const c of sources.get(m)?.contacts ?? []) {
          const k = c.email ? c.email.trim().toLowerCase() : `${c.fid}|${c.first}|${c.last}|${c.title}`;
          if (seen.has(k)) continue;
          seen.add(k);
          union.push(c);
        }
      }
      const ranked = RME.rankContacts(source.firm, union, legacy);
      const seq = RME.pickSequence(ranked);
      shown.contacts = briefsOf(seq);
      shown.people = peopleOf(ranked);
      live.set(shown, { firm: source.firm, ranked, seq });
    }
  }

  const byId = new Map(db.firms.map((firm) => [firm.id, firm]));
  const rank = (a: FirmOutcome, b: FirmOutcome) =>
    (b.score ?? -1) - (a.score ?? -1) ||
    (b.confidence ?? 0) - (a.confidence ?? 0) ||
    (byId.get(b.firmId)?.year ?? 0) - (byId.get(a.firmId)?.year ?? 0) ||
    a.firmId.localeCompare(b.firmId);

  // Website check of each tier's top funds, as today: dead sites leave.
  const siteN = legacy.siteN == null ? 50 : legacy.siteN;
  const dropDead = legacy.dropDead !== false;
  if (input.sites && siteN !== 0) {
    for (const tier of TIER_KEYS) {
      const inTier = outcomes.filter((o) => o.status === "tiered" && o.tier === tier && !o.rejected && !o.representedBy).sort(rank);
      const checked = siteN > 0 ? inTier.slice(0, siteN) : inTier;
      for (const out of checked) {
        const site = input.sites[out.firmId] ?? { st: "unscanned" as const };
        out.site = site.st;
        RME.applySite({ site, A: { flags: out.flags }, pros: out.pros }, legacy);
        if (dropDead && ["broken", "parked", "inactive"].includes(site.st)) {
          out.status = "excluded";
          out.reasons.push("dead_website");
        }
      }
    }
  }

  const order = (o: FirmOutcome) =>
    o.status === "tiered" ? TIER_KEYS.indexOf(o.tier!) : o.status === "generalist" ? 10 : o.status === "unresolved" ? 11 : 12;
  outcomes.sort((a, b) => order(a) - order(b) || (a.status === "tiered" || a.status === "generalist" ? rank(a, b) : a.firmId.localeCompare(b.firmId)));

  const counts: TierCounts = {
    firms: db.firms.length,
    tiers: { core: 0, sphere: 0, tier3: 0, tier4: 0 },
    rejected: 0,
    generalists: 0,
    excluded: 0,
    unresolved: 0,
    reasons: {},
    fofWithOtherFinancing,
    represented: 0,
    identityGroups,
  };
  for (const out of outcomes) {
    if (out.representedBy) {
      counts.represented += 1;
      continue;
    }
    if (out.status === "tiered") {
      if (out.rejected) counts.rejected += 1;
      else counts.tiers[out.tier!] += 1;
    }
    if (out.status === "generalist") counts.generalists += 1;
    if (out.status === "excluded") counts.excluded += 1;
    if (out.status === "unresolved") counts.unresolved += 1;
    const code = out.reasons[out.reasons.length - 1];
    if (code) counts.reasons[code] = (counts.reasons[code] ?? 0) + 1;
  }

  return { rulesVersion: RULES_VERSION, outcomes, counts, warnings: profileWarnings(profile.issues), live };
}
