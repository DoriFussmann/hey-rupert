import assert from "node:assert/strict";
import { test } from "node:test";
import { reanalyzeHeadline, reanalyzeState, type ReanalyzeInput } from "./reanalyze.ts";

const T1 = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-02T10:00:00.000Z";
const T3 = "2026-10-03T10:00:00.000Z";
const T4 = "2026-10-04T10:00:00.000Z";

/** Everything analyzed at T2, after an intake that ended at T1. */
function analyzed(): ReanalyzeInput {
  return {
    intakeCompleted: true,
    materialsIn: true,
    interview: {
      updatedAt: T1,
      messages: [
        { role: "assistant", at: T1 },
        { role: "user", at: T1 },
      ],
    },
    brief: { basedOn: T1, editedAt: null },
    feedback: { generatedAt: T2 },
    profile: { builtAt: T3, sourceInterviewAt: T1, editedAt: null },
    files: [{ uploadedAt: T1 }],
    narrative: { hasText: true, sent: false, changesRequested: false },
  };
}

test("nothing new: no banner", () => {
  const state = reanalyzeState(analyzed());
  assert.equal(state.available, true);
  assert.equal(state.show, false);
  assert.deepEqual(state.behind, []);
});

test("not available until the intake and the materials are in", () => {
  const state = reanalyzeState({ ...analyzed(), materialsIn: false, feedback: null });
  assert.equal(state.available, false);
  assert.equal(state.show, false);
});

test("a file added after the analysis: feedback behind, counted", () => {
  const input = analyzed();
  input.files.push({ uploadedAt: T4 });
  const state = reanalyzeState(input);
  assert.equal(state.show, true);
  assert.deepEqual(state.behind, ["feedback"]);
  assert.equal(state.newFiles, 1);
  assert.equal(state.newMessages, 0);
  assert.equal(reanalyzeHeadline(state), "New since last analysis: 1 file.");
});

test("founder messages after the brief: brief, feedback and profile behind", () => {
  const input = analyzed();
  input.interview = {
    updatedAt: T4,
    messages: [...input.interview!.messages, { role: "user", at: T4 }, { role: "assistant", at: T4 }, { role: "user", at: T4 }],
  };
  const state = reanalyzeState(input);
  assert.deepEqual(state.behind, ["brief", "feedback", "profile"]);
  assert.equal(state.newMessages, 2);
  assert.equal(reanalyzeHeadline(state), "New since last analysis: 2 messages.");
});

test("feedback newer than the profile: the profile is behind", () => {
  const input = analyzed();
  input.feedback = { generatedAt: T4 };
  const state = reanalyzeState(input);
  assert.deepEqual(state.behind, ["profile"]);
  assert.equal(reanalyzeHeadline(state), "Out of date: Company profile.");
});

test("first run: everything behind, no counts", () => {
  const input = analyzed();
  input.brief = null;
  input.feedback = null;
  input.profile = null;
  input.narrative = { hasText: false, sent: false, changesRequested: false };
  const state = reanalyzeState(input);
  assert.equal(state.firstRun, true);
  assert.deepEqual(state.behind, ["brief", "feedback", "profile", "narrative"]);
  assert.equal(state.newFiles, 0);
  assert.equal(reanalyzeHeadline(state), "The intake and the materials are in. Run the analysis.");
  assert.ok(state.steps.every((step) => step.replaces === null && step.skip === null));
});

test("what each step replaces", () => {
  const input = analyzed();
  input.brief = { basedOn: T1, editedAt: T2 };
  input.profile = { builtAt: T3, sourceInterviewAt: T1, editedAt: T3 };
  input.narrative = { hasText: true, sent: true, changesRequested: false };
  const steps = Object.fromEntries(reanalyzeState(input).steps.map((step) => [step.id, step.replaces]));
  assert.equal(steps.brief, "Your edits to the brief will be replaced.");
  assert.equal(steps.feedback, "Replaces the current feedback, including your edits.");
  assert.equal(steps.profile, "Your edits to the profile will be replaced.");
  assert.equal(steps.narrative, "Writes a new draft. The client keeps the version they have until you send.");
});

test("no interview: the brief and the profile are skipped", () => {
  const input = analyzed();
  input.interview = null;
  const state = reanalyzeState(input);
  const skipped = state.steps.filter((step) => step.skip).map((step) => step.id);
  assert.deepEqual(skipped, ["brief", "profile"]);
  assert.ok(!state.behind.includes("brief"));
});
