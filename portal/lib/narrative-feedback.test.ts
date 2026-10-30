import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SETUP_STEPS,
  SETUP_TOTAL,
  asNarrative,
  getSetupItems,
  narrativeForClient,
  readyForInvestorList,
  setupStep,
  type SetupStepId,
  type SetupStepState,
} from "./setup.ts";

const at = "2026-10-22T10:00:00.000Z";

function row(step: SetupStepId, status: SetupStepState["status"], version: number): SetupStepState {
  return {
    client_id: "c",
    step,
    status,
    draft: {},
    published: {},
    version,
    published_at: version > 0 ? at : null,
    response: null,
    history: [],
    turn_since: at,
    completed_at: status === "confirmed" || status === "submitted" ? at : null,
    client_viewed_at: null,
    client_checks: {},
    updated_at: at,
  };
}

const source = (rows: SetupStepState[]) => ({
  stage: "setup",
  intake_completed_at: at,
  setup_steps: [row("materials", "submitted", 1), ...rows],
});

test("Setup has four steps: the narrative (with the feedback), the investor list, the email copy, Go Live", () => {
  assert.equal(SETUP_TOTAL, 4);
  assert.deepEqual(
    SETUP_STEPS.map((step) => step.id),
    ["framing", "investor_list", "email_copy", "go_live"],
  );
  const items = getSetupItems(source([]));
  assert.deepEqual(items.map((item) => item.id), ["framing", "investor_list", "email_copy", "go_live"]);
  assert.equal(items[3].status, "open");
  assert.equal(items[0].status, "waiting");
  assert.equal(items[1].status, "open");
  // The old feedback step is still known, so its page and history keep working.
  assert.equal(setupStep("deck_review").title, "Analysis & Feedback");
});

test("the investor list unlocks once the narrative is confirmed; the feedback plays no part", () => {
  assert.equal(readyForInvestorList(source([row("framing", "with_client", 1)])), false);
  const confirmed = source([row("framing", "confirmed", 1)]);
  assert.equal(readyForInvestorList(confirmed), true);
  assert.equal(getSetupItems(confirmed)[1].status, "waiting");

  // Earlier feedback the client never confirmed doesn't hold anything up.
  const legacy = source([row("deck_review", "with_client", 1), row("framing", "confirmed", 1)]);
  assert.equal(readyForInvestorList(legacy), true);
  assert.equal(getSetupItems(legacy).length, 4);

  // Once a list is sent, it isn't "ready" any more.
  assert.equal(
    readyForInvestorList(source([row("framing", "confirmed", 1), row("investor_list", "with_client", 1)])),
    false,
  );
});

test("the feedback travels with the narrative; the client never sees what the AI read", () => {
  const draft = {
    core: "Story",
    key_messages: "- One",
    approach: "Approach",
    feedback: {
      summary: "How Rupert reads it",
      improvements: "- High: add a traction chart (slide 6)",
      generated_at: at,
      read: ["deck.pdf"],
      skipped: ["notes.key: can't be read"],
    },
    change_summary: "Rupert only",
  };
  const stored = asNarrative(draft);
  assert.equal(stored.feedback?.improvements, "- High: add a traction chart (slide 6)");
  assert.deepEqual(stored.feedback?.read, ["deck.pdf"]);

  const shown = narrativeForClient(draft);
  assert.equal(shown.feedback?.summary, "How Rupert reads it");
  assert.deepEqual(shown.feedback?.read, []);
  assert.deepEqual(shown.feedback?.skipped, []);
  assert.equal(shown.feedback?.generated_at, "");
  assert.equal(shown.change_summary, undefined);

  // Empty feedback is no feedback.
  assert.equal(asNarrative({ core: "Story", feedback: { summary: " ", improvements: "" } }).feedback, undefined);
  assert.equal(asNarrative({ core: "Story" }).feedback, undefined);
});

test("Go Live opens after the copy is confirmed, is the client's turn once pushed, done when live", () => {
  const confirmed = [row("framing", "confirmed", 1), row("investor_list", "confirmed", 1), row("email_copy", "confirmed", 1)];
  assert.equal(getSetupItems(source(confirmed))[3].status, "waiting");
  assert.equal(getSetupItems(source([...confirmed, row("go_live", "with_client", 1)]))[3].status, "your_turn");
  assert.equal(getSetupItems(source([...confirmed, row("go_live", "confirmed", 1)]))[3].status, "done");
  // A client already live before the step existed counts as done.
  assert.equal(getSetupItems({ ...source(confirmed), stage: "live" })[3].status, "done");
});

test("the statement narrative: why three, the points in order, the ask; enough to send on its own", async () => {
  const { asStatement, statementMarkdown, narrativeProblem, asNarrative } = await import("./setup.ts");
  const statement = asStatement({ intro: "We lead with three.", points: [{ title: "Founder", claim: "- Ran a collections company" }, { title: "", claim: "" }], closing: "Confirm?" });
  assert.ok(statement);
  assert.equal(statement.points.length, 1);
  assert.equal(statementMarkdown(statement), "We lead with three.\n\n### 1. Founder\n\n- Ran a collections company\n\nConfirm?");
  assert.equal(narrativeProblem({ ...asNarrative({}), statement, summary: statementMarkdown(statement) }), null);
  assert.equal(asStatement({ points: [] }), undefined);
});
