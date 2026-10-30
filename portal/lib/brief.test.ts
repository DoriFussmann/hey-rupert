import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DECK_TOPICS,
  DEFAULT_BRIEF_TOPICS,
  SELLING_POINTS,
  abstractBullets,
  asPoints,
  briefKeys,
  briefText,
  parseBriefTopics,
  topPoints,
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

test("the brief: abstract, fourteen deck-structure topics, questions; ten selling points; twenty deck topics", () => {
  assert.equal(DEFAULT_BRIEF_TOPICS.length, 14);
  assert.deepEqual(briefKeys(DEFAULT_BRIEF_TOPICS).slice(0, 3), ["abstract", "purpose", "problem"]);
  assert.equal(briefKeys(DEFAULT_BRIEF_TOPICS).at(-1), "questions");
  for (const topic of DEFAULT_BRIEF_TOPICS) assert.ok(topic.guidance.length > 20, topic.id);
  assert.equal(SELLING_POINTS.length, 10);
  assert.equal(DECK_TOPICS.length, 20);
  assert.equal(new Set(DECK_TOPICS.map((topic) => topic.id)).size, 20);
  for (const topic of DECK_TOPICS) assert.ok(topic.playbook.length > 200, topic.id);
  // The structure playbook carries the references Dori chose.
  assert.match(DECK_TOPICS[0].playbook, /Sequoia/);
  assert.match(DECK_TOPICS[0].playbook, /Y Combinator/);
});

test("stored sections and deck feedback are read defensively", () => {
  const sections = asSections({ team: "Founder-led.", "Bad Key": "x", market: 42 });
  assert.equal(sections.team, "Founder-led.");
  assert.equal(sections.market, undefined);
  assert.ok(!("Bad Key" in sections));

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
  const sections = { ...emptySections(), team: "Product-led." };
  const [replace, append, bad] = asProposals([
    { section: "team", mode: "replace", content: "Founder-led.", why: "His record." },
    { section: "questions", mode: "append", content: "- May we name them?" },
    { section: "Not A Key", content: "x" },
  ]);
  assert.equal(bad, undefined);
  assert.equal(applyProposal(sections, replace).team, "Founder-led.");
  const appended = applyProposal({ ...sections, questions: "- Which funds?" }, append);
  assert.equal(appended.questions, "- Which funds?\n\n- May we name them?");
  assert.equal(applyProposal(sections, append).questions, "- May we name them?");
});

test("citation markup from web search is removed, the cited text kept", () => {
  assert.equal(
    stripCitations('ACT was sold in 2021 (<cite index="7-2">TSI announced it had completed the acquisition</cite>).'),
    "ACT was sold in 2021 (TSI announced it had completed the acquisition).",
  );
  assert.equal(asSections({ facts: 'Founded <cite index="1-1">2026</cite>.' }).facts, "Founded 2026.");
});

test("topics saved in the admin are checked: titles, unique ids, reserved keys, limits", () => {
  const parsed = parseBriefTopics([
    { title: "Market", guidance: "Size it.", enabled: true },
    { title: "Abstract", guidance: "" },
    { id: "team", title: "Team", enabled: false },
  ]);
  assert.ok(parsed);
  assert.deepEqual(parsed.map((topic) => topic.id), ["market", "abstract_topic", "team"]);
  assert.equal(parsed[2].enabled, false);
  assert.deepEqual(briefKeys(parsed), ["abstract", "market", "abstract_topic", "questions"]);
  assert.equal(parseBriefTopics([{ title: "" }]), null);
  assert.equal(parseBriefTopics([{ title: "Team" }, { title: "team" }]), null);
  assert.equal(parseBriefTopics([]), null);
});

test("selling points: all ten scored, top three by score, decided points lead the brief text", () => {
  const points = asPoints({
    scores: [
      { point: "founder_fit", title: "Founder-market fit and track record", score: 9, reason: "Ran a collections company.", pitch: "Former CEO of a collections company." },
      { point: "category_momentum", score: 7, reason: "AR is funded.", pitch: "AR automation raised big rounds in 2026." },
      { point: "traction", score: 3, reason: "Two customers.", pitch: "" },
      { point: "Not An Id", score: 10 },
    ],
  });
  assert.equal(points.scores.length, 3);
  assert.deepEqual(topPoints(points.scores, 2), ["founder_fit", "category_momentum"]);
  const text = briefText({ abstract: "- One", purpose: "AR automation." }, DEFAULT_BRIEF_TOPICS.slice(0, 1), { ...points, chosen: ["founder_fit"] });
  assert.match(text, /^## Abstract\n- One\n\n## The three strongest selling points \(decided\)\n1\. Founder-market fit and track record: Former CEO/);
  assert.deepEqual(abstractBullets("- One\n* Two\n\n3) Three"), ["One", "Two", "Three"]);
});

test("the selling points list saved in the admin: 3 to 20, unique titles; abstract bullets become titled cards", async () => {
  const { parseSellingPoints, abstractCard } = await import("./brief.ts");
  const parsed = parseSellingPoints([{ title: "Team" }, { title: "Traction", guidance: "Revenue." }, { title: "Market" }]);
  assert.deepEqual(parsed?.map((point) => point.id), ["team", "traction", "market"]);
  assert.equal(parseSellingPoints([{ title: "Team" }, { title: "Market" }]), null);
  assert.equal(parseSellingPoints([{ title: "Team" }, { title: "team" }, { title: "X" }]), null);
  assert.deepEqual(abstractCard("Founder: former CEO of a collections company"), { title: "Founder", text: "former CEO of a collections company" });
  assert.deepEqual(abstractCard("**The round:** $2M seed"), { title: "The round", text: "$2M seed" });
  assert.deepEqual(abstractCard("Two live customers, $650 MRR"), { title: "", text: "Two live customers, $650 MRR" });
});
