import assert from "node:assert/strict";
import { test } from "node:test";
import { investorListEmailText } from "./investor-list-email.ts";
import {
  asEmailCopy,
  asInvestorList,
  emailCopyProblems,
  emptyEmailCopy,
  fitTiersFor,
  investorListForClient,
  tierCounts,
  tierEmails,
} from "./setup.ts";

// Rollback safety: lists and copy already pushed or sent keep the tiers they
// were made with, whichever engine is in use now.

const row = (id: string, tier: number) => ({ id, fund_name: `Fund ${id}`, contact: "", details: "VC", tier, why: "", comments: "" });

test("a list without a scheme marker is a three-tier list, read as before", () => {
  const list = asInvestorList({ rows: [row("A", 1), row("B", 2), row("C", 3), row("D", 4)], source_file: "Rupert Match · 2026-09-01" });
  assert.equal(list.tier_scheme, undefined);
  assert.equal("run_id" in list, false);
  // A tier outside 1–3 was always read as Expansion.
  assert.deepEqual(list.rows.map((r) => r.tier), [1, 2, 3, 3]);
  assert.deepEqual(tierCounts(list.rows).map((t) => t.tier), [1, 2, 3]);
  assert.deepEqual(fitTiersFor(list.tier_scheme).map((t) => t.label), ["Bullseye", "Match", "Expansion"]);
  // Parsing again changes nothing.
  assert.deepEqual(asInvestorList(investorListForClient(list)), list);
});

test("a four-tier list keeps Tier 4, its run and its rules through every save", () => {
  const raw = {
    rows: [row("A", 1), row("B", 4)],
    source_file: "Rupert Match · four-tier · 2026-10-21",
    tier_scheme: "four",
    run_id: "71f2de36-0000-4000-8000-000000000000",
    rules_version: "tiers-2026-10.2",
    summary: { generated_at: "x", tiers: [1, 2, 3, 4].map((tier) => ({ tier, funds: 1, contacts: 1, by_type: [] })) },
  };
  const list = asInvestorList(raw);
  assert.equal(list.tier_scheme, "four");
  assert.equal(list.run_id, raw.run_id);
  assert.equal(list.rules_version, raw.rules_version);
  assert.deepEqual(list.rows.map((r) => r.tier), [1, 4]);
  assert.deepEqual(list.summary!.tiers.map((t) => t.tier), [1, 2, 3, 4]);
  assert.deepEqual(asInvestorList(investorListForClient(list)), list);
  assert.deepEqual(fitTiersFor(list.tier_scheme).map((t) => t.label), ["Core", "Sphere", "Tier 3", "Tier 4"]);
  // A malformed run id is dropped, never kept as text.
  assert.equal(asInvestorList({ ...raw, run_id: "not a run" }).run_id, undefined);
});

test("email copy keeps its own tiers: three without a marker, four with one", () => {
  const three = asEmailCopy({ tiers: { "1": [{ subject: "s", body: "b" }], "4": [{ subject: "x", body: "y" }] } });
  assert.equal(three.tier_scheme, undefined);
  assert.deepEqual(Object.keys(three.tiers), ["1", "2", "3"]);
  assert.match(emailCopyProblems(three).join(" "), /Match: First email has no body/);

  const four = asEmailCopy({ tier_scheme: "four", tiers: { "4": [{ subject: "s", body: "b" }, { subject: "", body: "b" }, { subject: "", body: "b" }] } });
  assert.equal(four.tier_scheme, "four");
  assert.deepEqual(Object.keys(four.tiers), ["1", "2", "3", "4"]);
  assert.equal(tierEmails(four, 4)[0].subject, "s");
  const problems = emailCopyProblems(four).join(" ");
  assert.match(problems, /Core: the first email needs a subject/);
  assert.doesNotMatch(problems, /Tier 4/);
  assert.deepEqual(Object.keys(emptyEmailCopy("four").tiers), ["1", "2", "3", "4"]);
  assert.deepEqual(emptyEmailCopy(), { tiers: emptyEmailCopy("three").tiers });
});

test("the investor-list email names the list's own tiers", () => {
  const base = { company: "Co", clientFirstName: "Ana", adminName: "Dori", portalUrl: "https://x.test" };
  const three = investorListEmailText({ ...base, list: asInvestorList({ rows: [row("A", 1), row("B", 3)] }) }).text;
  assert.match(three, /Bullseye: 1 funds/);
  assert.match(three, /start with Bullseye/);
  assert.doesNotMatch(three, /Core/);
  const four = investorListEmailText({ ...base, list: asInvestorList({ tier_scheme: "four", rows: [row("A", 1), row("B", 4)] }) }).text;
  assert.match(four, /Core: 1 funds/);
  assert.match(four, /Tier 4: 1 funds/);
  assert.match(four, /narrowed it to 2 funds/);
  assert.match(four, /start with Core/);
  assert.doesNotMatch(four, /Bullseye/);
});
