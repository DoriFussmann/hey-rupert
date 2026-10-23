import assert from "node:assert/strict";
import { test } from "node:test";
import { intakeProgress, type IntakeTopic } from "./intake.ts";

const topics: IntakeTopic[] = [
  { id: "a", title: "A", guidance: "", required: true },
  { id: "b", title: "B", guidance: "", required: true },
  { id: "c", title: "C", guidance: "", required: true },
  { id: "d", title: "D", guidance: "", required: true },
  { id: "x", title: "Extra", guidance: "", required: false },
];

test("progress counts only covered required topics", () => {
  const halfway = intakeProgress(topics, {
    a: { status: "covered", note: "" },
    b: { status: "covered", note: "" },
    c: { status: "partial", note: "" },
    d: { status: "partial", note: "" },
    x: { status: "covered", note: "" },
  });
  assert.deepEqual(halfway, { percent: 50, ready: false });
});

test("the last required topic takes progress from 75% to 100%, not from 50%", () => {
  const three = { a: "covered", b: "covered", c: "covered", d: "partial" } as const;
  const status = (map: Record<string, "covered" | "partial">) =>
    Object.fromEntries(Object.entries(map).map(([id, value]) => [id, { status: value, note: "" }]));
  assert.deepEqual(intakeProgress(topics, status(three)), { percent: 75, ready: false });
  assert.deepEqual(intakeProgress(topics, status({ ...three, d: "covered" })), { percent: 100, ready: true });
});
