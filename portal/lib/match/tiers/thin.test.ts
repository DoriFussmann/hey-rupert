import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_THIN_THRESHOLDS,
  optionsToTest,
  parseThresholds,
  runLimits,
  tallyRows,
  thinness,
  thresholdProblems,
} from "./thin.ts";
import type { StoredResult } from "./stored.ts";

function row(extra: Partial<StoredResult>): StoredResult {
  return { firmId: "F1", firmName: "Fund", status: "tiered", tier: "core", reasonCodes: [], detail: {}, score: 50, position: 0, ...extra };
}

test("thresholds: stored values, defaults for anything missing or invalid", () => {
  assert.deepEqual(parseThresholds(null), DEFAULT_THIN_THRESHOLDS);
  assert.deepEqual(parseThresholds('{"minCore":8,"minTotal":250}'), { minCore: 8, minTotal: 250 });
  assert.deepEqual(parseThresholds({ minCore: -1, minTotal: "40" }), { minCore: DEFAULT_THIN_THRESHOLDS.minCore, minTotal: 40 });
  assert.deepEqual(parseThresholds("not json"), DEFAULT_THIN_THRESHOLDS);
  assert.deepEqual(thresholdProblems({ minCore: 3, minTotal: 120 }), []);
  assert.equal(thresholdProblems({ minCore: 2.5, minTotal: "" }).length, 2);
});

test("tally counts listed funds only: not rejected, not shown through another record", () => {
  const rows = [
    row({ firmId: "A", tier: "core" }),
    row({ firmId: "B", tier: "tier4" }),
    row({ firmId: "C", tier: "tier4", detail: { rejected: { reason: "No" } } }),
    row({ firmId: "D", tier: "sphere", detail: { representedBy: "A" } }),
    row({ firmId: "E", status: "generalist", tier: null }),
  ];
  assert.deepEqual(tallyRows(rows), { core: 1, sphere: 0, tier3: 0, tier4: 1, total: 2 });
});

test("thinness: how far below each threshold", () => {
  const tallied = { core: 0, sphere: 0, tier3: 0, tier4: 107, total: 107 };
  assert.deepEqual(thinness(tallied, { minCore: 5, minTotal: 100 }), { thin: true, coreShort: 5, totalShort: 0 });
  assert.deepEqual(thinness(tallied, { minCore: 0, minTotal: 100 }), { thin: false, coreShort: 0, totalShort: 0 });
});

test("limits: the deciding reason of excluded and unresolved funds, most common first", () => {
  const rows = [
    row({ firmId: "1", status: "excluded", tier: null, reasonCodes: ["stage_one_off"] }),
    row({ firmId: "2", status: "excluded", tier: null, reasonCodes: ["stage_one_off"] }),
    row({ firmId: "3", status: "unresolved", tier: null, reasonCodes: ["geo_not_stated"] }),
    row({ firmId: "4", status: "excluded", tier: null, reasonCodes: ["geo_outside"], detail: { representedBy: "1" } }),
  ];
  assert.deepEqual(runLimits(rows), [
    { code: "stage_one_off", label: "One stage off", count: 2 },
    { code: "geo_not_stated", label: "Geography not stated", count: 1 },
  ]);
});

test("options: current setup first, both stage reaches each, no repeats", () => {
  const current = { primary: "sector.cannabis", secondary: [], stageReach: "exact" as const };
  const options = optionsToTest(current, [
    { primary: "sector.consumer", secondary: ["sector.cannabis", "sector.consumer"] },
    { primary: "sector.cannabis", secondary: [] },
  ]);
  assert.deepEqual(
    options.map((o) => `${o.primary}+${o.secondary.join(",")}:${o.stageReach}`),
    ["sector.cannabis+:exact", "sector.cannabis+:next", "sector.consumer+sector.cannabis:exact", "sector.consumer+sector.cannabis:next"],
  );
});
