import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BRIEF_SECTION_KEYS,
  DECK_TOPICS,
  applyProposal,
  asDeck,
  asProposals,
  asSections,
  briefQuestions,
  deckFeedbackMarkdown,
  emptySections,
  stripCitations,
  topTopics,
} from "./brief.ts";

test("the brief has six sections and twenty deck topics, each with a playbook", () => {
  assert.deepEqual(BRIEF_SECTION_KEYS, ["matching", "facts", "framing", "objections", "questions", "fit"]);
  assert.equal(DECK_TOPICS.length, 20);
  assert.equal(new Set(DECK_TOPICS.map((topic) => topic.id)).size, 20);
  for (const topic of DECK_TOPICS) assert.ok(topic.playbook.length > 200, topic.id);
  // The structure playbook carries the references Dori chose.
  assert.match(DECK_TOPICS[0].playbook, /Sequoia/);
  assert.match(DECK_TOPICS[0].playbook, /Y Combinator/);
});

test("stored sections and deck feedback are read defensively", () => {
  const sections = asSections({ framing: "Founder-led.", junk: "x", facts: 42 });
  assert.equal(sections.framing, "Founder-led.");
  assert.equal(sections.facts, "");
  assert.ok(!("junk" in sections));

  const deck = asDeck({
    scores: [{ topic: "team", score: 14, reason: "No team slide" }, { topic: "nope", score: 5 }],
    chosen: ["team", "team", "nope", "evidence", "market", "the_ask"],
    writeups: { team: "Add a team slide.", nope: "x" },
  });
  assert.deepEqual(deck.scores, [{ topic: "team", score: 10, reason: "No team slide" }]);
  assert.deepEqual(deck.chosen, ["team", "evidence", "market"]);
  assert.deepEqual(deck.writeups, { team: "Add a team slide." });
});

test("the top three topics are the highest scores, ties in library order", () => {
  const scores = [
    { topic: "market", score: 6, reason: "" },
    { topic: "team", score: 9, reason: "" },
    { topic: "consistency", score: 9, reason: "" },
    { topic: "structure", score: 6, reason: "" },
    { topic: "verbose", score: 2, reason: "" },
  ];
  assert.deepEqual(topTopics(scores), ["team", "consistency", "structure"]);
});

test("the founder's feedback is the chosen topics, numbered, in the chosen order", () => {
  const md = deckFeedbackMarkdown({
    scores: [],
    chosen: ["team", "the_ask", "market"],
    writeups: { team: "Name the exits.", the_ask: "Say the instrument.", market: "  " },
    scored_at: null,
  });
  assert.equal(md, "### 1. Team\n\nName the exits.\n\n### 2. No clear ask\n\nSay the instrument.");
});

test("questions are read one per line, bullets or numbers stripped", () => {
  assert.deepEqual(briefQuestions("- What did the two customers get out of it?\n2) May we name them?\n\n- ok\n• Which eight funds?"), [
    "What did the two customers get out of it?",
    "May we name them?",
    "Which eight funds?",
  ]);
});

test("pinning a proposal replaces or appends to one section", () => {
  const sections = { ...emptySections(), framing: "Product-led." };
  const [replace, append, bad] = asProposals([
    { section: "framing", mode: "replace", content: "Founder-led.", why: "His exit." },
    { section: "objections", mode: "append", content: "- No CTO: defendable." },
    { section: "nowhere", content: "x" },
  ]);
  assert.equal(bad, undefined);
  assert.equal(applyProposal(sections, replace).framing, "Founder-led.");
  const appended = applyProposal({ ...sections, objections: "- Thin traction." }, append);
  assert.equal(appended.objections, "- Thin traction.\n\n- No CTO: defendable.");
  assert.equal(applyProposal(sections, append).objections, "- No CTO: defendable.");
});

test("citation markup from web search is removed, the cited text kept", () => {
  assert.equal(
    stripCitations('ACT was sold in 2021 (<cite index="7-2">TSI announced it had completed the acquisition</cite>).'),
    "ACT was sold in 2021 (TSI announced it had completed the acquisition).",
  );
  assert.equal(asSections({ facts: 'Founded <cite index="1-1">2026</cite>.' }).facts, "Founded 2026.");
});
