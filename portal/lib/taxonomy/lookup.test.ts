import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firm } from "../match/engine/index.mjs";
import { indexTaxonomy, rawKey, type TaxAlias, type TaxEdge, type TaxNode } from "./core.ts";
import { isWithin, lookupFirmsIn } from "./lookup.ts";

function node(id: string, dimension: TaxNode["dimension"], label: string, parentId: string | null = null): TaxNode {
  return { id, dimension, label, parentId, kind: dimension === "geography" ? "country" : dimension, description: "", synonyms: [], attrs: {}, status: "active", sort: 0 };
}
function alias(field: TaxAlias["field"], value: string, nodeIds: string[], review: TaxAlias["review"] = "approved"): TaxAlias {
  return { field, rawKey: rawKey(value), rawValue: value, nodeIds, state: "mapped", review, method: "seed", rationale: "", aiProposal: null, reviewedBy: null, reviewedAt: null, updatedAt: "" };
}
function edge(fromId: string, toId: string, relation: TaxEdge["relation"], review: TaxEdge["review"] = "approved"): TaxEdge {
  return { id: `${fromId}>${toId}`, fromId, toId, relation, directed: false, origin: "seed", review, rationale: "", source: "", context: "", reviewedBy: null, reviewedAt: null };
}

const index = indexTaxonomy({
  revision: 1,
  nodes: [
    node("sector.fintech", "sector", "Fintech"),
    node("sector.insurtech", "sector", "Insurtech"),
    node("sector.healthtech", "sector", "Healthtech"),
    node("geo.europe", "geography", "Europe"),
    node("geo.germany", "geography", "Germany", "geo.europe"),
    node("geo.us", "geography", "United States"),
    node("stage.seed", "stage", "Seed"),
    node("stage.series_a", "stage", "Series A"),
  ],
  aliases: [
    alias("vertical", "Fintech", ["sector.fintech"]),
    alias("vertical", "Insurtech", ["sector.insurtech"]),
    alias("vertical", "Healthtech", ["sector.healthtech"], "needs_review"),
    alias("geography", "Germany", ["geo.germany"]),
    alias("geography", "United States", ["geo.us"]),
    alias("stage", "Seed", ["stage.seed"]),
    alias("stage", "Series A", ["stage.series_a"]),
  ],
  edges: [edge("sector.fintech", "sector.insurtech", "immediate"), edge("sector.fintech", "sector.healthtech", "weak", "needs_review")],
});

let seq = 0;
function firm(extra: Partial<Firm>): Firm {
  seq += 1;
  return {
    id: `F${seq}`, name: `Fund ${seq}`, type: "", region: "", year: null, stages: ["Seed"], fin: [], ind: [], vert: ["Fintech"], geo: ["United States"],
    city: "", state: "", country: "", web: "", email: "", phone: "", nContacts: 0, offices: [], ...extra,
  };
}

const berlin = firm({ name: "Berlin Seed Partners", geo: ["Germany"] });
const austin = firm({ name: "Austin Seed Fund" });
const later = firm({ name: "Later Stage Capital", stages: ["Series A"], vert: ["Insurtech"] });
const health = firm({ name: "Health Seed", vert: ["Healthtech"] });
const firms = [berlin, austin, later, health];

test("a region includes the countries inside it", () => {
  assert.equal(isWithin(index, "geo.germany", "geo.europe"), true);
  assert.equal(isWithin(index, "geo.europe", "geo.germany"), false);
  assert.equal(isWithin(index, "geo.us", "geo.us"), true);
});

test("lookup by name, and by classified sector, geography and stage together", () => {
  assert.deepEqual(lookupFirmsIn(firms, index, { query: "seed", sector: null, geography: null, stage: null }).firms.map((f) => f.id), [austin.id, berlin.id, health.id]);
  assert.deepEqual(lookupFirmsIn(firms, index, { query: "", sector: null, geography: "geo.europe", stage: null }).firms.map((f) => f.id), [berlin.id]);
  assert.deepEqual(lookupFirmsIn(firms, index, { query: "", sector: "sector.insurtech", geography: null, stage: "stage.series_a" }).firms.map((f) => f.id), [later.id]);
  // Only approved mappings count: Healthtech is still under review.
  assert.deepEqual(lookupFirmsIn(firms, index, { query: "", sector: "sector.healthtech", geography: null, stage: null }).firms, []);
  // An exact FirmID comes first.
  assert.equal(lookupFirmsIn(firms, index, { query: later.id, sector: null, geography: null, stage: null }).firms[0].id, later.id);
});

test("each firm shows its approved sector links", () => {
  const [found] = lookupFirmsIn(firms, index, { query: austin.id, sector: null, geography: null, stage: null }).firms;
  assert.deepEqual(found.relationships, [{ sector: "Fintech", relation: "immediate", other: "Insurtech", directed: false }]);
});
