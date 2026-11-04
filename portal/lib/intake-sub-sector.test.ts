import assert from "node:assert/strict";
import { test } from "node:test";
import { indexTaxonomy, type TaxEdge, type TaxNode } from "./taxonomy/core.ts";
import { asSubSectorPick, cleanChoice, pickFor, pickMessage, resolveSectorName } from "./intake-sub-sector.ts";

function node(id: string, label: string, kind: string, parentId: string | null, granularity?: "broad" | "specific", synonyms: string[] = []): TaxNode {
  return { id, dimension: "sector", label, parentId, kind, description: "", synonyms, attrs: granularity ? { granularity } : {}, status: "active", sort: 0 };
}
const broad = (fromId: string, toId: string): TaxEdge => ({
  id: `${fromId}-${toId}`, fromId, toId, relation: "broad", directed: false, origin: "legacy", review: "needs_review", rationale: "", source: "", context: "", reviewedBy: null, reviewedAt: null,
});

const index = indexTaxonomy({
  revision: 1,
  nodes: [
    node("sector.grp.financial", "Financial services", "group", null),
    node("sector.grp.software", "Software & IT", "group", null),
    node("sector.financial_services", "Financial Services", "sector", "sector.grp.financial", "broad"),
    node("sector.fintech", "Fintech", "sector", "sector.grp.financial", "specific", ["financial technology"]),
    node("sector.insurtech", "Insurtech", "sector", "sector.grp.financial", "specific"),
    node("sector.web3", "Web3", "sector", "sector.grp.financial", "specific"),
    node("sector.software", "Software", "sector", "sector.grp.software", "broad"),
    node("sector.saas", "SaaS", "sector", "sector.grp.software", "specific"),
    node("sector.diversified", "Diversified", "generalist", "sector.grp.software", "broad"),
  ],
  aliases: [],
  edges: [broad("sector.fintech", "sector.financial_services"), broad("sector.insurtech", "sector.financial_services"), broad("sector.saas", "sector.software")],
});

test("names resolve to sub-sectors first, then sectors", () => {
  assert.equal(resolveSectorName(index, "fintech")?.id, "sector.fintech");
  assert.equal(resolveSectorName(index, "Financial Technology")?.id, "sector.fintech");
  assert.equal(resolveSectorName(index, "financial services")?.id, "sector.financial_services");
  assert.equal(resolveSectorName(index, "Software & IT")?.id, "sector.grp.software");
  assert.equal(resolveSectorName(index, "pet food"), null);
});

test("the picker opens only for a sector or a broad sub-sector", () => {
  assert.equal(pickFor(index, ["Fintech"], "t"), null);
  assert.equal(pickFor(index, ["Financial Services", "SaaS"], "t"), null);
  const broadPick = pickFor(index, ["Financial Services"], "t")!;
  assert.deepEqual(broadPick.options.map((o) => o.label), ["Fintech", "Insurtech"]);
  const groupPick = pickFor(index, ["Software & IT"], "t")!;
  // Specific first, then broad; the generalist marker is never offered.
  assert.deepEqual(groupPick.options.map((o) => o.label), ["SaaS", "Software"]);
});

test("choices are limited to what was offered; messages read naturally", () => {
  const pick = { ...pickFor(index, ["Financial Services"], "t")!, suggestions: [{ id: "sector.web3", label: "Web3", why: "" }] };
  assert.deepEqual(cleanChoice(pick, ["sector.insurtech", "sector.saas", "sector.web3", "sector.insurtech"]).map((c) => c.id), ["sector.insurtech", "sector.web3"]);
  assert.match(pickMessage({ ...pick, status: "picked", chosen: [{ id: "sector.fintech", label: "Fintech" }] }), /sub-sector is Fintech/);
  assert.match(pickMessage({ ...pick, status: "unmatched", description: "AR automation" }), /own words: AR automation/);
  assert.equal(asSubSectorPick({ status: "nope" }), null);
  assert.equal(asSubSectorPick(pick)?.options.length, 2);
});
