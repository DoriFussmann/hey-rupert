import assert from "node:assert/strict";
import { test } from "node:test";
import { MATCH_TABS, asMatchTab, matchPath } from "./match/shared.ts";
import { cleanTierLimits } from "./match/verify.ts";

const id = "11111111-2222-3333-4444-555555555555";

test("every matching link opens the Matching page, on the tab asked for", () => {
  assert.equal(matchPath(id), `/admin/matching?client=${id}`);
  assert.equal(matchPath(id, "tiers"), `/admin/matching?client=${id}`);
  assert.equal(matchPath(id, "capacity"), `/admin/matching?client=${id}&tab=capacity`);
  assert.equal(matchPath(id, "history"), `/admin/matching?client=${id}&tab=history`);
  assert.deepEqual([...MATCH_TABS], ["tiers", "outside", "near", "capacity", "history"]);
  assert.equal(asMatchTab("near"), "near");
  assert.equal(asMatchTab("compare"), "tiers");
  assert.equal(asMatchTab(undefined), "tiers");
});

test("verification limits are the four tiers only", () => {
  assert.deepEqual(cleanTierLimits({ core: 5, sphere: null, tier3: 0, bullseye: 3 }), { core: 5, sphere: null, tier3: 0, tier4: null });
  assert.equal(cleanTierLimits({ core: -1 }), null);
  assert.equal(cleanTierLimits({ tier4: 1.5 }), null);
});
