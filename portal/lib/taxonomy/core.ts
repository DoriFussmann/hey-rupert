// Investor taxonomy: canonical categories, how raw Fund Database values map to
// them, the sector relationship graph, and the coverage report. Pure module:
// no server code and no runtime imports, so it runs in tests and in the UI.
//
// The Fund Database itself is never changed. A firm's mapping is derived from
// its raw values and the taxonomy, so the same database and taxonomy revision
// always give the same result.

import type { Firm, FundDb } from "../match/engine/index.mjs";

// ---------------------------------------------------------------------------
// Vocabulary

export const DIMENSIONS = ["sector", "stage", "geography", "financing", "firm_type"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABEL: Record<Dimension, string> = {
  sector: "Sector",
  stage: "Stage",
  geography: "Geography",
  financing: "Financing",
  firm_type: "Firm type",
};

/** Fund Database fields the taxonomy maps, with the workbook column each comes from. */
export const FIELDS = [
  { key: "industry", label: "Industry", dimension: "sector", criteria: true },
  { key: "vertical", label: "Vertical", dimension: "sector", criteria: true },
  { key: "stage", label: "Stage", dimension: "stage", criteria: true },
  { key: "geography", label: "Geography", dimension: "geography", criteria: true },
  { key: "financing", label: "Financing", dimension: "financing", criteria: true },
  { key: "firm_type", label: "Type of Firm", dimension: "firm_type", criteria: true },
  { key: "hq_country", label: "Country (HQ)", dimension: "geography", criteria: false },
  { key: "hq_state", label: "State (HQ)", dimension: "geography", criteria: false },
  { key: "region", label: "Region (HQ)", dimension: "geography", criteria: false },
] as const satisfies readonly { key: string; label: string; dimension: Dimension; criteria: boolean }[];

export type FieldKey = (typeof FIELDS)[number]["key"];
export const FIELD_KEYS = FIELDS.map((field) => field.key) as FieldKey[];

export function fieldOf(key: string) {
  return FIELDS.find((field) => field.key === key) ?? null;
}

/** Proximity between two sectors, closest first. No edge means no established relationship. */
export const RELATIONS = ["equivalent", "immediate", "broad", "weak"] as const;
export type Relation = (typeof RELATIONS)[number];

export const RELATION_LABEL: Record<Relation, string> = {
  equivalent: "Equivalent",
  immediate: "Immediate adjacency",
  broad: "Broader adjacency",
  weak: "Weak but defensible",
};

export const RELATION_HELP: Record<Relation, string> = {
  equivalent: "Interchangeable labels: an investor in one invests in the other.",
  immediate: "Direct neighbours: specialists in one routinely invest in the other.",
  broad: "Same sector family: investors across the family would consider it.",
  weak: "A real but distant link worth stating, e.g. shared customers or technology.",
};

export type NodeStatus = "active" | "retired";
export type AliasState = "mapped" | "unmapped" | "ignored";
export type Review = "approved" | "needs_review";
export type EdgeReview = Review | "rejected";
export type AliasMethod = "seed" | "import" | "manual" | "ai";
export type EdgeOrigin = "seed" | "legacy" | "manual" | "ai";

/** Node id of the United States: HQ state is only mapped for US firms. */
export const US_NODE = "geo.us";
/** Sector node kind for "invests in everything", which is not a sector. */
export const GENERALIST_KIND = "generalist";
/** A firm listing this many industries or more is treated as a generalist. */
export const GENERALIST_INDUSTRIES = 15;

export type TaxNode = {
  id: string;
  dimension: Dimension;
  label: string;
  parentId: string | null;
  /** sector: group | sector | generalist | thesis; geography: region | subregion | country | us_region | us_state; stage: group | stage. */
  kind: string;
  description: string;
  synonyms: string[];
  /** geography: memberOf (extra containing regions); stage: ladder; sector: granularity. */
  attrs: Record<string, unknown>;
  status: NodeStatus;
  sort: number;
};

export type AiProposal = {
  nodeIds: string[];
  /** 0–1, as stated by the model. */
  confidence: number;
  rationale: string;
  at: string;
};

export type TaxAlias = {
  field: FieldKey;
  rawKey: string;
  /** The value as first seen in the Fund Database. */
  rawValue: string;
  nodeIds: string[];
  state: AliasState;
  review: Review;
  method: AliasMethod;
  rationale: string;
  aiProposal: AiProposal | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  updatedAt: string;
};

export type TaxEdge = {
  id: string;
  fromId: string;
  toId: string;
  relation: Relation;
  /** True: holds from → to only. */
  directed: boolean;
  origin: EdgeOrigin;
  review: EdgeReview;
  rationale: string;
  source: string;
  /** Restrictions on when the relationship holds. */
  context: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type Taxonomy = {
  /** Increases with every change; recorded with every coverage run. */
  revision: number;
  nodes: TaxNode[];
  aliases: TaxAlias[];
  edges: TaxEdge[];
};

/**
 * The comparable form of a raw value: Unicode-normalized, lowercase, single
 * spaces, no spaces around / & - , and plain hyphens. "AI / ML" and "ai/ml"
 * are the same value. The seed SQL uses the same rule.
 */
export function rawKey(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s*([/&,-])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasId(field: string, key: string) {
  return `${field}|${key}`;
}

// ---------------------------------------------------------------------------
// Index

export type TaxIndex = {
  taxonomy: Taxonomy;
  nodes: Map<string, TaxNode>;
  aliases: Map<string, TaxAlias>;
  /** Edges that are not rejected, by node id (both ends). */
  edgesByNode: Map<string, TaxEdge[]>;
};

export function indexTaxonomy(taxonomy: Taxonomy): TaxIndex {
  const nodes = new Map(taxonomy.nodes.map((node) => [node.id, node]));
  const aliases = new Map(taxonomy.aliases.map((alias) => [aliasId(alias.field, alias.rawKey), alias]));
  const edgesByNode = new Map<string, TaxEdge[]>();
  for (const edge of taxonomy.edges) {
    if (edge.review === "rejected") continue;
    for (const id of [edge.fromId, edge.toId]) {
      edgesByNode.set(id, [...(edgesByNode.get(id) ?? []), edge]);
    }
  }
  return { taxonomy, nodes, aliases, edgesByNode };
}

export function findAlias(index: TaxIndex, field: FieldKey, value: string) {
  return index.aliases.get(aliasId(field, rawKey(value))) ?? null;
}

/** Keeps the ids that are active nodes of the dimension, once each, in order. */
export function cleanNodeIds(index: TaxIndex, dimension: Dimension, ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids) {
    const node = typeof id === "string" ? index.nodes.get(id) : undefined;
    if (node && node.dimension === dimension && node.status === "active" && !out.includes(node.id)) {
      out.push(node.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mapping one firm

export type FirmTag = {
  nodeId: string;
  field: FieldKey;
  dimension: Dimension;
  /** The firm's raw value this tag comes from. */
  raw: string;
  review: Review;
  method: AliasMethod;
};

export type IssueKind = "missing" | "unmapped" | "needs_review" | "ignored" | "broken";

export const ISSUE_LABEL: Record<IssueKind, string> = {
  missing: "No value",
  unmapped: "Not mapped yet",
  needs_review: "Mapping needs review",
  ignored: "Ignored value",
  broken: "Maps to a missing or retired category",
};

export type FirmIssue = { field: FieldKey; raw: string | null; kind: IssueKind };

export type FieldStatus = "missing" | "normalized" | "partial" | "unmapped";

export type FirmMapping = {
  firmId: string;
  name: string;
  tags: FirmTag[];
  /** Per field: no value, every value mapped, some mapped, none mapped. */
  status: Record<FieldKey, FieldStatus>;
  /** Every value of the field is mapped and approved. */
  approved: Record<FieldKey, boolean>;
  generalist: boolean;
  generalistWhy: string | null;
  issues: FirmIssue[];
};

/** The firm's raw values for a field, as the Fund Database holds them. */
export function rawValues(firm: Firm, field: FieldKey): string[] {
  switch (field) {
    case "industry":
      return firm.ind;
    case "vertical":
      return firm.vert;
    case "stage":
      return firm.stages;
    case "geography":
      return firm.geo;
    case "financing":
      return firm.fin;
    case "firm_type":
      return firm.type ? [firm.type] : [];
    case "hq_country":
      return firm.country ? [firm.country] : [];
    case "hq_state":
      return firm.state ? [firm.state] : [];
    case "region":
      return firm.region ? [firm.region] : [];
  }
}

/** Issues that mean a person should look at the firm's mapping. */
const REVIEW_KINDS: IssueKind[] = ["unmapped", "needs_review", "broken"];

export function needsReview(mapping: FirmMapping) {
  return mapping.issues.some((issue) => REVIEW_KINDS.includes(issue.kind));
}

export function mapFirm(firm: Firm, index: TaxIndex): FirmMapping {
  const tags: FirmTag[] = [];
  const issues: FirmIssue[] = [];
  const status = {} as Record<FieldKey, FieldStatus>;
  const approved = {} as Record<FieldKey, boolean>;

  const mapField = (field: (typeof FIELDS)[number], values: string[]) => {
    const unique = values.filter((value, i) => values.findIndex((other) => rawKey(other) === rawKey(value)) === i);
    if (unique.length === 0) {
      status[field.key] = "missing";
      approved[field.key] = false;
      return;
    }
    let mapped = 0;
    let allApproved = true;
    for (const value of unique) {
      const alias = findAlias(index, field.key, value);
      if (!alias || alias.state === "unmapped") {
        issues.push({ field: field.key, raw: value, kind: "unmapped" });
        allApproved = false;
        continue;
      }
      if (alias.state === "ignored") {
        // A deliberate "carries no meaning": counts as handled.
        mapped += 1;
        if (alias.review !== "approved") allApproved = false;
        issues.push({ field: field.key, raw: value, kind: "ignored" });
        continue;
      }
      const nodes = alias.nodeIds.map((id) => index.nodes.get(id));
      const valid = nodes.filter(
        (node): node is TaxNode => !!node && node.status === "active" && node.dimension === field.dimension,
      );
      if (valid.length !== alias.nodeIds.length || valid.length === 0) {
        issues.push({ field: field.key, raw: value, kind: "broken" });
      }
      if (valid.length === 0) {
        allApproved = false;
        continue;
      }
      mapped += 1;
      if (alias.review !== "approved") {
        allApproved = false;
        issues.push({ field: field.key, raw: value, kind: "needs_review" });
      }
      for (const node of valid) {
        if (tags.some((tag) => tag.field === field.key && tag.nodeId === node.id)) continue;
        tags.push({
          nodeId: node.id,
          field: field.key,
          dimension: field.dimension,
          raw: value,
          review: alias.review,
          method: alias.method,
        });
      }
    }
    status[field.key] = mapped === unique.length ? "normalized" : mapped === 0 ? "unmapped" : "partial";
    approved[field.key] = allApproved && mapped === unique.length;
  };

  for (const field of FIELDS) {
    if (field.key === "hq_state") continue;
    mapField(field, rawValues(firm, field.key));
  }
  // A state only means something for a US firm.
  const hqState = FIELDS.find((field) => field.key === "hq_state")!;
  const isUs = tags.some((tag) => tag.field === "hq_country" && tag.nodeId === US_NODE);
  mapField(hqState, isUs ? rawValues(firm, "hq_state") : []);

  for (const field of ["stage", "geography", "financing", "firm_type", "hq_country"] as const) {
    if (status[field] === "missing") issues.push({ field, raw: null, kind: "missing" });
  }
  if (status.industry === "missing" && status.vertical === "missing") {
    issues.push({ field: "industry", raw: null, kind: "missing" });
  }

  const generalistTag = tags.find(
    (tag) => tag.dimension === "sector" && index.nodes.get(tag.nodeId)?.kind === GENERALIST_KIND,
  );
  const manyIndustries = firm.ind.length >= GENERALIST_INDUSTRIES;
  const generalistWhy = generalistTag
    ? `Lists "${generalistTag.raw}"`
    : manyIndustries
      ? `Lists ${firm.ind.length} industries`
      : null;

  return {
    firmId: firm.id,
    name: firm.name,
    tags,
    status,
    approved,
    generalist: generalistWhy != null,
    generalistWhy,
    issues,
  };
}

/** The canonical sector nodes of a firm (generalist marker excluded). */
export function firmSectors(mapping: FirmMapping, index: TaxIndex) {
  return Array.from(
    new Set(
      mapping.tags
        .filter((tag) => tag.dimension === "sector" && index.nodes.get(tag.nodeId)?.kind !== GENERALIST_KIND)
        .map((tag) => tag.nodeId),
    ),
  );
}

/** One firm's raw values next to its canonical categories, for the admin lookup. */
export type FirmLookupView = {
  id: string;
  name: string;
  website: string;
  generalistWhy: string | null;
  fields: {
    field: FieldKey;
    label: string;
    raw: string[];
    status: FieldStatus;
    tags: { nodeId: string; label: string; review: Review }[];
  }[];
  issues: { field: string; raw: string | null; kind: string }[];
};

export function firmLookupView(firm: Firm, index: TaxIndex): FirmLookupView {
  const mapping = mapFirm(firm, index);
  return {
    id: firm.id,
    name: firm.name,
    website: firm.web,
    generalistWhy: mapping.generalistWhy,
    fields: FIELDS.map((field) => ({
      field: field.key,
      label: field.label,
      raw: rawValues(firm, field.key),
      status: mapping.status[field.key],
      tags: mapping.tags
        .filter((tag) => tag.field === field.key)
        .map((tag) => ({ nodeId: tag.nodeId, label: index.nodes.get(tag.nodeId)?.label ?? tag.nodeId, review: tag.review })),
    })),
    issues: mapping.issues.map((issue) => ({
      field: fieldOf(issue.field)?.label ?? issue.field,
      raw: issue.raw,
      kind: ISSUE_LABEL[issue.kind],
    })),
  };
}

// ---------------------------------------------------------------------------
// Sector relationships

export type RelationResult = {
  relation: "same" | Relation;
  edge: TaxEdge | null;
  review: EdgeReview;
};

/**
 * The relationship from sector `a` (e.g. the company's) to sector `b` (e.g.
 * the firm's), from the graph only. Directed edges hold from → to only.
 * Null: no established relationship. Rejected edges are ignored.
 */
export function relationBetween(index: TaxIndex, a: string, b: string): RelationResult | null {
  if (a === b) return { relation: "same", edge: null, review: "approved" };
  const edges = (index.edgesByNode.get(a) ?? []).filter(
    (edge) => (edge.fromId === a && edge.toId === b) || (!edge.directed && edge.fromId === b && edge.toId === a),
  );
  if (edges.length === 0) return null;
  const best = edges.sort((x, y) => RELATIONS.indexOf(x.relation) - RELATIONS.indexOf(y.relation))[0];
  return { relation: best.relation, edge: best, review: best.review };
}

// ---------------------------------------------------------------------------
// New values and the coverage report

export type RawValueCount = { field: FieldKey; rawKey: string; rawValue: string; firms: number };

/** Every distinct raw value per field, with how many firms use it. */
export function countRawValues(db: FundDb): RawValueCount[] {
  const counts = new Map<string, RawValueCount>();
  for (const firm of db.firms) {
    for (const field of FIELD_KEYS) {
      const seen = new Set<string>();
      for (const value of rawValues(firm, field)) {
        const key = rawKey(value);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const id = aliasId(field, key);
        const entry = counts.get(id);
        if (entry) entry.firms += 1;
        else counts.set(id, { field, rawKey: key, rawValue: value, firms: 1 });
      }
    }
  }
  return Array.from(counts.values()).sort(
    (a, b) => FIELD_KEYS.indexOf(a.field) - FIELD_KEYS.indexOf(b.field) || b.firms - a.firms,
  );
}

/** Raw values the taxonomy has never seen. HQ states outside the US are skipped. */
export function newRawValues(db: FundDb, index: TaxIndex): RawValueCount[] {
  const usFirms: FundDb = {
    firms: db.firms.filter((firm) => {
      const alias = firm.country ? findAlias(index, "hq_country", firm.country) : null;
      return !!alias && alias.nodeIds.includes(US_NODE);
    }),
    contacts: [],
  };
  const usStates = new Set(
    countRawValues(usFirms)
      .filter((value) => value.field === "hq_state")
      .map((value) => value.rawKey),
  );
  return countRawValues(db).filter(
    (value) =>
      !index.aliases.has(aliasId(value.field, value.rawKey)) &&
      (value.field !== "hq_state" || usStates.has(value.rawKey)),
  );
}

export type FieldCoverage = {
  field: FieldKey;
  label: string;
  /** Firms with at least one value. */
  populated: number;
  /** Firms whose every value is mapped (or deliberately ignored). */
  normalized: number;
  /** …and every one of those mappings is approved. */
  approved: number;
  partial: number;
  /** Populated, but no value mapped. */
  unmapped: number;
  distinct: number;
  distinctMapped: number;
  distinctUnmapped: number;
  distinctIgnored: number;
  distinctNeedsReview: number;
};

export type ValueRow = {
  field: FieldKey;
  rawKey: string;
  rawValue: string;
  firms: number;
  state: AliasState | "new";
  review: Review | null;
  broken: boolean;
  hasProposal: boolean;
};

export type DuplicateGroup = { key: string; firms: { id: string; name: string }[] };

export type CoverageReport = {
  firms: number;
  contacts: number;
  fields: FieldCoverage[];
  sector: {
    /** Firms with an industry or a vertical. */
    populated: number;
    /** Firms with at least one canonical sector. */
    mapped: number;
    /** Firms with two or more canonical sectors. */
    multiCategory: number;
    generalist: number;
  };
  /** Values that are not mapped and approved, most-used first. */
  values: ValueRow[];
  valuesTotal: number;
  reviewFirms: number;
  reviewSample: { id: string; name: string; issues: number }[];
  duplicates: {
    sameName: DuplicateGroup[];
    sameNameCount: number;
    sameWebsite: DuplicateGroup[];
    sameWebsiteCount: number;
  };
  suspicious: { noContacts: number; noWebsite: number };
  conflicts: { field: FieldKey; rawValue: string; detail: string }[];
  aliases: { total: number; approved: number; needsReview: number; unmapped: number; ignored: number; proposals: number };
  edges: { approved: number; needsReview: number; rejected: number; byOrigin: Record<EdgeOrigin, number> };
};

const LIST_CAP = 300;
const SAMPLE_CAP = 50;
const DUPLICATE_CAP = 100;

function domainOf(website: string) {
  return website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

function groupsOf(firms: Firm[], keyOf: (firm: Firm) => string): DuplicateGroup[] {
  const groups = new Map<string, Firm[]>();
  for (const firm of firms) {
    const key = keyOf(firm);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), firm]);
  }
  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, firms: list.map((firm) => ({ id: firm.id, name: firm.name })) }))
    .sort((a, b) => b.firms.length - a.firms.length || a.key.localeCompare(b.key));
}

/** A mapped value pointing at a category that is missing, retired or of another dimension. */
export function isBrokenAlias(index: TaxIndex, alias: TaxAlias) {
  if (alias.state !== "mapped") return false;
  const dimension = fieldOf(alias.field)?.dimension;
  return alias.nodeIds.some((id) => {
    const node = index.nodes.get(id);
    return !node || node.status !== "active" || node.dimension !== dimension;
  });
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function buildCoverage(db: FundDb, index: TaxIndex, mappings: FirmMapping[]): CoverageReport {
  const values = countRawValues(db);
  const fields: FieldCoverage[] = FIELDS.map((field) => {
    let populated = 0;
    let normalized = 0;
    let approvedCount = 0;
    let partial = 0;
    let unmapped = 0;
    for (const mapping of mappings) {
      const state = mapping.status[field.key];
      if (state === "missing") continue;
      populated += 1;
      if (state === "normalized") normalized += 1;
      if (state === "partial") partial += 1;
      if (state === "unmapped") unmapped += 1;
      if (mapping.approved[field.key]) approvedCount += 1;
    }
    const distinct = values.filter((value) => value.field === field.key);
    const aliasOf = (value: RawValueCount) => index.aliases.get(aliasId(value.field, value.rawKey));
    return {
      field: field.key,
      label: field.label,
      populated,
      normalized,
      approved: approvedCount,
      partial,
      unmapped,
      distinct: distinct.length,
      distinctMapped: distinct.filter((value) => aliasOf(value)?.state === "mapped").length,
      distinctUnmapped: distinct.filter((value) => !aliasOf(value) || aliasOf(value)?.state === "unmapped").length,
      distinctIgnored: distinct.filter((value) => aliasOf(value)?.state === "ignored").length,
      distinctNeedsReview: distinct.filter((value) => {
        const alias = aliasOf(value);
        return !!alias && alias.state !== "unmapped" && alias.review === "needs_review";
      }).length,
    };
  });

  const brokenKeys = new Set(
    index.taxonomy.aliases
      .filter((alias) => isBrokenAlias(index, alias))
      .map((alias) => aliasId(alias.field, alias.rawKey)),
  );

  const valueRows: ValueRow[] = values
    .map((value): ValueRow => {
      const alias = index.aliases.get(aliasId(value.field, value.rawKey));
      return {
        field: value.field,
        rawKey: value.rawKey,
        rawValue: alias?.rawValue ?? value.rawValue,
        firms: value.firms,
        state: alias ? alias.state : "new",
        review: alias ? alias.review : null,
        broken: brokenKeys.has(aliasId(value.field, value.rawKey)),
        hasProposal: !!alias?.aiProposal,
      };
    })
    .filter((row) => row.state === "new" || row.state === "unmapped" || row.review !== "approved" || row.broken)
    .sort((a, b) => b.firms - a.firms);

  const conflicts: CoverageReport["conflicts"] = [];
  for (const alias of index.taxonomy.aliases) {
    if (brokenKeys.has(aliasId(alias.field, alias.rawKey))) {
      conflicts.push({
        field: alias.field,
        rawValue: alias.rawValue,
        detail: "Maps to a category that is missing, retired or in another dimension.",
      });
    }
    if (alias.aiProposal && alias.state === "mapped" && !sameList(alias.aiProposal.nodeIds, alias.nodeIds)) {
      conflicts.push({
        field: alias.field,
        rawValue: alias.rawValue,
        detail: "The AI suggestion differs from the current mapping.",
      });
    }
  }

  const review = mappings.filter(needsReview);
  const sectorCounts = mappings.map((mapping) => firmSectors(mapping, index).length);
  const contactsByFirm = new Set(db.contacts.map((contact) => contact.fid));
  const sameName = groupsOf(db.firms, (firm) => rawKey(firm.name));
  const sameWebsite = groupsOf(db.firms, (firm) => domainOf(firm.web));
  const aliases = index.taxonomy.aliases;
  const edges = index.taxonomy.edges;
  const byOrigin: Record<EdgeOrigin, number> = { seed: 0, legacy: 0, manual: 0, ai: 0 };
  edges.forEach((edge) => {
    byOrigin[edge.origin] += 1;
  });

  return {
    firms: db.firms.length,
    contacts: db.contacts.length,
    fields,
    sector: {
      populated: mappings.filter((m) => m.status.industry !== "missing" || m.status.vertical !== "missing").length,
      mapped: sectorCounts.filter((count) => count > 0).length,
      multiCategory: sectorCounts.filter((count) => count > 1).length,
      generalist: mappings.filter((mapping) => mapping.generalist).length,
    },
    values: valueRows.slice(0, LIST_CAP),
    valuesTotal: valueRows.length,
    reviewFirms: review.length,
    reviewSample: review.slice(0, SAMPLE_CAP).map((mapping) => ({
      id: mapping.firmId,
      name: mapping.name,
      issues: mapping.issues.filter((issue) => REVIEW_KINDS.includes(issue.kind)).length,
    })),
    duplicates: {
      sameName: sameName.slice(0, DUPLICATE_CAP),
      sameNameCount: sameName.length,
      sameWebsite: sameWebsite.slice(0, DUPLICATE_CAP),
      sameWebsiteCount: sameWebsite.length,
    },
    suspicious: {
      noContacts: db.firms.filter((firm) => !contactsByFirm.has(firm.id)).length,
      noWebsite: db.firms.filter((firm) => !firm.web).length,
    },
    conflicts: conflicts.slice(0, LIST_CAP),
    aliases: {
      total: aliases.length,
      approved: aliases.filter((alias) => alias.state !== "unmapped" && alias.review === "approved").length,
      needsReview: aliases.filter((alias) => alias.state !== "unmapped" && alias.review === "needs_review").length,
      unmapped: aliases.filter((alias) => alias.state === "unmapped").length,
      ignored: aliases.filter((alias) => alias.state === "ignored").length,
      proposals: aliases.filter((alias) => alias.aiProposal).length,
    },
    edges: {
      approved: edges.filter((edge) => edge.review === "approved").length,
      needsReview: edges.filter((edge) => edge.review === "needs_review").length,
      rejected: edges.filter((edge) => edge.review === "rejected").length,
      byOrigin,
    },
  };
}
