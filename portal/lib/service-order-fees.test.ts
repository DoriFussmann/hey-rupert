import { test } from "node:test";
import assert from "node:assert/strict";
import { feeCents, monthlyFeeOf, setupFeeLabel, setupFeeOf } from "./service-order.ts";

const so = "- **Setup Fee:** $200, one-time\n- **Monthly Campaign Fee:** $600 per Service Month";
const sow = "**Fee:** $200\n\n**Setup Fee:** $200\n\n**Monthly Campaign Fee:** $1,000";

test("reads fees from a Service Order", () => {
  assert.equal(setupFeeOf(so), "$200");
  assert.equal(monthlyFeeOf(so), "$600");
});

test("reads fees from a Statement of Work", () => {
  assert.equal(setupFeeOf(sow), "$200");
  assert.equal(monthlyFeeOf(sow), "$1,000");
});

test("falls back to the default label", () => {
  assert.equal(setupFeeLabel(""), "$250");
  assert.equal(setupFeeLabel(null), "$250");
  assert.equal(setupFeeLabel(so), "$200");
});

test("converts to cents", () => {
  assert.equal(feeCents("$1,000"), 100000);
  assert.equal(feeCents("$200.50"), 20050);
  assert.equal(feeCents(null), null);
});

test("handles amounts without separators", () => {
  assert.equal(setupFeeOf("**Setup Fee:** $1000 per month"), "$1000");
  assert.equal(setupFeeOf("**Setup Fee:** $5, one-time"), "$5");
});
