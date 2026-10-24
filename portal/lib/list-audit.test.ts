import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NOT_REVIEWED,
  asListAudit,
  auditProgress,
  auditSample,
  auditSendWarning,
  listFingerprint,
  readBatch,
  remainingFunds,
  type ListAudit,
} from "./list-audit.ts";
import type { FitTier, InvestorRow } from "./setup.ts";

function row(id: string, tier: FitTier, extra: Partial<InvestorRow> = {}): InvestorRow {
  return { id, fund_name: `Fund ${id}`, contact: "", details: "", tier, why: "", comments: "", ...extra };
}

function audit(extra: Partial<ListAudit> = {}): ListAudit {
  return {
    id: "a1",
    client_id: "c1",
    list_fingerprint: "x",
    run_id: null,
    status: "complete",
    sample: [],
    funds: [],
    summary: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...extra,
  };
}

test("sample: the first funds of each tier and of the broad investors, hidden duplicates left out", () => {
  const rows = [
    row("A", 1),
    row("B", 1),
    row("C", 1),
    row("D", 2),
    row("E", 4, { broad: true }),
    row("F", 4),
    row("G", 1, { hidden_duplicate: true }),
  ];
  assert.deepEqual(
    auditSample(rows, 2).map((fund) => fund.id),
    ["A", "B", "D", "E", "F"],
  );
});

test("fingerprint: changes with the funds, their tier or their order; not with admin-only rows", () => {
  const rows = [row("A", 1), row("B", 2)];
  const same = listFingerprint(rows);
  assert.equal(listFingerprint([...rows, row("H", 1, { hidden_duplicate: true })]), same);
  assert.notEqual(listFingerprint([row("B", 2), row("A", 1)]), same);
  assert.notEqual(listFingerprint([row("A", 1), row("B", 3)]), same);
  assert.notEqual(listFingerprint([row("A", 1)]), same);
});

test("a batch: verdicts matched by id; a fund the AI skipped becomes a flag to check by hand", () => {
  const asked = [
    { id: "A", fund_name: "Fund A", tier: 1 as const, broad: false },
    { id: "B", fund_name: "Fund B", tier: 1 as const, broad: false },
  ];
  const funds = readBatch(asked, [
    { id: "A", verdict: "remove", reason: "Website says the fund is closed.", founder_question: "Why is a closed fund here?", website: "opened", fund_name: "Wrong name" },
    { id: "Z", verdict: "ok" },
  ]);
  assert.equal(funds.length, 2);
  assert.equal(funds[0].fund_name, "Fund A");
  assert.equal(funds[0].verdict, "remove");
  assert.equal(funds[0].decision, null);
  assert.equal(funds[1].verdict, "flag");
  assert.equal(funds[1].reason, NOT_REVIEWED);
});

test("progress and the warning above Send", () => {
  const sample = [
    { id: "A", fund_name: "A", tier: 1 as const, broad: false },
    { id: "B", fund_name: "B", tier: 1 as const, broad: false },
  ];
  const flagged = {
    ...sample[0],
    verdict: "flag" as const,
    reason: "r",
    founder_question: "",
    website: "opened" as const,
    decision: null,
    decided_at: null,
  };
  const running = audit({ status: "running", sample, funds: [flagged] });
  assert.deepEqual(remainingFunds(running).map((fund) => fund.id), ["B"]);
  assert.deepEqual(auditProgress(running, "x"), { reviewed: 1, total: 2, flagged: 1, undecided: 1, stale: false });

  assert.match(auditSendWarning(null, "x")!, /No audit/);
  assert.match(auditSendWarning(running, "y")!, /changed since the last audit/);
  assert.match(auditSendWarning(running, "x")!, /not finished/);
  assert.match(auditSendWarning(audit({ sample, funds: [flagged] }), "x")!, /1 audit flag has no decision/);
  assert.equal(auditSendWarning(audit({ sample, funds: [{ ...flagged, decision: "keep" }] }), "x"), null);
});

test("stored rows are read defensively", () => {
  const read = asListAudit({
    id: "a1",
    client_id: "c1",
    list_fingerprint: "f",
    status: "weird",
    sample: [{ id: "A", tier: 9 }, null],
    funds: [{ id: "A", verdict: "maybe", website: "x" }],
    summary: { overview: "", questions: [{ question: "Why so few Core funds?", why: "w", answer: "a" }, { why: "no question" }], concerns: ["c", ""] },
  });
  assert.equal(read.status, "running");
  assert.deepEqual(read.sample, [{ id: "A", fund_name: "", tier: 4, broad: false }]);
  assert.equal(read.funds[0].verdict, "flag");
  assert.equal(read.funds[0].website, "not_opened");
  assert.equal(read.summary?.questions.length, 1);
  assert.deepEqual(read.summary?.concerns, ["c"]);
});
