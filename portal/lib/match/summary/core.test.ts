import assert from "node:assert/strict";
import { test } from "node:test";
import { landscapeSummary, matchingSummary, minus } from "./core.ts";
import type { CheckRow } from "../landscape/check.ts";
import type { Competitor } from "../landscape/core.ts";
import type { Investor } from "../landscape/investors.ts";

const competitor = (name: string): Competitor => ({
  id: name, name, website: `https://${name}.com/`, oneLiner: `${name} does AR`, hq: "NYC, US", stage: "Seed", geography: "United States",
  primarySector: "Fintech", secondarySectors: [], sectorsChecked: true, source: "web", why: "",
  funding: { totalRaised: "$10M", lastRound: "$5M Seed", lastRoundDate: "2025-04", investors: ["Acme VC"] },
  newsUrl: "https://news.com/a", newsTitle: "Raises $5M", links: { website: "live", news: "live" },
});
const investor = (id: string, name: string, kind: Investor["kind"] = "fund"): Investor => ({
  id, name, website: "", kind, source: "research", backed: [{ competitorId: "Monk", competitor: "Monk", round: "Seed", lead: true, sourceUrl: "" }],
});
const row = (inv: Investor, bucket: CheckRow["bucket"], firmId: string | null, action: CheckRow["action"] = null) =>
  ({ investor: inv, bucket, firmId, action, added: null }) as unknown as CheckRow;

const investors = [investor("a", "Acme VC"), investor("b", "Bolt"), investor("c", "Jane Doe", "angel")];
const rows = [row(investors[0], "in_list", "F1"), row(investors[1], "not_in_list", "F2", "bring_back"), row(investors[2], "missing_angel", null)];

test("the matching summary: one step per stage, clean numbers, (n) deductions", () => {
  const s = matchingSummary({
    clientName: "Argentl",
    dry: { totalFunds: 10172, fundCount: 1195, steps: [{ step: "financing", chosenLabels: ["Equity"], before: 10172, removed: 2567, left: 7605 }] },
    landscape: { competitors: [competitor("Monk")], investors },
    rows,
    roster: { dry: 1195, broughtBack: 1, added: 0, combined: 1196, excluded: 2, total: 1194, backed: 20, addedFailed: 0, addedMissing: 0, gone: 0 },
    plan: {
      inputs: { inboxes: 1, emailsPerInboxPerDay: 30, sendingDaysPerWeek: 5, warmupWeeks: 2, warmupPercent: 50, followUps: 1, followUpDelayDays: 7, contactsPerFund: 2, months: 2 },
      capacityContacts: 3,
      planned: [{ firmId: "F1", tier: "core", rank: 1, slots: 2 }, { firmId: "F2", tier: "core", rank: 2, slots: 1 }],
      funds: [
        { firmId: "F1", name: "Acme VC", website: "", source: "Dry Match", tier: "core", hit: [], backed: ["Monk"], sameStage: ["Monk"], lookAlike: 0.5, focus: 2, contacts: 2, rank: 1 },
        { firmId: "F2", name: "Bolt", website: "", source: "Brought back", tier: "core", hit: [], backed: ["Monk"], sameStage: [], lookAlike: 0.4, focus: 3, contacts: 2, rank: 2 },
      ],
    },
  });
  assert.deepEqual(s.steps.map((x) => x.button), ["Step 1", "Step 2A", "Step 2B", "Step 2C", "Step 2D", "Step 3", "Step 4"]);
  assert.equal(s.steps[0].tables[0].rows[1].removed, "(2,567)");
  assert.equal(minus(16), "(16)");
  const plan = s.steps[6];
  assert.equal(plan.headline?.value, 3);
  assert.equal(plan.tables[1].rows.length, 2);
  // Nothing about who confirmed or when.
  assert.ok(!JSON.stringify(s).match(/confirmed|@|20\d\d-\d\d-\d\dT/i));
});

test("the landscape overview: competitors with sources, and who is on the outreach list", () => {
  const s = landscapeSummary({ clientName: "Argentl", competitors: [competitor("Monk")], investors, rows, outreach: new Set(["F1"]) });
  assert.deepEqual(s.steps.map((x) => x.button), ["Competitors", "Their Investors"]);
  assert.deepEqual(s.steps[0].tables[0].rows[0].source, { text: "Raises $5M", href: "https://news.com/a" });
  const list = s.steps[1].tables[0].rows.map((r) => [typeof r.name === "object" ? r.name.text : r.name, r.outreach]);
  assert.deepEqual(list, [["Acme VC", "Yes"], ["Bolt", "No"], ["Jane Doe", "No"]]);
});
