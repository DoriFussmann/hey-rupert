import assert from "node:assert/strict";
import { test } from "node:test";
import type { DryData } from "../dry/core.ts";
import { checkInvestors, indexFirms, matchInvestor } from "./check.ts";
import { cleanInvestor } from "./investors.ts";

const firms = [
  { id: "F1", name: "Insight Partners", web: "https://www.insightpartners.com" },
  { id: "F2", name: "Footwork VC", web: "footwork.vc" },
  { id: "F3", name: "Acme Ventures", web: "acme.vc" },
  { id: "F4", name: "Acme Capital", web: "acmecapital.com" },
  { id: "F5", name: "Better Tomorrow Ventures", web: "btv.vc" },
];
const index = indexFirms(firms);

test("matching: website first, then name; two records with one name are unclear; similar names are suggestions", () => {
  assert.deepEqual(matchInvestor({ name: "Insight", website: "https://insightpartners.com/about" }, index), { how: "website", firmIds: ["F1"] });
  assert.deepEqual(matchInvestor({ name: "Footwork", website: "" }, index), { how: "name", firmIds: ["F2"] });
  assert.equal(matchInvestor({ name: "Acme", website: "" }, index).how, "ambiguous");
  assert.deepEqual(matchInvestor({ name: "Better Tomorrow", website: "" }, index), { how: "name", firmIds: ["F5"] });
  assert.deepEqual(matchInvestor({ name: "Tomorrow", website: "" }, index), { how: "similar", firmIds: ["F5"] });
  assert.equal(matchInvestor({ name: "Nobody Fund", website: "" }, index).how, "none");
  // "Capital One Ventures" shrinks to "one": too short to settle without the admin.
  const short = indexFirms([{ id: "S1", name: "One Capital", web: "" }]);
  assert.deepEqual(matchInvestor({ name: "Capital One Ventures", website: "" }, short), { how: "similar", firmIds: ["S1"] });
});

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
  labels: { geo: ["United States"], sector: ["Fintech"] },
  funds: [
    { id: "F1", name: "Insight Partners", fin: [0], stage: [2], geo: [0], bucket: [0], sector: [0], group: [0], generalist: false },
    { id: "F2", name: "Footwork VC", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [0], group: [0], generalist: false },
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
const inv = (id: string, name: string, kind = "fund") =>
  cleanInvestor({ id, name, kind, backed: [{ competitorId: "c1", competitor: "Monk", round: "Seed", lead: false, sourceUrl: "https://x.com/a" }] }, id)!;

test("buckets: in the shortlist; in the database but removed (with the filter and the fund's values); missing funds and angels; unclear", () => {
  const rows = checkInvestors({
    investors: [inv("i1", "Footwork"), inv("i2", "Insight Partners"), inv("i3", "Nobody Fund"), inv("i4", "Jane Doe", "angel"), inv("i5", "Acme")],
    firms,
    data,
    steps,
    shortlist: new Set(["F2"]),
    decisions: {},
  });
  assert.deepEqual(
    rows.map((r) => r.bucket),
    ["in_list", "not_in_list", "missing_fund", "missing_angel", "confirm"],
  );
  assert.deepEqual(rows[1].failure, { step: "stage", label: "Stage", fundValues: "Series B" });
  assert.deepEqual(rows[4].candidates.map((c) => c.id), ["F3", "F4"]);
});

test("decisions: the admin's record choice settles an unclear match; 'not in the database' moves it to missing", () => {
  const base = { firms, data, steps, shortlist: new Set(["F2"]) };
  const chosen = checkInvestors({ ...base, investors: [inv("i5", "Acme")], decisions: { i5: { firmId: "F3", by: null, at: "" } } });
  assert.equal(chosen[0].bucket, "not_in_list");
  assert.equal(chosen[0].firmName, "Acme Ventures");
  const none = checkInvestors({ ...base, investors: [inv("i2", "Insight Partners")], decisions: { i2: { firmId: null, by: null, at: "" } } });
  assert.equal(none[0].bucket, "missing_fund");
});

test("the admin's website: matched again by it; no record with it leaves the investor missing, with the website kept", () => {
  const base = { firms, data, steps, shortlist: new Set(["F2"]) };
  const found = checkInvestors({ ...base, investors: [inv("i5", "Acme")], decisions: { i5: { website: "https://acme.vc", by: null, at: "" } } });
  assert.equal(found[0].bucket, "not_in_list");
  assert.equal(found[0].firmName, "Acme Ventures");
  const missing = checkInvestors({ ...base, investors: [inv("i5", "Acme")], decisions: { i5: { website: "https://acme-ventures.io", by: null, at: "" } } });
  assert.equal(missing[0].bucket, "missing_fund");
  assert.equal(missing[0].investor.website, "https://acme-ventures.io");
  const settled = checkInvestors({
    ...base,
    investors: [inv("i5", "Acme")],
    decisions: { i5: { website: "https://acme-ventures.io", firmId: null, by: null, at: "" } },
  });
  assert.equal(settled[0].bucket, "missing_fund");
  assert.equal(settled[0].investor.website, "https://acme-ventures.io");
});

test("defaults: removed by sector only is brought back, removed by stage is left out; the admin's choice wins", () => {
  const sectorData: DryData = {
    ...data,
    labels: { geo: ["United States"], sector: ["AI/ML", "SaaS"] },
    funds: [
      // Footwork: Seed, US, Equity, but AI/ML and SaaS only: fails the Financial services group.
      { id: "F2", name: "Footwork VC", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [0, 1], group: [], generalist: false },
      { id: "F1", name: "Insight Partners", fin: [0], stage: [2], geo: [0], bucket: [0], sector: [], group: [0], generalist: false },
    ],
  };
  const base = {
    firms,
    data: sectorData,
    steps,
    shortlist: new Set<string>(),
    clientSectors: ["Fintech", "AI/ML"],
    competitorSectors: { c1: ["Fintech", "AI/ML"] },
  };
  const rows = checkInvestors({ ...base, investors: [inv("i1", "Footwork"), inv("i2", "Insight Partners")], decisions: {} });
  assert.equal(rows[0].failure?.step, "sector");
  assert.equal(rows[0].action, "bring_back");
  assert.equal(rows[0].defaulted, true);
  assert.deepEqual(rows[0].overlap, { client: ["AI/ML"], competitor: ["AI/ML"] });
  assert.equal(rows[1].failure?.step, "stage");
  assert.equal(rows[1].action, "leave_out");
  const decided = checkInvestors({ ...base, investors: [inv("i1", "Footwork")], decisions: { i1: { action: "leave_out", by: null, at: "" } } });
  assert.equal(decided[0].action, "leave_out");
  assert.equal(decided[0].defaulted, false);
});

test("sector-only: brought back only when the fund lists the client's sector (exact label); otherwise left out", () => {
  const sectorData: DryData = {
    ...data,
    labels: { geo: ["United States"], sector: ["AI/ML", "SaaS", "Consumer Tech"] },
    funds: [
      { id: "F2", name: "Footwork VC", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [0, 1], group: [], generalist: false },
      { id: "F5", name: "Better Tomorrow Ventures", fin: [0], stage: [1], geo: [0], bucket: [0], sector: [1, 2], group: [], generalist: false },
    ],
  };
  const rows = checkInvestors({
    firms,
    data: sectorData,
    steps,
    shortlist: new Set<string>(),
    clientSectors: ["Fintech", "AI/ML"],
    competitorSectors: { c1: ["Fintech", "AI/ML"] },
    investors: [inv("i1", "Footwork"), inv("i2", "Better Tomorrow Ventures")],
    decisions: {},
  });
  assert.equal(rows[0].action, "bring_back");
  // SaaS and Consumer Tech: none is the client's sector, so not brought back blind.
  assert.deepEqual(rows[1].overlap.client, []);
  assert.equal(rows[1].action, "leave_out");
});
