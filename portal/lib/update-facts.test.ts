import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFactEdits, asFactEdits, textLeaves, type FactEdit } from "./update-facts.ts";

const narrative = {
  statement: {
    intro: "Aegis 360 is raising a $9.8M seed at a $45M opening pre.",
    points: [{ title: "Traction", claim: "- $250K signed.\n- Raising $9.8M seed." }],
  },
  client_email: { subject: "Your narrative for Aegis", body: "Hi Naga, the $9.8M seed is in." },
  finalized_at: "2026-11-20T05:04:53.653Z",
  links: ["https://example.com/a-long-link"],
};

const edit = (over: Partial<FactEdit>): FactEdit => ({
  target: "narrative",
  path: "statement/intro",
  find: "$9.8M seed at a $45M opening pre",
  replace: "$10M seed; terms set with the lead investor",
  reason: "Ask raised to $10M; no valuation.",
  source: "Client note, Nov 24",
  ...over,
});

test("only texts are offered, never ids, dates, links or skipped keys", () => {
  const paths = textLeaves(narrative, ["client_email"]).map((leaf) => leaf.path);
  // "Traction" is too short to hold a fact; the email, dates and links are left out.
  assert.deepEqual(paths, ["statement/intro", "statement/points/0/claim"]);
});

test("an exact edit is applied and nothing else changes", () => {
  const allowed = new Set(textLeaves(narrative, ["client_email"]).map((leaf) => leaf.path));
  const result = applyFactEdits(narrative, [edit({}), edit({ path: "statement/points/0/claim", find: "Raising $9.8M seed.", replace: "Raising a $10M seed." })], allowed);
  assert.equal(result.applied.length, 2);
  assert.equal(result.value.statement.intro, "Aegis 360 is raising a $10M seed; terms set with the lead investor.");
  assert.equal(result.value.statement.points[0].claim, "- $250K signed.\n- Raising a $10M seed.");
  assert.equal(result.value.statement.points[0].title, "Traction");
  assert.equal(result.value.client_email.body, narrative.client_email.body);
  assert.equal(narrative.statement.intro, "Aegis 360 is raising a $9.8M seed at a $45M opening pre.", "the original is not mutated");
});

test("edits that don't quote the text exactly, or touch other keys, are skipped", () => {
  const allowed = new Set(textLeaves(narrative, ["client_email"]).map((leaf) => leaf.path));
  const result = applyFactEdits(
    narrative,
    [edit({ find: "$9.8 million seed" }), edit({ path: "client_email/body", find: "$9.8M" }), edit({ path: "statement/nope" })],
    allowed,
  );
  assert.equal(result.applied.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.why), [
    "The words to replace were not found exactly.",
    "Not a text Update Facts may change.",
    "Not a text Update Facts may change.",
  ]);
  assert.deepEqual(result.value, narrative);
});

test("the AI's answer is cleaned: unknown targets and empty edits dropped", () => {
  const edits = asFactEdits(
    { edits: [edit({}), { ...edit({}), target: "website" }, { ...edit({}), find: "" }, "junk"] },
    new Set(["narrative"]),
  );
  assert.equal(edits.length, 1);
});
