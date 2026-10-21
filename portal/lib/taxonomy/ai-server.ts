import "server-only";
import { callClaudeTool, isClaudeConfigured } from "@/lib/anthropic";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  GENERALIST_KIND,
  RELATIONS,
  RELATION_HELP,
  cleanNodeIds,
  fieldOf,
  type AiProposal,
  type FieldKey,
  type Relation,
} from "@/lib/taxonomy/core";
import { createEdges, existingEdge, loadTaxonomy, saveProposals, type NewEdge } from "@/lib/taxonomy/server";

// AI only proposes. Value suggestions are stored apart from the mapping and
// relationship suggestions are stored as "needs review"; neither is used
// until a person accepts or approves it.

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Values per request: keeps the reply within one response. */
const VALUES_PER_CALL = 40;
const EDGES_PER_CALL = 8;

const NOT_CONFIGURED = "AI suggestions need ANTHROPIC_API_KEY to be configured.";

function clamp01(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Asks for mappings of up to 40 unmapped values of one field. */
export async function proposeValueMappings(
  supabase: ServiceClient,
  field: FieldKey,
  actor: string | null,
): Promise<Result<{ proposed: number; remaining: number }>> {
  if (!isClaudeConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const info = fieldOf(field);
  if (!info) return { ok: false, error: "Unknown field." };
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const index = taxonomy.value;

  const pending = index.taxonomy.aliases.filter(
    (alias) => alias.field === field && alias.state === "unmapped" && !alias.aiProposal,
  );
  if (pending.length === 0) return { ok: true, value: { proposed: 0, remaining: 0 } };
  const batch = pending.slice(0, VALUES_PER_CALL);
  const candidates = index.taxonomy.nodes.filter(
    (node) => node.dimension === info.dimension && node.status === "active" && node.kind !== "group",
  );

  const result = await callClaudeTool<{ proposals?: unknown }>({
    system: [
      "You map raw labels from an investor database to a fixed taxonomy of canonical categories.",
      "Use only category ids from the list. Never invent ids or categories.",
      "Use more than one id only when the label genuinely spans several categories.",
      "When no category fits, return an empty list and say why. A wrong mapping is worse than none.",
      "Give a short, factual rationale and an honest confidence from 0 to 1.",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: [
          `Field: ${info.label} (${info.dimension}).`,
          "",
          "Categories (id: label — notes):",
          ...candidates.map(
            (node) =>
              `${node.id}: ${node.label}${node.description ? ` — ${node.description}` : ""}${node.synonyms.length ? ` (also: ${node.synonyms.join(", ")})` : ""}`,
          ),
          "",
          "Raw values to map, one per line:",
          ...batch.map((alias) => alias.rawValue),
        ].join("\n"),
      },
    ],
    tool: {
      name: "propose_mappings",
      description: "Return one proposal for every raw value.",
      input_schema: {
        type: "object",
        properties: {
          proposals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                raw: { type: "string", description: "The raw value exactly as given." },
                nodeIds: { type: "array", items: { type: "string" } },
                confidence: { type: "number" },
                rationale: { type: "string" },
              },
              required: ["raw", "nodeIds", "confidence", "rationale"],
            },
          },
        },
        required: ["proposals"],
      },
    },
    maxTokens: 6000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const at = new Date().toISOString();
  const byRaw = new Map(batch.map((alias) => [alias.rawValue, alias]));
  const proposals: { rawKey: string; proposal: AiProposal }[] = [];
  for (const item of Array.isArray(result.input.proposals) ? result.input.proposals : []) {
    const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const alias = byRaw.get(String(raw.raw ?? ""));
    if (!alias || proposals.some((p) => p.rawKey === alias.rawKey)) continue;
    proposals.push({
      rawKey: alias.rawKey,
      proposal: {
        nodeIds: cleanNodeIds(index, info.dimension, raw.nodeIds).filter(
          (id) => index.nodes.get(id)?.kind !== "group",
        ),
        confidence: clamp01(raw.confidence),
        rationale: String(raw.rationale ?? "").trim().slice(0, 400),
        at,
      },
    });
  }
  const saved = await saveProposals(supabase, field, proposals, actor);
  if (!saved.ok) return saved;
  return { ok: true, value: { proposed: saved.value, remaining: pending.length - proposals.length } };
}

/** Asks for up to 8 relationships from one sector to sectors it has none with yet. */
export async function proposeRelationships(
  supabase: ServiceClient,
  nodeId: string,
  actor: string | null,
): Promise<Result<{ proposed: number }>> {
  if (!isClaudeConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return taxonomy;
  const index = taxonomy.value;
  const isSector = (kind: string) => kind !== "group" && kind !== GENERALIST_KIND;
  const node = index.nodes.get(nodeId);
  if (!node || node.dimension !== "sector" || !isSector(node.kind) || node.status !== "active") {
    return { ok: false, error: "Pick an active sector." };
  }
  const others = index.taxonomy.nodes.filter(
    (other) =>
      other.dimension === "sector" &&
      other.status === "active" &&
      isSector(other.kind) &&
      other.id !== node.id &&
      !existingEdge(index, node.id, other.id),
  );
  if (others.length === 0) return { ok: true, value: { proposed: 0 } };
  const linked = index.taxonomy.edges
    .filter((edge) => edge.fromId === node.id || edge.toId === node.id)
    .map((edge) => {
      const other = index.nodes.get(edge.fromId === node.id ? edge.toId : edge.fromId);
      return `${other?.label ?? "?"} (${edge.relation}, ${edge.review})`;
    });

  const result = await callClaudeTool<{ relationships?: unknown }>({
    system: [
      "You help maintain a sector relationship graph used to decide which venture investors are relevant to a startup.",
      "Propose only relationships an experienced venture investor would defend. Do not add links just to widen matches.",
      "Relationship types, closest first:",
      ...RELATIONS.map((relation) => `${relation}: ${RELATION_HELP[relation]}`),
      `Propose at most ${EDGES_PER_CALL}. Proposing none is a valid answer.`,
      "Each rationale must state the concrete reason (shared customers, technology, business model or investor practice).",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          `Sector: ${node.label}${node.description ? ` — ${node.description}` : ""}`,
          linked.length ? `Already related to: ${linked.join("; ")}` : "No relationships yet.",
          "",
          "Candidate sectors (id: label):",
          ...others.map((other) => `${other.id}: ${other.label}`),
        ].join("\n"),
      },
    ],
    tool: {
      name: "propose_relationships",
      description: "Return the relationships you propose for the sector.",
      input_schema: {
        type: "object",
        properties: {
          relationships: {
            type: "array",
            items: {
              type: "object",
              properties: {
                toId: { type: "string" },
                relation: { type: "string", enum: [...RELATIONS] },
                rationale: { type: "string" },
              },
              required: ["toId", "relation", "rationale"],
            },
          },
        },
        required: ["relationships"],
      },
    },
    maxTokens: 3000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const allowed = new Set(others.map((other) => other.id));
  const edges: NewEdge[] = [];
  for (const item of Array.isArray(result.input.relationships) ? result.input.relationships : []) {
    const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const toId = String(raw.toId ?? "");
    const relation = String(raw.relation ?? "") as Relation;
    const rationale = String(raw.rationale ?? "").trim();
    if (!allowed.has(toId) || !RELATIONS.includes(relation) || rationale.length < 10) continue;
    if (edges.some((edge) => edge.toId === toId)) continue;
    edges.push({ fromId: node.id, toId, relation, directed: false, rationale, context: "" });
    if (edges.length >= EDGES_PER_CALL) break;
  }
  const created = await createEdges(
    supabase,
    edges,
    { origin: "ai", review: "needs_review", source: "AI suggestion" },
    actor,
  );
  if (!created.ok) return created;
  return { ok: true, value: { proposed: created.value } };
}
