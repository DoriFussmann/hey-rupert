import assert from "node:assert/strict";
import { test } from "node:test";
import { intakeKnowledge, knowledgeFacts, knowledgeFiles, sharedRead } from "./company-knowledge.ts";

test("facts: the client record first, the intake brief where it is empty, empty facts left out", () => {
  const facts = knowledgeFacts(
    { company_name: "Vault Extracts", company_website: "", raise_stage: "Pre-Seed", raise_amount: null, vertical: "", geography: "Pennsylvania" },
    { industry: "Cannabis extracts", geography: "US", stage: "Seed", raise_amount: "$1.5M" },
  );
  assert.deepEqual(facts, [
    { label: "Company", value: "Vault Extracts" },
    { label: "Stage", value: "Pre-Seed" },
    { label: "Raising", value: "$1.5M" },
    { label: "Sector", value: "Cannabis extracts" },
    { label: "Based in", value: "Pennsylvania" },
  ]);
});

test("intake: the confirmed summary; without one, Rupert's notes per topic; empty topics left out", () => {
  const topics = [
    { id: "a", title: "The raise", guidance: "", required: true },
    { id: "b", title: "Traction", guidance: "", required: true },
  ];
  const summary = [
    { topic_id: "a", title: "The raise", answer: "$1.5M SAFE" },
    { topic_id: "b", title: "Traction", answer: "Not provided." },
  ];
  const notes = { a: { status: "covered" as const, note: "Raising $1.5M on a SAFE" }, b: { status: "missing" as const, note: "" } };
  assert.deepEqual(intakeKnowledge({ status: "completed", summary, topic_status: notes }, topics), { confirmed: true, items: [summary[0]] });
  assert.deepEqual(intakeKnowledge({ status: "in_progress", summary: null, topic_status: notes }, topics), {
    confirmed: false,
    items: [{ topic_id: "a", title: "The raise", answer: "Raising $1.5M on a SAFE" }],
  });
  assert.equal(intakeKnowledge({ status: "in_progress", summary: null, topic_status: {} }, topics), null);
  assert.equal(intakeKnowledge(null, topics), null);
});

test("Rupert's read: only what was sent to the founder, never a draft", () => {
  const draftOnly = { step: "framing", status: "draft", version: 0, published: null, draft: { summary: "Draft story", feedback: { summary: "Draft read" } } };
  assert.equal(sharedRead(draftOnly), null);
  const sent = {
    step: "framing",
    status: "confirmed",
    version: 2,
    published: { summary: "The story", feedback: { summary: "How Rupert reads it", improvements: "", generated_at: "", read: [], skipped: [] } },
    draft: { summary: "Newer draft" },
  };
  assert.deepEqual(sharedRead(sent), { read: "How Rupert reads it", story: "The story", confirmed: true });
  // An older narrative: no short version, feedback sent as its own step.
  const older = { step: "framing", status: "with_client", version: 1, published: { core: "The core story" }, draft: {} };
  const legacy = { step: "deck_review", status: "confirmed", version: 1, published: { summary: "Rupert's earlier read" }, draft: {} };
  assert.deepEqual(sharedRead(older, legacy), { read: "Rupert's earlier read", story: "The core story", confirmed: false });
});

test("files: what was submitted (or the draft before that), newest first", () => {
  const file = (name: string, at: string) => ({ path: `c/${name}`, name, size: 1, type: "", uploaded_at: at });
  const submitted = {
    step: "materials",
    status: "submitted",
    version: 1,
    published: { files: [file("deck.pdf", "2026-10-01"), file("update.pdf", "2026-10-20")] },
    draft: { files: [] },
  };
  assert.deepEqual(knowledgeFiles(submitted).map((f) => f.name), ["update.pdf", "deck.pdf"]);
  assert.deepEqual(knowledgeFiles(null), []);
});
