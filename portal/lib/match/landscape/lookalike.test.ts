import assert from "node:assert/strict";
import { test } from "node:test";
import { lookAlikeScore, lookAlikes, sectorProfile } from "./lookalike.ts";

const seeds = [
  { id: "S1", name: "Footwork", sectors: ["AI/ML", "SaaS", "Software"] },
  { id: "S2", name: "BTV", sectors: ["Fintech", "Financial Services", "SaaS"] },
  { id: "S3", name: "Seed fund", sectors: ["Fintech", "AI/ML", "SaaS"] },
];

test("profile: each sector's share of the seed funds", () => {
  const profile = sectorProfile(seeds);
  assert.deepEqual(profile[0], { sector: "SaaS", share: 1 });
  assert.deepEqual(
    profile.slice(1, 3).map((p) => p.sector),
    ["AI/ML", "Fintech"],
  );
  assert.equal(sectorProfile([]).length, 0);
});

test("score: a focused fund in the profile's sectors beats a broad generalist listing them among many", () => {
  const profile = sectorProfile(seeds);
  const focused = lookAlikeScore(["Fintech", "SaaS", "AI/ML"], profile);
  const broad = lookAlikeScore(["Fintech", "SaaS", "AI/ML", "Biotechnology", "Energy", "Retail", "Media", "Food", "Pharma", "Education"], profile);
  const off = lookAlikeScore(["Biotechnology", "Pharma"], profile);
  assert.ok(focused.score > broad.score, `${focused.score} vs ${broad.score}`);
  assert.equal(off.score, 0);
  assert.deepEqual(focused.shares, ["SaaS", "AI/ML", "Fintech"]);
});

test("look-alikes: seeds left out, zero scores dropped, best first", () => {
  const { funds } = lookAlikes(seeds, [
    { id: "S1", name: "Footwork", sectors: ["AI/ML", "SaaS"] },
    { id: "C1", name: "Close", sectors: ["Fintech", "SaaS"] },
    { id: "C2", name: "Far", sectors: ["Biotechnology"] },
    { id: "C3", name: "Partial", sectors: ["SaaS", "Healthtech", "Biotechnology"] },
  ]);
  assert.deepEqual(
    funds.map((f) => f.id),
    ["C1", "C3"],
  );
});
