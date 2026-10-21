import "server-only";
import { gzipSync } from "node:zlib";
import type { FundDb } from "@/lib/match/engine/index.mjs";
import { loadLiveDb, selectAll } from "@/lib/match/db-server";
import { FUND_DB_BUCKET } from "@/lib/match/shared";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  DIMENSIONS,
  FIELD_KEYS,
  GENERALIST_KIND,
  RELATIONS,
  buildCoverage,
  cleanNodeIds,
  countRawValues,
  fieldOf,
  indexTaxonomy,
  mapFirm,
  newRawValues,
  type AiProposal,
  type AliasMethod,
  type AliasState,
  type CoverageReport,
  type Dimension,
  type EdgeOrigin,
  type EdgeReview,
  type FieldKey,
  type RawValueCount,
  type Relation,
  type Review,
  type TaxAlias,
  type TaxEdge,
  type TaxIndex,
  type TaxNode,
} from "@/lib/taxonomy/core";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const TAXONOMY_MIGRATION_MISSING =
  "The investor taxonomy is not set up in the database yet. Run portal/supabase/investor_taxonomy.sql in Supabase.";

export function taxonomyTableError(message: string, code?: string) {
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    /tax_nodes|tax_aliases|tax_edges|tax_changes|tax_coverage_runs/.test(message) ||
    message.toLowerCase().includes("schema cache")
  ) {
    return TAXONOMY_MIGRATION_MISSING;
  }
  return message;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Rows

type Row = Record<string, unknown>;

const text = (value: unknown) => (value == null ? "" : String(value));
const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

function asNode(row: Row): TaxNode {
  return {
    id: text(row.id),
    dimension: oneOf(row.dimension, DIMENSIONS, "sector"),
    label: text(row.label),
    parentId: row.parent_id == null ? null : text(row.parent_id),
    kind: text(row.kind),
    description: text(row.description),
    synonyms: list(row.synonyms),
    attrs: row.attrs && typeof row.attrs === "object" ? (row.attrs as Record<string, unknown>) : {},
    status: oneOf(row.status, ["active", "retired"] as const, "active"),
    sort: Number(row.sort ?? 0),
  };
}

function asProposal(value: unknown): AiProposal | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    nodeIds: list(raw.nodeIds),
    confidence: Number(raw.confidence ?? 0),
    rationale: text(raw.rationale),
    at: text(raw.at),
  };
}

function asAlias(row: Row): TaxAlias {
  return {
    field: oneOf(row.field, FIELD_KEYS, "industry"),
    rawKey: text(row.raw_key),
    rawValue: text(row.raw_value),
    nodeIds: list(row.node_ids),
    state: oneOf(row.state, ["mapped", "unmapped", "ignored"] as const, "unmapped"),
    review: oneOf(row.review, ["approved", "needs_review"] as const, "needs_review"),
    method: oneOf(row.method, ["seed", "import", "manual", "ai"] as const, "import"),
    rationale: text(row.rationale),
    aiProposal: asProposal(row.ai_proposal),
    reviewedBy: row.reviewed_by == null ? null : text(row.reviewed_by),
    reviewedAt: row.reviewed_at == null ? null : text(row.reviewed_at),
    updatedAt: text(row.updated_at),
  };
}

function asEdge(row: Row): TaxEdge {
  return {
    id: text(row.id),
    fromId: text(row.from_id),
    toId: text(row.to_id),
    relation: oneOf(row.relation, RELATIONS, "weak"),
    directed: row.directed === true,
    origin: oneOf(row.origin, ["seed", "legacy", "manual", "ai"] as const, "manual"),
    review: oneOf(row.review, ["approved", "needs_review", "rejected"] as const, "needs_review"),
    rationale: text(row.rationale),
    source: text(row.source),
    context: text(row.context),
    reviewedBy: row.reviewed_by == null ? null : text(row.reviewed_by),
    reviewedAt: row.reviewed_at == null ? null : text(row.reviewed_at),
  };
}

// ---------------------------------------------------------------------------
// Loading (cached in memory by revision)

export async function currentRevision(supabase: ServiceClient): Promise<Result<number>> {
  const { data, error } = await supabase
    .from("tax_changes")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: taxonomyTableError(error.message, error.code) };
  return { ok: true, value: data ? Number(data.id) : 0 };
}

let cached: TaxIndex | null = null;

/** The whole taxonomy, reloaded only when its revision changes. */
export async function loadTaxonomy(supabase: ServiceClient): Promise<Result<TaxIndex>> {
  const revision = await currentRevision(supabase);
  if (!revision.ok) return revision;
  if (cached && cached.taxonomy.revision === revision.value) return { ok: true, value: cached };

  const [nodes, aliases, edges] = await Promise.all([
    selectAll<Row>((from, to) => supabase.from("tax_nodes").select("*").order("id").range(from, to)),
    selectAll<Row>((from, to) =>
      supabase.from("tax_aliases").select("*").order("field").order("raw_key").range(from, to),
    ),
    selectAll<Row>((from, to) => supabase.from("tax_edges").select("*").order("id").range(from, to)),
  ]);
  if (!nodes.ok) return nodes;
  if (!aliases.ok) return aliases;
  if (!edges.ok) return edges;
  const all = nodes.rows.map(asNode);
  const sortOf = new Map(all.map((node) => [node.id, node.sort]));
  const parentSort = (node: TaxNode) => (node.parentId ? (sortOf.get(node.parentId) ?? 0) : -1);
  cached = indexTaxonomy({
    revision: revision.value,
    // Siblings together, groups in their own order.
    nodes: all.sort(
      (a, b) =>
        a.dimension.localeCompare(b.dimension) ||
        parentSort(a) - parentSort(b) ||
        (a.parentId ?? "").localeCompare(b.parentId ?? "") ||
        a.sort - b.sort ||
        a.label.localeCompare(b.label),
    ),
    aliases: aliases.rows.map(asAlias),
    edges: edges.rows.map(asEdge),
  });
  return { ok: true, value: cached };
}

let countsCache: { versionId: string; counts: RawValueCount[] } | null = null;

/** Distinct raw values of the live database with firm counts, cached per version. */
export function rawValueCounts(versionId: string, db: FundDb) {
  if (countsCache?.versionId !== versionId) countsCache = { versionId, counts: countRawValues(db) };
  return countsCache.counts;
}

// ---------------------------------------------------------------------------
// New values and coverage runs

/** For the upload preview: values a staged database has that the taxonomy has never seen. */
export async function previewNewValues(
  supabase: ServiceClient,
  db: FundDb,
): Promise<{ newValues: number; sample: string[] } | null> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return null;
  const found = newRawValues(db, taxonomy.value);
  return {
    newValues: found.length,
    sample: found.slice(0, 8).map((value) => `${fieldOf(value.field)?.label}: ${value.rawValue}`),
  };
}

const INSERT_BATCH = 500;

/** Adds every raw value the taxonomy hasn't seen as "unmapped". Existing rows are never touched. */
async function registerNewValues(
  supabase: ServiceClient,
  db: FundDb,
  index: TaxIndex,
  versionId: string,
  actor: string | null,
): Promise<Result<number>> {
  const found = newRawValues(db, index);
  for (let i = 0; i < found.length; i += INSERT_BATCH) {
    const rows = found.slice(i, i + INSERT_BATCH).map((value) => ({
      field: value.field,
      raw_key: value.rawKey,
      raw_value: value.rawValue.slice(0, 500),
      state: "unmapped",
      review: "needs_review",
      method: "import",
      first_seen_version: versionId,
      updated_by: actor,
    }));
    const { error } = await supabase
      .from("tax_aliases")
      .upsert(rows, { onConflict: "field,raw_key", ignoreDuplicates: true });
    if (error) return { ok: false, error: taxonomyTableError(error.message, error.code) };
  }
  return { ok: true, value: found.length };
}

export type CoverageRun = {
  id: string;
  versionId: string;
  revision: number;
  report: CoverageReport;
  createdBy: string | null;
  createdAt: string;
};

function asRun(row: Row): CoverageRun {
  return {
    id: text(row.id),
    versionId: text(row.fund_db_version_id),
    revision: Number(row.taxonomy_revision ?? 0),
    report: row.report as CoverageReport,
    createdBy: row.created_by == null ? null : text(row.created_by),
    createdAt: text(row.created_at),
  };
}

/**
 * Maps every firm of the live database and stores the coverage report and the
 * mappings for this database version and taxonomy revision. Repeatable: the
 * same pair replaces its earlier run.
 */
export async function runCoverage(
  supabase: ServiceClient,
  actor: string | null,
): Promise<Result<CoverageRun & { registered: number }>> {
  const live = await loadLiveDb(supabase);
  if (!live.ok) return live;
  let taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const versionId = live.value.version.id;
  const db = live.value.db;

  const registered = await registerNewValues(supabase, db, taxonomy.value, versionId, actor);
  if (!registered.ok) return registered;
  if (registered.value > 0) {
    taxonomy = await loadTaxonomy(supabase);
    if (!taxonomy.ok) return taxonomy;
  }
  const index = taxonomy.value;
  const mappings = db.firms.map((firm) => mapFirm(firm, index));
  const report = buildCoverage(db, index, mappings);
  const revision = index.taxonomy.revision;

  const mappingsPath = `taxonomy/${versionId}/r${revision}.json.gz`;
  const { error: uploadError } = await supabase.storage
    .from(FUND_DB_BUCKET)
    .upload(mappingsPath, gzipSync(JSON.stringify({ versionId, revision, mappings })), {
      contentType: "application/gzip",
      upsert: true,
    });
  if (uploadError) return { ok: false, error: `The firm mappings could not be stored: ${uploadError.message}.` };

  const { data, error } = await supabase
    .from("tax_coverage_runs")
    .upsert(
      {
        fund_db_version_id: versionId,
        taxonomy_revision: revision,
        report,
        mappings_path: mappingsPath,
        created_by: actor,
        created_at: nowIso(),
      },
      { onConflict: "fund_db_version_id,taxonomy_revision" },
    )
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, error: taxonomyTableError(error?.message ?? "The coverage run was not saved.", error?.code) };
  }
  return { ok: true, value: { ...asRun(data), registered: registered.value } };
}

/** The latest coverage run for a database version. */
export async function loadLatestRun(
  supabase: ServiceClient,
  versionId: string,
): Promise<Result<CoverageRun | null>> {
  const { data, error } = await supabase
    .from("tax_coverage_runs")
    .select("*")
    .eq("fund_db_version_id", versionId)
    .order("taxonomy_revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: taxonomyTableError(error.message, error.code) };
  return { ok: true, value: data ? asRun(data) : null };
}

export type ChangeEntry = {
  id: number;
  entity: string;
  key: string;
  action: string;
  fields: string[];
  actor: string | null;
  at: string;
};

const QUIET_FIELDS = new Set(["updated_at", "updated_by", "created_at"]);

export async function loadChanges(supabase: ServiceClient, limit = 50): Promise<Result<ChangeEntry[]>> {
  const { data, error } = await supabase
    .from("tax_changes")
    .select("*")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: taxonomyTableError(error.message, error.code) };
  return {
    ok: true,
    value: (data ?? []).map((row: Row) => {
      const before = (row.before ?? {}) as Row;
      const after = (row.after ?? {}) as Row;
      const fields =
        row.action === "update"
          ? Object.keys(after).filter(
              (key) => !QUIET_FIELDS.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
            )
          : [];
      const current = row.action === "delete" ? before : after;
      return {
        id: Number(row.id),
        entity: text(row.entity),
        key: row.entity === "tax_edges" ? `${text(current.from_id)} – ${text(current.to_id)}` : text(row.entity_key),
        action: text(row.action),
        fields,
        actor: row.actor == null ? null : text(row.actor),
        at: text(row.at),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Changes made by an admin. Every write sets updated_by, which the change log records.

const RATIONALE_MAX = 600;
const CONTEXT_MAX = 300;

function aliasOf(index: TaxIndex, field: FieldKey, key: string) {
  return index.aliases.get(`${field}|${key}`) ?? null;
}

async function updateAlias(supabase: ServiceClient, field: FieldKey, key: string, patch: Row): Promise<Result<null>> {
  const { error } = await supabase
    .from("tax_aliases")
    .update({ ...patch, updated_at: nowIso() })
    .eq("field", field)
    .eq("raw_key", key);
  if (error) return { ok: false, error: taxonomyTableError(error.message, error.code) };
  return { ok: true, value: null };
}

/** A person's mapping decision: mapped to categories, or deliberately ignored. Approved by them. */
export async function setAlias(
  supabase: ServiceClient,
  input: { field: FieldKey; rawKey: string; state: Exclude<AliasState, "unmapped">; nodeIds: string[]; rationale: string },
  actor: string | null,
): Promise<Result<null>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const field = fieldOf(input.field);
  const alias = field ? aliasOf(taxonomy.value, field.key, input.rawKey) : null;
  if (!field || !alias) return { ok: false, error: "That value is not in the taxonomy." };
  const nodeIds = input.state === "mapped" ? cleanNodeIds(taxonomy.value, field.dimension, input.nodeIds) : [];
  if (input.state === "mapped" && nodeIds.length === 0) {
    return { ok: false, error: `Pick at least one ${field.dimension.replace("_", " ")} category, or mark the value ignored.` };
  }
  const groups = nodeIds.filter((id) => taxonomy.value.nodes.get(id)?.kind === "group");
  if (groups.length > 0) return { ok: false, error: "Groups are for browsing. Pick a category inside the group." };
  const rationale = input.rationale.trim().slice(0, RATIONALE_MAX);
  if (input.state === "ignored" && !rationale) return { ok: false, error: "Say why the value is ignored." };
  const method: AliasMethod = alias.method === "ai" && sameIds(alias.nodeIds, nodeIds) ? "ai" : "manual";
  return updateAlias(supabase, field.key, alias.rawKey, {
    state: input.state,
    node_ids: nodeIds,
    method,
    rationale: rationale || alias.rationale,
    review: "approved",
    reviewed_by: actor,
    reviewed_at: nowIso(),
    updated_by: actor,
  });
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Approves the current mapping as it is. */
export async function approveAlias(
  supabase: ServiceClient,
  field: FieldKey,
  key: string,
  actor: string | null,
): Promise<Result<null>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const alias = aliasOf(taxonomy.value, field, key);
  if (!alias) return { ok: false, error: "That value is not in the taxonomy." };
  if (alias.state === "unmapped") return { ok: false, error: "Map the value first." };
  return updateAlias(supabase, field, key, {
    review: "approved",
    reviewed_by: actor,
    reviewed_at: nowIso(),
    updated_by: actor,
  });
}

/** Uses the AI suggestion as the mapping (a person accepted it), or drops it. */
export async function resolveProposal(
  supabase: ServiceClient,
  field: FieldKey,
  key: string,
  accept: boolean,
  actor: string | null,
): Promise<Result<null>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const info = fieldOf(field);
  const alias = aliasOf(taxonomy.value, field, key);
  if (!info || !alias?.aiProposal) return { ok: false, error: "There is no suggestion for that value." };
  if (!accept) return updateAlias(supabase, field, key, { ai_proposal: null, updated_by: actor });
  const nodeIds = cleanNodeIds(taxonomy.value, info.dimension, alias.aiProposal.nodeIds);
  if (nodeIds.length === 0) {
    return { ok: false, error: "The suggestion has no usable category. Map the value by hand or dismiss it." };
  }
  return updateAlias(supabase, field, key, {
    state: "mapped",
    node_ids: nodeIds,
    method: "ai",
    rationale: alias.aiProposal.rationale.slice(0, RATIONALE_MAX),
    ai_proposal: null,
    review: "approved",
    reviewed_by: actor,
    reviewed_at: nowIso(),
    updated_by: actor,
  });
}

export async function saveProposals(
  supabase: ServiceClient,
  field: FieldKey,
  proposals: { rawKey: string; proposal: AiProposal }[],
  actor: string | null,
): Promise<Result<number>> {
  for (const item of proposals) {
    const saved = await updateAlias(supabase, field, item.rawKey, { ai_proposal: item.proposal, updated_by: actor });
    if (!saved.ok) return saved;
  }
  return { ok: true, value: proposals.length };
}

function isRelatable(node: TaxNode | undefined): node is TaxNode {
  return !!node && node.dimension === "sector" && node.status === "active" && node.kind !== "group" && node.kind !== GENERALIST_KIND;
}

/** Approve (optionally as another relationship type) or reject a relationship. */
export async function reviewEdge(
  supabase: ServiceClient,
  input: { id: string; review: Exclude<EdgeReview, "needs_review">; relation: Relation | null },
  actor: string | null,
): Promise<Result<null>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const edge = taxonomy.value.taxonomy.edges.find((item) => item.id === input.id);
  if (!edge) return { ok: false, error: "That relationship no longer exists." };
  const patch: Row = {
    review: input.review,
    reviewed_by: actor,
    reviewed_at: nowIso(),
    updated_by: actor,
    updated_at: nowIso(),
  };
  if (input.relation) patch.relation = input.relation;
  const { error } = await supabase.from("tax_edges").update(patch).eq("id", edge.id);
  if (error) return { ok: false, error: taxonomyTableError(error.message, error.code) };
  return { ok: true, value: null };
}

export type NewEdge = {
  fromId: string;
  toId: string;
  relation: Relation;
  directed: boolean;
  rationale: string;
  context: string;
};

export async function createEdges(
  supabase: ServiceClient,
  edges: NewEdge[],
  meta: { origin: EdgeOrigin; review: Review; source: string },
  actor: string | null,
): Promise<Result<number>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const index = taxonomy.value;
  const rows: Row[] = [];
  for (const edge of edges) {
    const from = index.nodes.get(edge.fromId);
    const to = index.nodes.get(edge.toId);
    if (!isRelatable(from) || !isRelatable(to) || from.id === to.id) {
      return { ok: false, error: "Relationships link two different active sectors (not groups or generalist)." };
    }
    const rationale = edge.rationale.trim();
    if (rationale.length < 10) return { ok: false, error: "Give the reason for the relationship (at least 10 characters)." };
    if (existingEdge(index, from.id, to.id)) {
      return { ok: false, error: `${from.label} and ${to.label} already have a relationship.` };
    }
    rows.push({
      from_id: from.id,
      to_id: to.id,
      relation: edge.relation,
      directed: edge.directed,
      origin: meta.origin,
      review: meta.review,
      rationale: rationale.slice(0, RATIONALE_MAX),
      context: edge.context.trim().slice(0, CONTEXT_MAX),
      source: meta.source,
      reviewed_by: meta.review === "approved" ? actor : null,
      reviewed_at: meta.review === "approved" ? nowIso() : null,
      updated_by: actor,
    });
  }
  if (rows.length === 0) return { ok: true, value: 0 };
  const { error } = await supabase.from("tax_edges").insert(rows);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "One of these relationships already exists. Reload the page." };
    return { ok: false, error: taxonomyTableError(error.message, error.code) };
  }
  return { ok: true, value: rows.length };
}

/** Any edge between the two, including rejected ones. */
export function existingEdge(index: TaxIndex, a: string, b: string) {
  return index.taxonomy.edges.find(
    (edge) => (edge.fromId === a && edge.toId === b) || (edge.fromId === b && edge.toId === a),
  );
}

const ID_PREFIX: Record<Dimension, string> = {
  sector: "sector",
  stage: "stage",
  geography: "geo",
  financing: "financing",
  firm_type: "firm_type",
};

export const NODE_KINDS: Record<Dimension, string[]> = {
  sector: ["sector", "thesis"],
  stage: ["stage"],
  geography: ["region", "subregion", "country", "us_region", "us_state"],
  financing: ["financing"],
  firm_type: ["firm_type"],
};

function slugOf(label: string) {
  return label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export async function createNode(
  supabase: ServiceClient,
  input: { dimension: Dimension; label: string; parentId: string | null; kind: string; description: string },
  actor: string | null,
): Promise<Result<{ id: string }>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const index = taxonomy.value;
  const label = input.label.trim().slice(0, 120);
  const slug = slugOf(label);
  if (!slug) return { ok: false, error: "Give the category a name." };
  if (!NODE_KINDS[input.dimension].includes(input.kind)) return { ok: false, error: "Unknown kind of category." };
  const parent = input.parentId ? index.nodes.get(input.parentId) : null;
  if (input.parentId && (!parent || parent.dimension !== input.dimension)) {
    return { ok: false, error: "The parent must be a category of the same dimension." };
  }
  const sameLabel = index.taxonomy.nodes.find(
    (node) => node.dimension === input.dimension && node.label.toLowerCase() === label.toLowerCase(),
  );
  if (sameLabel) return { ok: false, error: `"${sameLabel.label}" already exists.` };
  let id = `${ID_PREFIX[input.dimension]}.${slug}`;
  for (let n = 2; index.nodes.has(id); n += 1) id = `${ID_PREFIX[input.dimension]}.${slug}_${n}`;
  const { error } = await supabase.from("tax_nodes").insert({
    id,
    dimension: input.dimension,
    label,
    parent_id: parent?.id ?? null,
    kind: input.kind,
    description: input.description.trim().slice(0, RATIONALE_MAX),
    updated_by: actor,
  });
  if (error) return { ok: false, error: taxonomyTableError(error.message, error.code) };
  return { ok: true, value: { id } };
}

export async function updateNode(
  supabase: ServiceClient,
  input: { id: string; label: string; description: string; status: "active" | "retired" },
  actor: string | null,
): Promise<Result<null>> {
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const node = taxonomy.value.nodes.get(input.id);
  if (!node) return { ok: false, error: "That category no longer exists." };
  const label = input.label.trim().slice(0, 120);
  if (!label) return { ok: false, error: "Give the category a name." };
  const { error } = await supabase
    .from("tax_nodes")
    .update({
      label,
      description: input.description.trim().slice(0, RATIONALE_MAX),
      status: input.status,
      updated_by: actor,
      updated_at: nowIso(),
    })
    .eq("id", node.id);
  if (error) return { ok: false, error: taxonomyTableError(error.message, error.code) };
  return { ok: true, value: null };
}
