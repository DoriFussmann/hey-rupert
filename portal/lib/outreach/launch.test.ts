import { test } from "node:test";
import assert from "node:assert/strict";
import {
  launchStage,
  rebuildBlocker,
  copyReconfirmed,
  resolveStuck,
  runActivate,
  runAddLeads,
  settingsBlocker,
  type LaunchRow,
  type PushOutcome,
} from "./launch.ts";

const EMPTY: LaunchRow = { live_at: null, leads_adding_at: null, leads_added_at: null, leads_added_count: null, leads_add_note: null };

/** A fake outreach_campaigns row and Instantly: counts every lead added. */
function world(push: (call: number) => PushOutcome, setup: () => { ok: true } | { ok: false; error: string } = () => ({ ok: true })) {
  const row: LaunchRow = { ...EMPTY };
  let pushCalls = 0;
  let leadsInInstantly = 0;
  let activations = 0;
  let clock = 0;
  const deps = {
    now: () => `2026-11-23T18:00:${String(clock++).padStart(2, "0")}Z`,
    async claim(now: string) {
      if (row.leads_adding_at || row.leads_added_at || row.live_at) return false;
      row.leads_adding_at = now;
      return true;
    },
    async reload() {
      return { ...row };
    },
    async release() {
      row.leads_adding_at = null;
    },
    async markAdded(now: string, count: number, note: string | null) {
      row.leads_added_at = now;
      row.leads_added_count = count;
      row.leads_add_note = note;
    },
    async setup() {
      return setup();
    },
    async push() {
      pushCalls += 1;
      const outcome = push(pushCalls);
      // A failed push that touched Instantly may still have left leads there.
      if (outcome.ok || outcome.touched) leadsInInstantly += outcome.ok ? outcome.pushed : Math.max(outcome.pushed, 1);
      return outcome;
    },
  };
  const activateDeps = {
    now: () => "2026-11-23T18:05:00Z",
    async activate() {
      activations += 1;
      return { ok: true as const };
    },
    async markLive(now: string) {
      row.live_at = now;
    },
  };
  return {
    row,
    deps,
    activateDeps,
    stats: () => ({ pushCalls, leadsInInstantly, activations }),
  };
}

test("add leads: the first batch goes in once, paused; a repeated click adds nothing", async () => {
  const w = world(() => ({ ok: true, pushed: 15 }));
  const first = await runAddLeads({ ...w.row }, w.deps);
  assert.deepEqual(first, { ok: true, added: 15, already: false, note: null });
  assert.equal(launchStage(w.row), "added");
  assert.equal(w.stats().activations, 0, "adding leads never starts the campaign");

  const again = await runAddLeads({ ...w.row }, w.deps);
  assert.deepEqual(again, { ok: true, added: 15, already: true, note: null });
  assert.deepEqual(w.stats(), { pushCalls: 1, leadsInInstantly: 15, activations: 0 });
});

test("add leads: two clicks at once, only one claims; the other adds nothing", async () => {
  const w = world(() => ({ ok: true, pushed: 15 }));
  const stale = { ...w.row };
  const [a, b] = await Promise.all([runAddLeads(stale, w.deps), runAddLeads(stale, w.deps)]);
  assert.equal(w.stats().pushCalls, 1);
  assert.equal(w.stats().leadsInInstantly, 15);
  const results = [a, b];
  assert.equal(results.filter((r) => r.ok && !r.already).length, 1, "one click added the batch");
  assert.ok(results.some((r) => !r.ok || r.already), "the other one didn't");
});

test("retry: a failure before any lead reached Instantly frees the claim, and the retry adds the batch once", async () => {
  let fail = true;
  const w = world(
    () => ({ ok: true, pushed: 15 }),
    () => (fail ? { ok: false, error: "Instantly: 503." } : { ok: true }),
  );
  const first = await runAddLeads({ ...w.row }, w.deps);
  assert.equal(first.ok, false);
  assert.match(first.ok ? "" : first.error, /No leads were added; you can try again/);
  assert.equal(launchStage(w.row), "ready");
  assert.equal(rebuildBlocker(w.row), null, "nothing in Instantly: rebuilding is still allowed");

  fail = false;
  const retry = await runAddLeads({ ...w.row }, w.deps);
  assert.deepEqual(retry, { ok: true, added: 15, already: false, note: null });
  assert.deepEqual(w.stats(), { pushCalls: 1, leadsInInstantly: 15, activations: 0 });
});

test("retry: a push that failed before sending anything (not touched) frees the claim", async () => {
  const w = world((call) => (call === 1 ? { ok: false, error: "Test inbox missing.", pushed: 0, touched: false } : { ok: true, pushed: 15 }));
  assert.equal((await runAddLeads({ ...w.row }, w.deps)).ok, false);
  assert.equal(launchStage(w.row), "ready");
  assert.equal((await runAddLeads({ ...w.row }, w.deps)).ok, true);
  assert.equal(w.stats().leadsInInstantly, 15);
});

test("retry: a failure after leads may have reached Instantly is final; retrying never adds a second batch", async () => {
  const w = world(() => ({ ok: false, error: "Saving pushed_at failed.", pushed: 0, touched: true }));
  const first = await runAddLeads({ ...w.row }, w.deps);
  assert.equal(first.ok, false);
  assert.match(first.ok ? "" : first.error, /check the Leads in Instantly before Activate/);
  assert.equal(launchStage(w.row), "added");
  assert.ok(w.row.leads_add_note);

  for (let i = 0; i < 3; i += 1) {
    const retry = await runAddLeads({ ...w.row }, w.deps);
    assert.equal(retry.ok && retry.already, true);
  }
  assert.equal(w.stats().pushCalls, 1, "push ran once");
  assert.equal(w.stats().leadsInInstantly, 1);
  assert.match(rebuildBlocker(w.row) ?? "", /can't be rebuilt/);
  assert.match(settingsBlocker(w.row) ?? "", /can't change now/);
});

test("add leads: nothing due today changes nothing", async () => {
  const w = world(() => ({ ok: true, pushed: 0 }));
  const result = await runAddLeads({ ...w.row }, w.deps);
  assert.equal(result.ok, false);
  assert.equal(launchStage(w.row), "ready");
});

test("activate: refused before leads; starts the campaign once; a repeated click does nothing", async () => {
  const w = world(() => ({ ok: true, pushed: 15 }));
  const early = await runActivate({ ...w.row }, w.activateDeps);
  assert.equal(early.ok, false);
  assert.equal(w.stats().activations, 0);

  await runAddLeads({ ...w.row }, w.deps);
  const started = await runActivate({ ...w.row }, w.activateDeps);
  assert.deepEqual(started, { ok: true, already: false });
  assert.equal(launchStage(w.row), "live");
  const again = await runActivate({ ...w.row }, w.activateDeps);
  assert.deepEqual(again, { ok: true, already: true });
  assert.deepEqual(w.stats(), { pushCalls: 1, leadsInInstantly: 15, activations: 1 }, "activate never adds leads");
  assert.equal((await runAddLeads({ ...w.row }, w.deps)).ok, false, "no adding once live");
  assert.equal(w.stats().pushCalls, 1);
});

test("activate: an Instantly failure leaves it paused and can be retried", async () => {
  const w = world(() => ({ ok: true, pushed: 15 }));
  await runAddLeads({ ...w.row }, w.deps);
  let calls = 0;
  const flaky = {
    ...w.activateDeps,
    async activate() {
      calls += 1;
      return calls === 1 ? { ok: false as const, error: "Instantly: 500." } : { ok: true as const };
    },
  };
  const failed = await runActivate({ ...w.row }, flaky);
  assert.equal(failed.ok, false);
  assert.equal(launchStage(w.row), "added");
  assert.deepEqual(await runActivate({ ...w.row }, flaky), { ok: true, already: false });
  assert.equal(w.stats().pushCalls, 1);
});

test("stuck (the server stopped after claiming): no add, no activate, no rebuild until resolved", async () => {
  const stuck: LaunchRow = { ...EMPTY, leads_adding_at: "2026-11-23T18:00:00Z" };
  assert.equal(launchStage(stuck), "stuck");
  const w = world(() => ({ ok: true, pushed: 15 }));
  Object.assign(w.row, stuck);
  const add = await runAddLeads({ ...w.row }, w.deps);
  assert.equal(add.ok, false);
  assert.match(add.ok ? "" : add.error, /didn't finish/);
  assert.equal((await runActivate({ ...w.row }, w.activateDeps)).ok, false);
  assert.match(rebuildBlocker(stuck) ?? "", /didn't finish/);
  assert.equal(w.stats().pushCalls, 0);

  assert.equal(resolveStuck(stuck, "empty", 3).ok, false, "contacts recorded as added: can't be called empty");
  assert.deepEqual(resolveStuck(stuck, "empty", 0), { ok: true, choice: "empty" });
  assert.deepEqual(resolveStuck(stuck, "added", 0), { ok: true, choice: "added" });
  assert.equal(resolveStuck(EMPTY, "added", 0).ok, false);
});

test("rebuild and settings are open only before anything is in Instantly", () => {
  assert.equal(rebuildBlocker(EMPTY), null);
  assert.equal(settingsBlocker(EMPTY), null);
  const added = { ...EMPTY, leads_added_at: "x", leads_added_count: 15 };
  assert.ok(rebuildBlocker(added));
  assert.ok(rebuildBlocker({ ...added, live_at: "y" }));
  assert.ok(settingsBlocker(added));
});

test("copyReconfirmed: rebuild without the admin only for a newer confirmed copy on a built, not-live campaign", () => {
  const built = { built_at: "2026-11-26T22:55:00Z", live_at: null, copy_version: 1 };
  assert.equal(copyReconfirmed(built, { copyRow: { status: "confirmed", version: 2 } }), true);
  assert.equal(copyReconfirmed(built, { copyRow: { status: "confirmed", version: 1 } }), false);
  assert.equal(copyReconfirmed(built, { copyRow: { status: "with_client", version: 2 } }), false);
  assert.equal(copyReconfirmed({ ...built, live_at: "2026-11-27T00:00:00Z" }, { copyRow: { status: "confirmed", version: 2 } }), false);
  assert.equal(copyReconfirmed({ ...built, built_at: null }, { copyRow: { status: "confirmed", version: 2 } }), false);
  assert.equal(copyReconfirmed(null, { copyRow: { status: "confirmed", version: 2 } }), false);
});
