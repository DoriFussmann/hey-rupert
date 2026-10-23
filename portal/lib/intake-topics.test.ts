import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_INTAKE_TOPICS, MATCHING_TOPICS, matchingUse, withMatchingTopics } from "./intake.ts";

test("every matching topic is a default topic", () => {
  const ids = new Set(DEFAULT_INTAKE_TOPICS.map((topic) => topic.id));
  for (const id of Object.keys(MATCHING_TOPICS)) assert.ok(ids.has(id), id);
  assert.equal(matchingUse("competitors"), null);
  assert.equal(matchingUse("raise"), "Stage");
  // Financing and investor types use the defaults: not asked, not locked.
  for (const id of ["round_terms", "investor_preferences"]) {
    assert.equal(matchingUse(id), null);
    assert.ok(!ids.has(id), id);
  }
  // A saved list keeps them until an admin removes them; they're never added back.
  const saved = [...DEFAULT_INTAKE_TOPICS, { id: "round_terms", title: "Round terms", guidance: "x", required: true }];
  assert.ok(withMatchingTopics(saved).some((topic) => topic.id === "round_terms"));
  assert.ok(!withMatchingTopics(DEFAULT_INTAKE_TOPICS).some((topic) => topic.id === "round_terms"));
});

test("matching topics can't be removed or made optional; others are kept as they are", () => {
  const edited = DEFAULT_INTAKE_TOPICS.filter((topic) => topic.id !== "sector" && topic.id !== "founder_links").map((topic) =>
    topic.id === "raise" || topic.id === "traction" ? { ...topic, required: false, title: `${topic.title}!` } : topic,
  );
  const kept = withMatchingTopics(edited);
  assert.ok(kept.some((topic) => topic.id === "sector" && topic.required));
  assert.ok(!kept.some((topic) => topic.id === "founder_links"));
  const raise = kept.find((topic) => topic.id === "raise")!;
  assert.equal(raise.required, true);
  assert.equal(raise.title, "The raise!");
  assert.equal(kept.find((topic) => topic.id === "traction")!.required, false);
  assert.equal(kept.at(-1)!.id, "sector");
  assert.deepEqual(withMatchingTopics(DEFAULT_INTAKE_TOPICS), DEFAULT_INTAKE_TOPICS);
});
