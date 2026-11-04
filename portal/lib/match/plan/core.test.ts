import assert from "node:assert/strict";
import { test } from "node:test";
import { indexTaxonomy, type TaxEdge, type TaxNode } from "../../taxonomy/core.ts";
import { PLAN_DEFAULTS, sameStage, above, covered, placeFund, planCapacity, planInputProblems, tierKeys, tierRoster, waterfall, type RankInput } from "./core.ts";

function node(id: string, kind: string, parentId: string | null, granularity?: "broad" | "specific"): TaxNode {
  return { id, dimension: "sector", label: id.replace("sector.", ""), parentId, kind, description: "", synonyms: [], attrs: granularity ? { granularity } : {}, status: "active", sort: 0 };
}
function edge(fromId: string, toId: string, relation: TaxEdge["relation"] = "broad", review: TaxEdge["review"] = "needs_review"): TaxEdge {
  return { id: `${fromId}-${toId}`, fromId, toId, relation, directed: false, origin: "legacy", review, rationale: "", source: "", context: "", reviewedBy: null, reviewedAt: null };
}

const index = indexTaxonomy({
  revision: 1,
  nodes: [
    node("sector.grp.financial", "group", null),
    node("sector.grp.software", "group", null),
    node("sector.financial_services", "sector", "sector.grp.financial", "broad"),
    node("sector.fintech", "sector", "sector.grp.financial", "specific"),
    node("sector.insurtech", "sector", "sector.grp.financial", "specific"),
    node("sector.payments", "sector", "sector.fintech", "specific"), // nested under Fintech
    node("sector.software", "sector", "sector.grp.software", "broad"),
    node("sector.ai_ml", "sector", "sector.grp.software", "specific"),
    node("sector.saas", "sector", "sector.grp.software", "specific"),
  ],
  aliases: [],
  edges: [
    edge("sector.fintech", "sector.financial_services"),
    edge("sector.insurtech", "sector.financial_services"),
    edge("sector.fintech", "sector.software"), // another sector: not "above" Fintech
    edge("sector.ai_ml", "sector.software"),
    edge("sector.fintech", "sector.insurtech", "immediate"),
    edge("sector.saas", "sector.software", "broad", "rejected"),
  ],
});

const argentl = { primary: "sector.fintech", secondary1: "sector.ai_ml", secondary2: "sector.saas" };

test("above: the broad sub-sector in the same sector only; covered: the ones under it", () => {
  assert.deepEqual(Array.from(above(index, "sector.fintech")), ["sector.financial_services"]);
  assert.deepEqual(Array.from(above(index, "sector.payments")).sort(), ["sector.financial_services", "sector.fintech"]);
  assert.deepEqual(Array.from(covered(index, "sector.fintech")).sort(), ["sector.fintech", "sector.payments"]);
  assert.ok(covered(index, "sector.financial_services").has("sector.insurtech"));
  // A rejected relationship doesn't count.
  assert.equal(above(index, "sector.saas").size, 0);
});

test("placement follows the tier order", () => {
  const keys = tierKeys(index, argentl);
  const place = (...s: string[]) => placeFund(index, keys, s).tier;
  assert.equal(place("sector.fintech", "sector.ai_ml"), "core");
  assert.equal(place("sector.payments"), "core");
  assert.equal(place("sector.ai_ml", "sector.financial_services"), "sphere");
  assert.equal(place("sector.saas"), "tier3");
  assert.equal(place("sector.financial_services"), "tier4");
  assert.equal(place("sector.financial_services", "sector.insurtech"), "tier4");
  assert.equal(place("sector.insurtech"), "outside");
  assert.equal(place("sector.software"), "none");
  assert.equal(place(), "none");
});

test("ranking: backed at the client's stage, backed, look-alike, focus, contacts; no contact is not ranked", () => {
  const fund = (firmId: string, sectors: string[], contacts: number, backed: string[] = [], same: string[] = []): RankInput => ({ firmId, name: firmId, website: "", source: "dry", backed, sameStage: same, sectors, contacts });
  const profile = [{ sector: "fintech", share: 1 }, { sector: "ai_ml", share: 0.5 }];
  const ranked = tierRoster(index, argentl, [
    fund("broad", ["sector.fintech", "sector.ai_ml", "sector.saas", "sector.insurtech"], 2),
    fund("narrow1", ["sector.fintech"], 1),
    fund("narrow2", ["sector.fintech"], 2),
    fund("backer", ["sector.fintech", "sector.insurtech"], 1, ["Monk"]),
    fund("ghost", ["sector.fintech"], 0),
    fund("t4", ["sector.financial_services"], 2),
    fund("seedBacker", ["sector.fintech", "sector.saas", "sector.insurtech"], 1, ["Monk"], ["Monk"]),
  ], profile, 2);
  const core = ranked.filter((f) => f.tier === "core");
  assert.deepEqual(core.map((f) => [f.firmId, f.rank]), [["seedBacker", 1], ["backer", 2], ["narrow2", 3], ["narrow1", 4], ["broad", 5], ["ghost", 0]]);
  assert.ok(sameStage("Pre-Seed", "seed") && sameStage("Series A", "series a") && !sameStage("Seed", "Series A") && !sameStage("", ""));
});

test("capacity: contacts, flat warm-up", () => {
  assert.deepEqual(planInputProblems(PLAN_DEFAULTS), []);
  const c = planCapacity({ ...PLAN_DEFAULTS, warmupWeeks: 2, warmupPercent: 50 });
  assert.equal(c.dailyWarmup, 15);
  assert.equal(c.dailyNormal, 30);
  assert.equal(c.emailsPerContact, 2);
  assert.ok(c.contacts > 0 && c.contacts * 2 <= c.sends);
  const more = planCapacity({ ...PLAN_DEFAULTS, inboxes: 2 });
  assert.ok(more.contacts > c.contacts);
});

test("waterfall: Core in full first, then the next tiers, until the budget runs out", () => {
  const f = (firmId: string, tier: "core" | "sphere" | "tier4", rank: number, contacts: number) =>
    ({ firmId, name: firmId, website: "", source: "dry", tier, hit: [], backed: [], sameStage: [], lookAlike: 0, focus: 1, contacts, rank });
  const funds = [f("c1", "core", 1, 2), f("c2", "core", 2, 1), f("s1", "sphere", 1, 3), f("s2", "sphere", 2, 2), f("t1", "tier4", 1, 2)];
  const w = waterfall(funds, 6, 2);
  assert.deepEqual(w.planned.map((p) => [p.firmId, p.slots]), [["c1", 2], ["c2", 1], ["s1", 2], ["s2", 1]]);
  assert.equal(w.partial, "s2");
  assert.equal(w.plannedContacts, 6);
  const all = waterfall(funds, 100, 2);
  assert.equal(all.plannedContacts, 9);
  assert.equal(all.unused, 91);
});
