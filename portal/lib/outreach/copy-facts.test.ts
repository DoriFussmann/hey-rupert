import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignFacts, campaignFactsText } from "./copy-facts.ts";

const row = (id: string, tier: 1 | 2 | 3 | 4, contact_count: number) => ({ id, fund_name: id, contact: "", details: "", tier, why: "", comments: "", fund_type: "VC", contact_count });

test("investors to email follow the plan's contacts per fund; known funds are left out unless put back", () => {
  const list = {
    rows: [row("a", 1, 5), row("b", 1, 1), row("c", 2, 4), row("d", 3, 3)],
    client_flags: { d: { known: true } },
    contacts_per_firm: 3,
  };
  const facts = campaignFacts(list, new Set(), null);
  assert.equal(facts.funds, 3);
  assert.equal(facts.perFirm, 3);
  assert.equal(facts.investors, 3 + 1 + 3);
  assert.equal(facts.knownLeftOut, 1);
  assert.deepEqual(facts.byTier.map((t) => [t.label, t.funds, t.investors]), [["Core", 2, 4], ["Sphere", 1, 3]]);
  const back = campaignFacts(list, new Set(["d"]), null);
  assert.equal(back.funds, 4);
  assert.match(campaignFactsText(facts), /up to 3/);
  assert.match(campaignFactsText(campaignFacts({ ...list, contacts_per_firm: undefined }, new Set(), null)), /up to 2/);
});
