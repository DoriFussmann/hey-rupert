import assert from "node:assert/strict";
import { test } from "node:test";
import { MATCH_TABS, asMatchTab, matchPath, verifyTierPath } from "./match/shared.ts";
import { VERIFY_MODES, cleanTierLimits, contactsForFunds, countTier, primaryContact, scopeLabel } from "./match/verify.ts";

const id = "11111111-2222-3333-4444-555555555555";

test("every matching link opens the Matching page, on the tab asked for (Plan by default)", () => {
  assert.equal(matchPath(id), `/admin/matching?client=${id}`);
  assert.equal(matchPath(id, "plan"), `/admin/matching?client=${id}`);
  assert.equal(matchPath(id, "tiers"), `/admin/matching?client=${id}&tab=tiers`);
  assert.equal(matchPath(id, "history"), `/admin/matching?client=${id}&tab=history`);
  assert.deepEqual([...MATCH_TABS], ["plan", "tiers", "verify", "outside", "near", "history"]);
  assert.equal(matchPath(id, "verify"), `/admin/matching?client=${id}&tab=verify`);
  assert.equal(verifyTierPath(id, "core"), `/admin/matching?client=${id}&tab=verify&tier=core`);
  assert.equal(asMatchTab("near"), "near");
  assert.equal(asMatchTab("capacity"), "plan");
  assert.equal(asMatchTab("compare"), "plan");
  assert.equal(asMatchTab(undefined), "plan");
});

test("verification limits are the four tiers only", () => {
  assert.deepEqual(cleanTierLimits({ core: 5, sphere: null, tier3: 0, bullseye: 3 }), { core: 5, sphere: null, tier3: 0, tier4: null });
  assert.equal(cleanTierLimits({ core: -1 }), null);
  assert.equal(cleanTierLimits({ tier4: 1.5 }), null);
});

test("verification limits count funds: a limit keeps every contact of the first funds", () => {
  // Core: fund 1 has 2 contacts, fund 2 has none with an email, fund 3 has 1.
  const core = { total: 3, fundEnds: [2, 2, 3], order: "crc", noEmail: 0 };
  assert.equal(contactsForFunds(core.fundEnds, null), null);
  assert.equal(contactsForFunds(core.fundEnds, 0), 0);
  assert.equal(contactsForFunds(core.fundEnds, 1), 2);
  assert.equal(contactsForFunds(core.fundEnds, 2), 2);
  assert.equal(contactsForFunds(core.fundEnds, 10), 3);
  assert.deepEqual(countTier(core, 1), { funds: 1, contacts: 2, toCheck: 1, reused: 1, flagged: 0 });
  assert.deepEqual(countTier(core, null), { funds: 3, contacts: 3, toCheck: 2, reused: 1, flagged: 0 });
  assert.deepEqual(countTier(core, 10), { funds: 3, contacts: 3, toCheck: 2, reused: 1, flagged: 0 });
  assert.deepEqual(countTier({ total: 0, fundEnds: [], order: "", noEmail: 0 }, 5), { funds: 0, contacts: 0, toCheck: 0, reused: 0, flagged: 0 });
});

test("Primary only checks one person per fund: the Primary, else the first in sequence", () => {
  assert.deepEqual(VERIFY_MODES, ["all", "sequence", "primary"]);
  assert.equal(primaryContact([{ seq: "Backup", id: 1 }, { seq: "Primary", id: 2 }])?.id, 2);
  assert.equal(primaryContact([{ id: 3 }])?.id, 3);
  assert.equal(primaryContact([]), null);
  assert.equal(scopeLabel("primary"), "Primary only");
  assert.equal(scopeLabel("sequence"), "Primary + Backup");
  assert.equal(scopeLabel("wave1"), "First wave");
});
