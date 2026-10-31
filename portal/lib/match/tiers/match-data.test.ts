import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firm, FundDb } from "../engine/index.mjs";
import { indexTaxonomy, rawKey, type TaxAlias, type TaxNode } from "../../taxonomy/core.ts";
import { matchDataHeader, matchDataRows } from "./match-data.ts";

function node(id: string, dimension: TaxNode["dimension"], label: string, kind = "x"): TaxNode {
  return { id, dimension, label, parentId: null, kind, description: "", synonyms: [], attrs: {}, status: "active", sort: 0 };
}

function alias(field: TaxAlias["field"], value: string, nodeIds: string[], extra: Partial<TaxAlias> = {}): TaxAlias {
  return {
    field, rawKey: rawKey(value), rawValue: value, nodeIds, state: nodeIds.length ? "mapped" : "unmapped",
    review: "approved", method: "seed", rationale: "", aiProposal: null, reviewedBy: null, reviewedAt: null, updatedAt: "", ...extra,
  };
}

const index = indexTaxonomy({
  revision: 1,
  nodes: [
    node("financing.equity", "financing", "Equity"),
    node("stage.pre_seed", "stage", "Pre-Seed"),
    node("stage.seed", "stage", "Seed"),
    node("geo.us", "geography", "United States"),
  ],
  aliases: [
    alias("financing", "Equity", ["financing.equity"]),
    alias("stage", "Early Stage", ["stage.pre_seed", "stage.seed"]),
    alias("stage", "Seed Round", ["stage.seed"], { review: "needs_review" }),
    alias("stage", "Whenever", [], { state: "ignored" }),
    alias("geography", "USA", ["geo.us"]),
  ],
  edges: [],
});

function firm(extra: Partial<Firm>): Firm {
  return {
    id: "F1", name: "Fund", type: "", region: "", year: null, stages: [], fin: [], ind: [], vert: [], geo: [],
    city: "", state: "", country: "", web: "", email: "", phone: "", nContacts: 0, offices: [], ...extra,
  };
}

test("each record: raw values and the categories they map to, split by review state", () => {
  const db = {
    firms: [
      firm({ id: "A", fin: ["Equity"], stages: ["Early Stage", "Seed Round", "Whenever", "Mystery"], geo: ["USA"] }),
      firm({ id: "A", name: "Fund again" }),
    ],
    contacts: [],
  } as unknown as FundDb;
  const header = matchDataHeader();
  const rows = matchDataRows(db, index, { A: "Closed" });
  const cell = (r: number, name: string) => rows[r][header.indexOf(name)];

  assert.equal(rows.length, 2);
  assert.equal(cell(0, "Row"), 1);
  assert.equal(cell(1, "Row"), 2);
  assert.equal(cell(0, "Hidden for all clients"), "Closed");
  assert.equal(cell(0, "Financing: approved"), "Equity");
  assert.equal(cell(0, "Stage: raw"), "Early Stage; Seed Round; Whenever; Mystery");
  assert.equal(cell(0, "Stage: approved"), "Pre-Seed; Seed");
  assert.equal(cell(0, "Stage: needs review"), "");
  assert.equal(cell(0, "Stage: not mapped or broken"), "Mystery");
  assert.equal(cell(0, "Stage: ignored"), "Whenever");
  assert.equal(cell(0, "Geography: approved"), "United States");
  assert.equal(cell(1, "Stage: raw"), "");
});

test("a category reached only through a needs-review value is listed as needs review", () => {
  const db = { firms: [firm({ stages: ["Seed Round"] })], contacts: [] } as unknown as FundDb;
  const header = matchDataHeader();
  const [row] = matchDataRows(db, index);
  assert.equal(row[header.indexOf("Stage: approved")], "");
  assert.equal(row[header.indexOf("Stage: needs review")], 'Seed ← "Seed Round"');
});
