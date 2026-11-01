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
