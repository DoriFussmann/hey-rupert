import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firm, FundDb } from "../engine/index.mjs";
import { indexTaxonomy, rawKey, type TaxAlias, type TaxNode } from "../../taxonomy/core.ts";
import { buildDryData, funnel, passes } from "./core.ts";

function node(id: string, dimension: TaxNode["dimension"], kind: string, parentId: string | null = null, attrs: Record<string, unknown> = {}): TaxNode {
  return { id, dimension, label: id, parentId, kind, description: "", synonyms: [], attrs, status: "active", sort: 0 };
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
    node("financing.equity", "financing", "x"),
    node("financing.debt", "financing", "x"),
    node("stage.pre_seed", "stage", "stage", null, { ladder: 0 }),
    node("stage.seed", "stage", "stage", null, { ladder: 1 }),
    node("stage.series_a", "stage", "stage", null, { ladder: 2 }),
    node("geo.north_america", "geography", "region"),
    node("geo.europe", "geography", "region"),
    node("geo.middle_east", "geography", "region"),
    node("geo.us", "geography", "country", "geo.north_america"),
    node("geo.canada", "geography", "country", "geo.north_america"),
    node("geo.israel", "geography", "country", "geo.middle_east"),
    node("geo.germany", "geography", "country", "geo.europe"),
    node("geo.us.northwest", "geography", "us_region", "geo.us"),
    node("sector.grp.financial", "sector", "group"),
    node("sector.grp.software", "sector", "group"),
    node("sector.grp.cross", "sector", "group"),
    node("sector.financial_services", "sector", "sector", "sector.grp.financial"),
    node("sector.fintech", "sector", "sector", "sector.grp.financial"),
    node("sector.software", "sector", "sector", "sector.grp.software"),
    node("sector.diversified", "sector", "generalist", "sector.grp.cross"),
  ],
  aliases: [
    alias("financing", "Equity", ["financing.equity"]),
    alias("financing", "Debt", ["financing.debt"]),
    alias("stage", "Pre-Seed", ["stage.pre_seed"]),
    alias("stage", "Seed", ["stage.seed"]),
    alias("stage", "Series A", ["stage.series_a"]),
    alias("geography", "United States", ["geo.us"]),
    alias("geography", "United States (Northwest)", ["geo.us.northwest"]),
    alias("geography", "Canada", ["geo.canada"]),
    alias("geography", "Israel", ["geo.israel"]),
    alias("geography", "Middle East", ["geo.middle_east"]),
    alias("geography", "Germany", ["geo.germany"]),
    alias("industry", "Financial Services", ["sector.financial_services"]),
    alias("industry", "Software", ["sector.software"]),
    alias("industry", "Diversified", ["sector.diversified"]),
    alias("vertical", "Fintech", ["sector.fintech"]),
    alias("vertical", "Later", ["sector.fintech"], { review: "needs_review" }),
  ],
  edges: [],
});

let seq = 0;
function firm(extra: Partial<Firm>): Firm {
  seq += 1;
  return {
    id: `F${seq}`, name: `Fund ${seq}`, type: "", region: "", year: null, stages: ["Seed"], fin: ["Equity"], ind: ["Financial Services"], vert: [],
    geo: ["United States"], city: "", state: "", country: "", web: "", email: "", phone: "", nContacts: 0, offices: [], ...extra,
  };
}

const profile = { financing: ["financing.equity"], stage: "stage.seed", hqCountry: "geo.us", primarySector: "sector.fintech" };

test("defaults come from the profile: Seed brings Pre-Seed, the US is its own choice, Fintech gives its group", () => {
  const data = buildDryData({ firms: [], contacts: [] } as unknown as FundDb, index, profile);
  assert.deepEqual(data.defaults.financing, ["financing.equity"]);
  assert.deepEqual(data.defaults.stage.sort(), ["stage.pre_seed", "stage.seed"]);
  assert.deepEqual(data.defaults.geography, ["us"]);
  assert.deepEqual(data.defaults.sector, ["sector.grp.financial"]);
  const de = buildDryData({ firms: [], contacts: [] } as unknown as FundDb, index, { ...profile, hqCountry: "geo.germany" });
  assert.deepEqual(de.defaults.geography, ["europe"]);
});

test("geography: a US region passes the US; Canada does not; the Middle East passes Israel; Germany passes Europe", () => {
  const funds = [
    firm({ geo: ["United States (Northwest)"] }),
    firm({ geo: ["Canada"] }),
    firm({ geo: ["Middle East"] }),
    firm({ geo: ["Germany"] }),
  ];
  const data = buildDryData({ firms: funds, contacts: [] } as unknown as FundDb, index, profile);
  const ok = (i: number, choice: string) => passes(data, data.funds[i], "geography", [choice]);
  assert.equal(ok(0, "us"), true);
  assert.equal(ok(1, "us"), false);
  assert.equal(ok(1, "canada"), true);
  assert.equal(ok(2, "israel"), true);
  assert.equal(ok(2, "middle_east"), true);
  assert.equal(ok(3, "europe"), true);
  assert.equal(ok(3, "us"), false);
});

test("stage: choosing Seed passes a Pre-Seed-only fund; Series A-only does not pass", () => {
  const data = buildDryData({ firms: [firm({ stages: ["Pre-Seed"] }), firm({ stages: ["Series A"] })], contacts: [] } as unknown as FundDb, index, profile);
  assert.equal(passes(data, data.funds[0], "stage", ["stage.seed"]), true);
  assert.equal(passes(data, data.funds[1], "stage", ["stage.seed"]), false);
});

test("sector group: a Fintech vertical passes without the Financial Services industry; needs-review values and Diversified don't count", () => {
  const funds = [
    firm({ ind: ["Software"], vert: ["Fintech"] }),
    firm({ ind: ["Software"], vert: ["Later"] }),
    firm({ ind: ["Diversified"] }),
  ];
  const data = buildDryData({ firms: funds, contacts: [] } as unknown as FundDb, index, profile);
  const ok = (i: number) => passes(data, data.funds[i], "sector", ["sector.grp.financial"]);
  assert.equal(ok(0), true);
  assert.equal(ok(1), false);
  assert.equal(ok(2), false);
  assert.equal(data.funds[2].generalist, true);
});

test("funnel: each confirmed step counts what it removed and what is left, in order", () => {
  const funds = [
    firm({}),
    firm({ fin: ["Debt"] }),
    firm({ stages: ["Series A"] }),
    firm({ geo: ["Germany"] }),
    firm({ ind: ["Software"] }),
    firm({ ind: ["Software"], vert: ["Fintech"] }),
  ];
  const data = buildDryData({ firms: funds, contacts: [] } as unknown as FundDb, index, profile);
  const steps = funnel(data, { ...data.defaults });
  assert.deepEqual(
    steps.map((s) => [s.step, s.before, s.removed, s.left]),
    [
      ["financing", 6, 1, 5],
      ["stage", 5, 1, 4],
      ["geography", 4, 1, 3],
      ["sector", 3, 1, 2],
    ],
  );
  assert.equal(funnel(data, { financing: ["financing.equity"] }).length, 1);
});
