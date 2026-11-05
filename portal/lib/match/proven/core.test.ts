import assert from "node:assert/strict";
import { test } from "node:test";
import { proofByFirm, proofNotes, provenRevision, stagesFromRound, withProof } from "./core.ts";

test("stagesFromRound: the stages a round's text names", () => {
  assert.deepEqual(stagesFromRound("$4M Seed (led) and $17M Series A"), ["Seed", "Series A"]);
  assert.deepEqual(stagesFromRound("€1M Pre-Seed"), ["Pre-Seed"]);
  assert.deepEqual(stagesFromRound("$15M Pre-seed/Seed"), ["Pre-Seed", "Seed"]);
  assert.deepEqual(stagesFromRound("~US$40M Series C growth round (Nov 2022)"), ["Series C and Beyond", "Growth Equity"]);
  assert.deepEqual(stagesFromRound("$100M Series D"), ["Series C and Beyond"]);
  assert.deepEqual(stagesFromRound("Seed (YC W20)"), ["Seed"]);
  assert.deepEqual(stagesFromRound("Undisclosed"), []);
  assert.deepEqual(stagesFromRound("$6.0M secured convertible debenture financing"), []);
});

const rows = [
  { firmId: "F1", company: "LeafLink", sectors: ["Cannabis", "SaaS"], round: "$4M Seed" },
  { firmId: "F1", company: "Nabis", sectors: ["Cannabis"], round: "$17M Series B" },
  { firmId: "F2", company: "Ramp", sectors: ["Fintech"], round: "Undisclosed" },
];

test("withProof: adds what the investments prove, never removes, no duplicates", () => {
  const firms = [
    { id: "F1", name: "BoxGroup", stages: ["Seed"], ind: ["Software"], vert: ["E-commerce"] },
    { id: "F2", name: "Other", stages: [], ind: [], vert: ["fintech"] },
    { id: "F3", name: "Untouched", stages: ["Seed"], ind: [], vert: [] },
  ];
  const field = (l: string) => (l === "SaaS" ? "industry" : l === "Unknown" ? null : "vertical") as "industry" | "vertical" | null;
  const out = withProof(firms, proofByFirm(rows), (_f, l) => l, field);
  assert.deepEqual(out[0].stages, ["Seed", "Series B"]);
  assert.deepEqual(out[0].vert, ["E-commerce", "Cannabis"]);
  assert.deepEqual(out[0].ind, ["Software", "SaaS"]);
  // Already listed (any case): not added twice.
  assert.deepEqual(out[1].vert, ["fintech"]);
  assert.equal(out[2], firms[2]);
});

test("proofNotes and the revision", () => {
  assert.deepEqual(proofNotes(proofByFirm(rows).get("F1")), ["Cannabis (backed LeafLink, Nabis)", "SaaS (backed LeafLink)", "Seed (backed LeafLink)", "Series B (backed Nabis)"]);
  assert.equal(provenRevision([]), "");
  assert.equal(provenRevision(rows), provenRevision([...rows].reverse()));
});
