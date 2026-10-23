import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOUR_FIT_TIERS,
  addQuestion,
  asInvestorList,
  asNarrative,
  asQuestions,
  investorListIntro,
  isOpenQuestion,
  narrativeProblem,
  questionsOf,
  settleQuestion,
  tierStatsFor,
  withPublishedQuestions,
  workingNarrative,
  type InvestorRow,
  type SetupStepState,
} from "./setup.ts";

function row(published: unknown, extra: Partial<SetupStepState> = {}): SetupStepState {
  return {
    client_id: "c1",
    step: "investor_list",
    status: "with_client",
    draft: {},
    published,
    version: 2,
    published_at: null,
    response: null,
    history: [],
    turn_since: null,
    completed_at: null,
    client_viewed_at: null,
    client_checks: {},
    updated_at: "2026-10-23T00:00:00Z",
    ...extra,
  };
}

test("a question is added, answered or resolved, and never changes the rest of the version", () => {
  const added = addQuestion([], { id: "q1", question: "  Why this fund?  ", at: "t1", version: 2 });
  assert.ok(added.ok);
  assert.deepEqual(added.questions, [{ id: "q1", question: "Why this fund?", asked_at: "t1", version: 2 }]);
  assert.ok(isOpenQuestion(added.questions[0]));
  assert.equal(addQuestion([], { id: "q2", question: "   ", at: "t", version: 1 }).ok, false);

  const answered = settleQuestion(added.questions, "q1", "They lead seed rounds in your sector.", "t2")!;
  assert.equal(answered[0].answer, "They lead seed rounds in your sector.");
  assert.equal(answered[0].answered_at, "t2");
  assert.ok(!isOpenQuestion(answered[0]));

  const resolved = settleQuestion(added.questions, "q1", "", "t3")!;
  assert.equal(resolved[0].resolved_at, "t3");
  assert.equal(resolved[0].answer, undefined);
  assert.equal(settleQuestion(added.questions, "missing", "x", "t"), null);

  const published = { rows: [{ id: "f1", fund_name: "Acme Ventures", tier: 1 }], client_flags: { f1: { known: true } } };
  const stored = withPublishedQuestions(published, answered);
  assert.deepEqual(questionsOf(row(stored)), answered);
  // The list itself is untouched, and the parser keeps the questions.
  assert.equal(asInvestorList(stored).rows[0].fund_name, "Acme Ventures");
  assert.deepEqual(asInvestorList(stored).questions, answered);
  assert.equal("questions" in withPublishedQuestions(stored, []), false);
});

test("malformed stored questions are dropped", () => {
  assert.deepEqual(asQuestions([{ id: "", question: "x" }, { id: "a", question: "" }, "nope", null]), []);
  assert.equal(asQuestions([{ id: "a", question: "Q", version: "3" }])[0].version, 3);
});

test("excluding a fund lowers its tier's funds and contacts at once", () => {
  const rows: InvestorRow[] = [
    { id: "a", fund_name: "A", contact: "", details: "", tier: 1, why: "", comments: "", contact_count: 2 },
    { id: "b", fund_name: "B", contact: "", details: "", tier: 1, why: "", comments: "", contact_count: 3 },
    { id: "c", fund_name: "C", contact: "", details: "", tier: 4, why: "", comments: "", contact_count: 1, broad: true },
  ];
  const broad = { label: "Broad", detail: "Broad investors" };
  const before = tierStatsFor(rows, {}, FOUR_FIT_TIERS, null, broad);
  assert.deepEqual(before.map((s) => [s.tier, s.funds, s.contacts]), [[1, 2, 5], [2, 0, 0], [3, 0, 0], [4, 0, 0], ["broad", 1, 1]]);
  const after = tierStatsFor(rows, { b: { excluded: true }, c: { excluded: true } }, FOUR_FIT_TIERS, null, broad);
  assert.deepEqual(after.map((s) => [s.tier, s.funds, s.contacts]), [[1, 1, 2], [2, 0, 0], [3, 0, 0], [4, 0, 0], ["broad", 0, 0]]);
});

test("the list intro names the round, sector and place it is based on", () => {
  assert.equal(
    investorListIntro({ raise: "$3M", stage: "Seed", sector: "B2B SaaS", place: "California", funds: 42, tiers: 4 }),
    "Based on your $3M Seed raise in B2B SaaS, based in California, we identified 42 funds across four tiers.",
  );
  assert.equal(
    investorListIntro({ raise: "", stage: "", sector: "", place: "", funds: 1, tiers: 1 }),
    "Based on what you told us, we identified 1 fund across one tier.",
  );
});

test("the client confirms one short narrative; older versions without it still read", () => {
  const old = asNarrative({ core: "Story", key_messages: "- One", approach: "Lead with traction" });
  assert.equal(old.summary, "");
  assert.match(narrativeProblem(old) ?? "", /The Outreach Narrative/);
  assert.equal(narrativeProblem({ ...old, summary: "We build..." }), null);
});

test("an internal update to a confirmed narrative is what later steps use", () => {
  const published = { summary: "S", core: "Confirmed story", key_messages: "- K", approach: "A" };
  const draft = { ...published, internal_update: { at: "t", narrative: { ...published, core: "Updated story" } } };
  const confirmed = row(published, { step: "framing", status: "confirmed", draft });
  assert.equal(workingNarrative(confirmed).core, "Updated story");
  // Before the client confirms, or without an update, the published version is used.
  assert.equal(workingNarrative({ ...confirmed, status: "with_client" }).core, "Confirmed story");
  assert.equal(workingNarrative({ ...confirmed, draft: published }).core, "Confirmed story");
});
