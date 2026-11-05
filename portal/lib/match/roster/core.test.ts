import assert from "node:assert/strict";
import { test } from "node:test";
import type { DryData } from "../dry/core.ts";
import { checkInvestors } from "../landscape/check.ts";
import { cleanInvestor } from "../landscape/investors.ts";
import { buildRoster, exclusionLines } from "./core.ts";

const firms = [
  { id: "F1", name: "Alpha Ventures", web: "alpha.vc" },
  { id: "F2", name: "Beta Capital", web: "beta.com" },
  { id: "F3", name: "Gamma Partners", web: "gamma.vc" },
  { id: "F4", name: "FutureSight", web: "futuresight.com" },
  { id: "RUP-1", name: "Delta Fund", web: "delta.vc" },
  { id: "RUP-2", name: "Epsilon VC", web: "epsilon.vc" },
  { id: "RUP-3", name: "Zeta Ventures", web: "zeta.vc" },
  { id: "RUP-4", name: "Eta Capital", web: "eta.vc" },
];

// Labels: 0 Fintech (the client's group), 1 AI/ML (the client's secondary), 2 Biotech.
const data: DryData = {
  options: {
    financing: [{ id: "financing.equity", label: "Equity" }],
    stage: [
      { id: "stage.pre_seed", label: "Pre-Seed" },
      { id: "stage.seed", label: "Seed" },
      { id: "stage.series_b", label: "Series B" },
    ],
    geography: [{ id: "us", label: "United States" }],
    sector: [{ id: "sector.grp.financial", label: "Financial services" }],
  },
  labels: { geo: ["United States"], sector: ["Fintech", "AI/ML", "Biotech"] },
  funds: [
    { id: "F1", name: "Alpha Ventures", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [0], group: [0], generalist: false },
    { id: "F2", name: "Beta Capital", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [0], group: [0], generalist: false },
    // Gamma: in the database, removed by sector, lists AI/ML: brought back in 2C.
    { id: "F3", name: "Gamma Partners", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [1], group: [], generalist: false },
    { id: "F4", name: "FutureSight", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [0], group: [0], generalist: false },
    // Added: Delta passes; Epsilon fails on sector but lists AI/ML; Zeta is Series B only; Eta has no stage.
    { id: "RUP-1", name: "Delta Fund", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [0], group: [0], generalist: false },
    { id: "RUP-2", name: "Epsilon VC", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [1], group: [], generalist: false },
    { id: "RUP-3", name: "Zeta Ventures", fin: [0], stage: [2], geo: [0], bucket: [0], sector: [0], group: [0], generalist: false },
    { id: "RUP-4", name: "Eta Capital", fin: [0], stage: [], geo: [0], bucket: [0], sector: [2], group: [], generalist: false },
  ],
  defaults: { financing: [], stage: [], geography: [], sector: [] },
  defaultsFrom: { financing: "", stage: "", geography: "", sector: "" },
};
const steps = [
  { step: "financing" as const, chosen: ["financing.equity"] },
  { step: "stage" as const, chosen: ["stage.seed"] },
  { step: "geography" as const, chosen: ["us"] },
  { step: "sector" as const, chosen: ["sector.grp.financial"] },
];
const inv = (id: string, name: string, competitor = "Monk") =>
  cleanInvestor({ id, name, kind: "fund", backed: [{ competitorId: "c1", competitor, round: "Seed", lead: false, sourceUrl: "https://x.com/a" }] }, id)!;

const rows = checkInvestors({
  investors: [inv("i1", "Alpha Ventures"), inv("i3", "Gamma Partners", "Ramp"), inv("i5", "Delta Fund")],
  firms,
  data,
  steps,
  shortlist: new Set(["F1", "F2", "F4"]),
  decisions: {},
  clientSectors: ["Fintech", "AI/ML"],
  added: { i5: { id: "a1", firmId: "RUP-1", status: "pending", contacts: 2, website: "delta.vc" } },
});

const added = [
  { id: "a1", firmId: "RUP-1", name: "Delta Fund", kind: "fund" as const, status: "pending" as const },
  { id: "a2", firmId: "RUP-2", name: "Epsilon VC", kind: "fund" as const, status: "approved" as const },
  { id: "a3", firmId: "RUP-3", name: "Zeta Ventures", kind: "fund" as const, status: "pending" as const },
  { id: "a4", firmId: "RUP-4", name: "Eta Capital", kind: "angel" as const, status: "pending" as const },
  { id: "a5", firmId: "RUP-9", name: "Gone Fund", kind: "fund" as const, status: "rejected" as const },
];

test("the roster: shortlist, brought back, added that pass; sources and the competitors each backed", () => {
  const roster = buildRoster({ data, firms, steps, shortlist: ["F1", "F2", "F4"], rows, added, clientSectors: ["Fintech", "AI/ML"], exclusions: "" });
  assert.deepEqual(
    roster.entries.map((e) => [e.firmId, e.source]),
    [
      ["F1", "dry"],
      ["F2", "dry"],
      ["F4", "dry"],
      ["F3", "brought_back"],
      ["RUP-1", "added"],
      ["RUP-2", "added"],
    ],
  );
  assert.deepEqual(roster.entries.find((e) => e.firmId === "F1")?.backed, ["Monk"]);
  assert.deepEqual(roster.entries.find((e) => e.firmId === "F3")?.backed, ["Ramp"]);
  assert.deepEqual(roster.entries.find((e) => e.firmId === "RUP-1")?.backed, ["Monk"]);
  assert.deepEqual(roster.entries.find((e) => e.firmId === "F2")?.backed, []);
  assert.equal(roster.counts.backed, 3);
});

test("added investors: the four filters, the 2C rule, missing fields block, rejected ones are left out", () => {
  const roster = buildRoster({ data, firms, steps, shortlist: ["F1"], rows: [], added, clientSectors: ["Fintech", "AI/ML"], exclusions: "" });
  const by = Object.fromEntries(roster.added.map((a) => [a.firmId, a]));
  assert.equal(by["RUP-1"].result, "pass");
  assert.equal(by["RUP-2"].result, "secondary");
  assert.equal(by["RUP-3"].result, "fail");
  assert.equal(by["RUP-3"].reason, "Stage: Series B.");
  assert.equal(by["RUP-4"].result, "missing");
  assert.deepEqual(by["RUP-4"].missing, ["stage"]);
  assert.equal(by["RUP-9"], undefined);
  assert.equal(roster.counts.added, 2);
  assert.equal(roster.counts.addedFailed, 1);
  assert.equal(roster.counts.addedMissing, 1);
});

test("exclusions: a clear match only; notes and unknown names are shown and ignored", () => {
  const text = "FutureSight\nInvestor speed\nall said they were interested during the pitch\n8 investors from the speed-dating session (fund names not provided): keep out; gamma.vc; Zeta";
  const roster = buildRoster({ data, firms, steps, shortlist: ["F1", "F2", "F4"], rows, added, clientSectors: ["Fintech", "AI/ML"], exclusions: text });
  const by = Object.fromEntries(roster.exclusions.map((e) => [e.line, e.result]));
  assert.equal(by["FutureSight"], "excluded");
  assert.equal(by["gamma.vc"], "excluded");
  assert.equal(by["Investor speed"], "not_matched");
  assert.equal(by["all said they were interested during the pitch"], "not_matched");
  // Zeta is in the database but failed its filters, so it isn't on the Roster anyway.
  assert.equal(by["Zeta"], "not_on_roster");
  assert.equal(roster.entries.some((e) => e.firmId === "F4" || e.firmId === "F3"), false);
  assert.equal(roster.counts.combined, 6);
  assert.equal(roster.counts.excluded, 2);
  assert.equal(roster.counts.total, 4);
});

test("exclusion lines: split like the engine, trimmed, no duplicates", () => {
  assert.deepEqual(exclusionLines("A Fund, b fund;\n\nA fund\nx"), ["A Fund", "b fund"]);
});

test("funds added by hand: on the Roster whatever the filters say, still subject to exclusions", () => {
  const manual = [
    { firmId: "RUP-3", kind: "fund" as const }, // Series B only: fails Step 1, on the Roster anyway
    { firmId: "RUP-4", kind: "angel" as const }, // no stage: on the Roster anyway
    { firmId: "RUP-404", kind: "fund" as const }, // not in the database: left out
  ];
  const roster = buildRoster({ data, firms, steps, shortlist: ["F1"], rows: [], added: [], manual, clientSectors: ["Fintech"], exclusions: "eta.vc" });
  assert.deepEqual(
    roster.entries.map((e) => [e.firmId, e.source, e.addedStatus]),
    [
      ["F1", "dry", null],
      ["RUP-3", "added", "approved"],
    ],
  );
  assert.equal(roster.exclusions[0].result, "excluded");
});
