import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFundFlag, commitFundFlag, type FundFlag } from "./investor-flags.ts";

type Row = { flags: Record<string, FundFlag>; stamp: string };

/** In-memory row. The write waits, then compares the stamp, so two updates overlap. */
function table(initial: Record<string, FundFlag> = {}) {
  let flags = { ...initial };
  let stamp = 0;
  return {
    current: () => flags,
    async read(): Promise<Row> {
      return { flags, stamp: String(stamp) };
    },
    async write(snapshot: Row, next: Record<string, FundFlag>) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (String(stamp) !== snapshot.stamp) return false;
      stamp += 1;
      flags = next;
      return true;
    },
  };
}

test("two concurrent flag updates for different funds both persist", async () => {
  const row = table();
  const [left, right] = await Promise.all([
    commitFundFlag(row.read, row.write, "fund-a", { excluded: true }),
    commitFundFlag(row.read, row.write, "fund-b", { known: true, note: "Met them" }),
  ]);
  assert.ok(left);
  assert.ok(right);
  assert.deepEqual(row.current(), {
    "fund-a": { excluded: true },
    "fund-b": { known: true, note: "Met them" },
  });
});

test("a note save and an exclude toggle on the same fund both persist", async () => {
  const row = table();
  await Promise.all([
    commitFundFlag(row.read, row.write, "fund-a", { note: "Already talking" }),
    commitFundFlag(row.read, row.write, "fund-a", { excluded: true }),
  ]);
  assert.deepEqual(row.current()["fund-a"], {
    excluded: true,
    note: "Already talking",
  });
});

test("a write that keeps losing stops after three attempts", async () => {
  let writes = 0;
  const flags = await commitFundFlag(
    async () => ({ flags: {}, stamp: "1" }),
    async () => {
      writes += 1;
      return false;
    },
    "fund-a",
    { excluded: true },
  );
  assert.equal(flags, null);
  assert.equal(writes, 3);
});

test("a patch leaves fields it does not mention", () => {
  const flags = applyFundFlag({ "fund-a": { excluded: true, note: "Keep" } }, "fund-a", {
    known: true,
  });
  assert.deepEqual(flags["fund-a"], { excluded: true, note: "Keep", known: true });
});
