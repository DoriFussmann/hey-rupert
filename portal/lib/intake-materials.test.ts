import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_INTAKE_TOPICS,
  asConflicts,
  intakeFileProblem,
  intakeMessageText,
  intakeReady,
  materialsProvided,
  mergeConflicts,
  type TopicStatus,
} from "./intake.ts";
import { ONBOARDING_TOTAL, getOnboardingItems, materialsStatus } from "./onboarding.ts";
import { MATERIAL_MAX_BYTES, asMaterials } from "./setup.ts";

const allCovered: Record<string, TopicStatus> = Object.fromEntries(
  DEFAULT_INTAKE_TOPICS.map((topic) => [topic.id, { status: "covered" as const, note: "" }]),
);

test("the intake completes only with the essentials and materials (a file, or no deck yet)", () => {
  assert.equal(intakeReady(DEFAULT_INTAKE_TOPICS, allCovered, { fileCount: 0, noDeck: "" }), false);
  assert.equal(intakeReady(DEFAULT_INTAKE_TOPICS, allCovered, { fileCount: 0, noDeck: "  " }), false);
  assert.equal(intakeReady(DEFAULT_INTAKE_TOPICS, allCovered, { fileCount: 1, noDeck: "" }), true);
  assert.equal(intakeReady(DEFAULT_INTAKE_TOPICS, allCovered, { fileCount: 0, noDeck: "Still building it" }), true);
  assert.equal(intakeReady(DEFAULT_INTAKE_TOPICS, {}, { fileCount: 3, noDeck: "" }), false);
  assert.equal(materialsProvided({ fileCount: 2, noDeck: "" }), true);
});

test("intake files: readable formats in, Keynote and old Office formats asked as PDF, size capped", () => {
  assert.equal(intakeFileProblem({ name: "Deck.PDF", size: 1000 }), null);
  assert.equal(intakeFileProblem({ name: "model.xlsx", size: 1000 }), null);
  assert.equal(intakeFileProblem({ name: "photo.png", size: 1000 }), null);
  assert.match(intakeFileProblem({ name: "deck.key", size: 1000 }) ?? "", /PDF/);
  assert.match(intakeFileProblem({ name: "deck.ppt", size: 1000 }) ?? "", /PDF/);
  assert.match(intakeFileProblem({ name: "notes.doc", size: 1000 }) ?? "", /PDF/);
  assert.match(intakeFileProblem({ name: "archive.zip", size: 1000 }) ?? "", /isn't supported/);
  assert.match(intakeFileProblem({ name: "empty.pdf", size: 0 }) ?? "", /empty/);
  assert.match(intakeFileProblem({ name: "big.pdf", size: MATERIAL_MAX_BYTES + 1 }) ?? "", /limit/);
});

test("conflicts: added when noticed, resolved once, never reopened", () => {
  const opened = mergeConflicts(
    [],
    [
      {
        id: "Raise_Amount",
        topic_id: "raise",
        file: "deck.pdf",
        file_says: "$2M",
        founder_says: "$3M",
        status: "open",
        resolution: "",
      },
      { id: "bad id!", topic_id: "raise", status: "open" },
    ],
    "2026-10-22T10:00:00.000Z",
  );
  assert.equal(opened.length, 1);
  assert.equal(opened[0].id, "raise_amount");
  assert.equal(opened[0].status, "open");

  const resolved = mergeConflicts(
    opened,
    [{ id: "raise_amount", status: "resolved", resolution: "$3M (the deck is older)" }],
    "2026-10-22T10:05:00.000Z",
  );
  assert.equal(resolved[0].status, "resolved");
  assert.equal(resolved[0].resolution, "$3M (the deck is older)");
  assert.equal(resolved[0].file_says, "$2M");

  const again = mergeConflicts(
    resolved,
    [{ id: "raise_amount", status: "open", resolution: "", founder_says: "$4M" }],
    "2026-10-22T10:10:00.000Z",
  );
  assert.deepEqual(again, resolved);

  // "Resolved" without any resolution stays open.
  const vague = mergeConflicts([], [{ id: "stage", status: "resolved", resolution: "" }], "t");
  assert.equal(vague[0].status, "open");
  assert.equal(asConflicts([{ id: "stage", status: "resolved", resolution: "" }])[0].status, "open");
});

test("a message with several files reads as each file's facts, then the note", () => {
  const text = intakeMessageText({
    role: "user",
    content: "Here you go",
    at: "",
    attachments: [
      { name: "deck.pdf", path: "a/deck.pdf", facts: "Seed, $2M" },
      { name: "model.xlsx", path: "a/model.xlsx", facts: "" },
    ],
  });
  assert.match(text, /shared deck\.pdf\. What it says:\nSeed, \$2M/);
  assert.match(text, /shared model\.xlsx\.\]/);
  assert.ok(text.endsWith("Here you go"));
});

test("materials keep the no-deck reason", () => {
  assert.equal(asMaterials({ files: [], fields: {}, no_deck: " Still building it " }).no_deck, "Still building it");
  assert.equal(asMaterials({}).no_deck, "");
});

const kickedOff = {
  sow_confirmed_at: "2026-10-01T00:00:00.000Z",
  service_order_content: "Order",
  service_order_agreed_at: "2026-10-02T00:00:00.000Z",
  setup_invoice_url: "https://pay.example.com",
  payment_received_at: "2026-10-02T00:00:00.000Z",
  nda_sent_at: "2026-10-03T00:00:00.000Z",
  nda_signed_at: "2026-10-04T00:00:00.000Z",
};

const materialsRow = (status: string, version: number, completedAt: string | null = null) => ({
  step: "materials",
  status,
  version,
  completed_at: completedAt,
});

test("onboarding has five steps; the intake includes the company materials", () => {
  assert.equal(ONBOARDING_TOTAL, 5);
  const before = getOnboardingItems(kickedOff);
  assert.deepEqual(
    before.map((item) => item.id),
    ["sow", "service_order", "payment", "nda", "intake"],
  );
  const intake = before.find((item) => item.id === "intake")!;
  assert.equal(intake.status, "your_turn");
  assert.equal(intake.href, "/portal/intake");

  const done = getOnboardingItems({
    ...kickedOff,
    intake_completed_at: "2026-10-05T00:00:00.000Z",
    setup_steps: [materialsRow("submitted", 1, "2026-10-05T00:00:00.000Z")],
  });
  assert.equal(done.find((item) => item.id === "intake")!.status, "done");
  assert.ok(done.every((item) => item.status === "done"));
});

test("an intake completed without materials (before this change) still asks for them", () => {
  const source = {
    ...kickedOff,
    intake_completed_at: "2026-10-05T00:00:00.000Z",
    setup_steps: [materialsRow("draft", 0)],
  };
  const intake = getOnboardingItems(source).find((item) => item.id === "intake")!;
  assert.equal(intake.status, "your_turn");
  assert.equal(intake.href, "/portal/materials");
  assert.equal(materialsStatus(source).detail, "Share your deck and materials");

  const sentBack = { ...source, setup_steps: [materialsRow("draft", 1)] };
  assert.equal(materialsStatus(sentBack).detail, "Rupert asked for a few more things");
  assert.equal(getOnboardingItems(sentBack).find((item) => item.id === "intake")!.status, "your_turn");
});
