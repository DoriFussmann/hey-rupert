import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firm, FundDb } from "../match/engine/index.mjs";
import {
  buildCoverage,
  countRawValues,
  firmSectors,
  indexTaxonomy,
  mapFirm,
  needsReview,
  newRawValues,
  rawKey,
  relationBetween,
  type TaxAlias,
  type TaxEdge,
  type TaxNode,
  type Taxonomy,
} from "./core.ts";

function node(id: string, dimension: TaxNode["dimension"], kind = "sector", status: TaxNode["status"] = "active"): TaxNode {
  return { id, dimension, label: id, parentId: null, kind, description: "", synonyms: [], attrs: {}, status, sort: 0 };
}

function alias(
  field: TaxAlias["field"],
  value: string,
  nodeIds: string[],
  extra: Partial<TaxAlias> = {},
): TaxAlias {
  return {
    field,
    rawKey: rawKey(value),
    rawValue: value,
    nodeIds,
    state: nodeIds.length ? "mapped" : "unmapped",
    review: "approved",
    method: "seed",
    rationale: "",
    aiProposal: null,
    reviewedBy: null,
    reviewedAt: null,
    updatedAt: "",
    ...extra,
  };
}

function edge(fromId: string, toId: string, relation: TaxEdge["relation"], extra: Partial<TaxEdge> = {}): TaxEdge {
  return {
    id: `${fromId}-${toId}`,
    fromId,
    toId,
    relation,
    directed: false,
    origin: "manual",
    review: "approved",
    rationale: "test",
    source: "",
    context: "",
    reviewedBy: null,
    reviewedAt: null,
    ...extra,
  };
}

function firm(id: string, extra: Partial<Firm> = {}): Firm {
  return {
    id,
    name: `Fund ${id}`,
    type: "Venture Capital Investment Firm",
    region: "",
    year: 2020,
    stages: ["Seed"],
    fin: ["Equity"],
    ind: ["Software"],
    vert: ["Fintech"],
    geo: ["United States"],
    city: "",
    state: "",
    country: "United States",
    web: `https://${id}.vc`,
    email: "",
    phone: "",
    nContacts: 1,
    offices: [],
    ...extra,
  };
}

const taxonomy: Taxonomy = {
  revision: 7,
  nodes: [
    node("sector.software", "sector"),
    node("sector.fintech", "sector"),
    node("sector.insurtech", "sector"),
    node("sector.healthtech", "sector"),
    node("sector.web3", "sector"),
    node("sector.blockchain", "sector"),
    node("sector.diversified", "sector", "generalist"),
    node("sector.old", "sector", "sector", "retired"),
    node("stage.seed", "stage", "stage"),
    node("stage.series_a", "stage", "stage"),
    node("geo.us", "geography", "country"),
    node("geo.us.state.texas", "geography", "us_state"),
    node("financing.equity", "financing", "financing"),
    node("firm_type.vc", "firm_type", "firm_type"),
  ],
  aliases: [
    alias("industry", "Software", ["sector.software"]),
    alias("industry", "Diversified", ["sector.diversified"]),
    alias("vertical", "Fintech", ["sector.fintech"]),
    alias("vertical", "Insurtech", ["sector.insurtech"], { review: "needs_review", method: "manual" }),
    alias("vertical", "Web3 / Blockchain", ["sector.web3", "sector.blockchain"]),
    alias("vertical", "Legacy", ["sector.old"]),
    alias("vertical", "Other", [], { state: "ignored" }),
    alias("vertical", "Mystery", []),
    alias("stage", "Seed", ["stage.seed"]),
    alias("stage", "Early Stage", ["stage.seed", "stage.series_a"]),
    alias("geography", "United States", ["geo.us"]),
    alias("hq_country", "United States", ["geo.us"]),
    alias("hq_state", "Texas", ["geo.us.state.texas"]),
    alias("financing", "Equity", ["financing.equity"]),
    alias("firm_type", "Venture Capital Investment Firm", ["firm_type.vc"]),
  ],
  edges: [
    edge("sector.fintech", "sector.insurtech", "immediate"),
    edge("sector.fintech", "sector.web3", "broad", { directed: true }),
    edge("sector.fintech", "sector.healthtech", "weak", { review: "rejected" }),
    edge("sector.software", "sector.fintech", "broad", { review: "needs_review" }),
  ],
};
const index = indexTaxonomy(taxonomy);

test("rawKey treats spelling and spacing variants as one value", () => {
  assert.equal(rawKey("AI / ML"), rawKey("ai/ml"));
  assert.equal(rawKey("  Real Estate /  Construction "), "real estate/construction");
  assert.equal(rawKey("Pre‑Seed"), rawKey("pre-seed"));
});

test("direct mappings are approved and complete", () => {
  const mapping = mapFirm(firm("a"), index);
  assert.deepEqual(firmSectors(mapping, index).sort(), ["sector.fintech", "sector.software"]);
  assert.equal(mapping.status.industry, "normalized");
  assert.equal(mapping.approved.vertical, true);
  assert.equal(needsReview(mapping), false);
  assert.equal(mapping.generalist, false);
});

test("aliases match regardless of case and spacing", () => {
  const mapping = mapFirm(firm("b", { vert: ["web3/blockchain"] }), index);
  assert.deepEqual(firmSectors(mapping, index).filter((id) => id !== "sector.software").sort(), [
    "sector.blockchain",
    "sector.web3",
  ]);
});

test("a value spanning several categories maps to all of them", () => {
  const mapping = mapFirm(firm("c", { stages: ["Early Stage"] }), index);
  assert.deepEqual(
    mapping.tags.filter((tag) => tag.field === "stage").map((tag) => tag.nodeId),
    ["stage.seed", "stage.series_a"],
  );
});

test("unmapped, ignored, needs-review and retired values are reported, never guessed", () => {
  const mapping = mapFirm(firm("d", { vert: ["Mystery", "Other", "Insurtech", "Legacy", "Brand New"] }), index);
  const kinds = mapping.issues.filter((issue) => issue.field === "vertical").map((issue) => `${issue.raw}:${issue.kind}`);
  assert.deepEqual(kinds.sort(), [
    "Brand New:unmapped",
    "Insurtech:needs_review",
    "Legacy:broken",
    "Mystery:unmapped",
    "Other:ignored",
  ]);
  assert.equal(mapping.status.vertical, "partial");
  assert.equal(mapping.approved.vertical, false);
  assert.ok(!mapping.tags.some((tag) => tag.nodeId === "sector.old"));
  assert.ok(mapping.tags.some((tag) => tag.nodeId === "sector.insurtech" && tag.review === "needs_review"));
  assert.equal(needsReview(mapping), true);
});

test("missing fields are explicit", () => {
  const mapping = mapFirm(firm("e", { ind: [], vert: [], stages: [], geo: [] }), index);
  assert.equal(mapping.status.stage, "missing");
  const missing = mapping.issues.filter((issue) => issue.kind === "missing").map((issue) => issue.field);
  assert.deepEqual(missing.sort(), ["geography", "industry", "stage"]);
});

test("a firm with several sectors keeps each once", () => {
  const mapping = mapFirm(firm("f", { ind: ["Software", "software"], vert: ["Fintech", "Insurtech", "FINTECH"] }), index);
  assert.deepEqual(firmSectors(mapping, index).sort(), ["sector.fintech", "sector.insurtech", "sector.software"]);
  assert.equal(mapping.tags.filter((tag) => tag.nodeId === "sector.fintech").length, 1);
});

test("generalists are flagged, not mapped to every sector", () => {
  const diversified = mapFirm(firm("g", { ind: ["Diversified"], vert: [] }), index);
  assert.equal(diversified.generalist, true);
  assert.deepEqual(firmSectors(diversified, index), []);
  const many = mapFirm(firm("h", { ind: Array.from({ length: 15 }, (_, i) => `Industry ${i}`) }), index);
  assert.equal(many.generalist, true);
  assert.equal(many.generalistWhy, "Lists 15 industries");
});

test("HQ state is only read for US firms", () => {
  assert.equal(mapFirm(firm("i", { state: "Texas" }), index).status.hq_state, "normalized");
  const abroad = mapFirm(firm("j", { country: "Canada", state: "Ontario" }), index);
  assert.equal(abroad.status.hq_state, "missing");
  assert.ok(!abroad.issues.some((issue) => issue.field === "hq_state"));
});

test("relationships: same, undirected, directed one way, rejected ignored", () => {
  assert.equal(relationBetween(index, "sector.fintech", "sector.fintech")?.relation, "same");
  assert.equal(relationBetween(index, "sector.insurtech", "sector.fintech")?.relation, "immediate");
  assert.equal(relationBetween(index, "sector.fintech", "sector.web3")?.relation, "broad");
  assert.equal(relationBetween(index, "sector.web3", "sector.fintech"), null);
  assert.equal(relationBetween(index, "sector.fintech", "sector.healthtech"), null);
  assert.equal(relationBetween(index, "sector.software", "sector.fintech")?.review, "needs_review");
});

const db: FundDb = {
  firms: [
    firm("1"),
    firm("2", { name: "Fund 1", vert: ["Mystery"] }),
    firm("3", { web: "https://www.1.vc/team", vert: [], ind: ["Unknown Industry"] }),
    firm("4", { stages: [], web: "" }),
  ],
  contacts: [{ fid: "1" } as FundDb["contacts"][number]],
};

test("coverage separates populated from normalized and approved", () => {
  const mappings = db.firms.map((item) => mapFirm(item, index));
  const report = buildCoverage(db, index, mappings);
  const vertical = report.fields.find((field) => field.field === "vertical")!;
  assert.equal(vertical.populated, 3);
  assert.equal(vertical.normalized, 2);
  assert.equal(vertical.unmapped, 1);
  const stage = report.fields.find((field) => field.field === "stage")!;
  assert.equal(stage.populated, 3);
  assert.equal(report.firms, 4);
  assert.equal(report.reviewFirms, 2);
  assert.equal(report.duplicates.sameNameCount, 1);
  assert.deepEqual(report.duplicates.sameWebsite[0].firms.map((f) => f.id), ["1", "3"]);
  assert.equal(report.suspicious.noContacts, 3);
  assert.equal(report.suspicious.noWebsite, 1);
  assert.ok(report.values.some((row) => row.rawValue === "Unknown Industry" && row.state === "new"));
  assert.ok(report.conflicts.some((conflict) => conflict.rawValue === "Legacy"));
});

test("repeat processing: same input, same result; registered values are not new again", () => {
  const first = JSON.stringify(db.firms.map((item) => mapFirm(item, index)));
  const second = JSON.stringify(db.firms.map((item) => mapFirm(item, index)));
  assert.equal(first, second);

  const found = newRawValues(db, index);
  assert.deepEqual(found.map((value) => `${value.field}:${value.rawValue}`), ["industry:Unknown Industry"]);
  const registered = indexTaxonomy({
    ...taxonomy,
    aliases: [...taxonomy.aliases, ...found.map((value) => alias(value.field, value.rawValue, []))],
  });
  assert.deepEqual(newRawValues(db, registered), []);
});

test("raw value counts count each firm once per value", () => {
  const counts = countRawValues({ firms: [firm("x", { vert: ["Fintech", "fintech"] }), firm("y")], contacts: [] });
  assert.equal(counts.find((value) => value.field === "vertical" && value.rawKey === "fintech")?.firms, 2);
});
