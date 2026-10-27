import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeSteps, type StepState } from "./step-order.ts";

const s = (key: string, done: boolean, turn: StepState["turn"] = "none"): StepState => ({ key, done, turn });
const keys = (list: StepState[]) => list.map((x) => x.key);

test("Rupert's next move goes on top, even when an earlier step waits on the client", () => {
  const out = arrangeSteps([s("narrative", true), s("list", true), s("copy", false, "client"), s("core", false, "admin"), s("live", false)]);
  assert.equal(out.current?.key, "core");
  assert.deepEqual(keys(out.open), ["copy", "live"]);
  assert.deepEqual(keys(out.completed), ["narrative", "list"]);
});

test("with nothing on Rupert's side, the step waiting on the client is on top", () => {
  const out = arrangeSteps([s("narrative", true), s("list", false, "client"), s("copy", false)]);
  assert.equal(out.current?.key, "list");
  assert.deepEqual(keys(out.open), ["copy"]);
});

test("all done: no current step, everything completed in order", () => {
  const out = arrangeSteps([s("a", true), s("b", true)]);
  assert.equal(out.current, null);
  assert.deepEqual(keys(out.completed), ["a", "b"]);
});
