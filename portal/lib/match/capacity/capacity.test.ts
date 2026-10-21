import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredResult } from "../tiers/compare.ts";
import { CORE_CAP, allocate, poolsOf } from "./allocate.ts";
import { buildPlan } from "./plan.ts";
import {
  BENCHMARKS,
  DEFAULT_INPUTS,
  campaignDays,
  compareToBenchmark,
  inboxesNeeded,
  inputProblems,
  schedule,
  type CapacityInputs,
} from "./schedule.ts";

const inputs = (extra: Partial<CapacityInputs> = {}): CapacityInputs => ({ ...DEFAULT_INPUTS, ...extra });

/** Sending days in the campaign, counted directly: day 0 is a Monday. */
function sendingDays(months: number, perWeek: number) {
  let count = 0;
  for (let d = 0; d < campaignDays(months); d += 1) if (d % 7 < perWeek) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// Capacity

test("1. one- to six-month campaigns: the default inputs land near every planning benchmark", () => {
  for (const benchmark of BENCHMARKS) {
    const firms = schedule(inputs({ months: benchmark.months })).firms;
    assert.ok(Math.abs(firms - benchmark.firms) <= benchmark.firms * 0.1, `${benchmark.months} months: ${firms} vs ${benchmark.firms}`);
  }
  assert.deepEqual(compareToBenchmark(330, 330), { status: "on", difference: 0 });
  assert.equal(compareToBenchmark(300, 330).status, "under");
  assert.equal(compareToBenchmark(400, 330).status, "over");
  // The benchmarks are references: the capacity always comes from the inputs.
  assert.ok(schedule(inputs({ months: 3, inboxes: 3 })).firms > 900);
});

test("2. warm-up: its weeks send at the warm-up percentage, then full capacity", () => {
  const full = schedule(inputs({ warmupWeeks: 0 }));
  assert.equal(full.capacity, sendingDays(3, 5) * 35);
  const warm = schedule(inputs({ warmupWeeks: 2, warmupPercent: 50 }));
  assert.equal(warm.warmupSendingDays, 10);
  assert.equal(warm.capacity, full.capacity - 10 * (35 - 17));
  assert.equal(warm.dailyWarmup, 17); // floor(35 × 50%)
  assert.equal(schedule(inputs({ warmupWeeks: 2, warmupPercent: 100 })).capacity, full.capacity);
  assert.equal(schedule(inputs({ warmupWeeks: 2, warmupPercent: 0 })).capacity, full.capacity - 10 * 35);
  assert.ok(warm.firms < full.firms);
  assert.ok(warm.bottlenecks.some((note) => note.startsWith("Warm-up")));
});

test("3. inboxes, sending limits and sending days scale the capacity", () => {
  const one = schedule(inputs({ warmupWeeks: 0 }));
  const three = schedule(inputs({ warmupWeeks: 0, inboxes: 3 }));
  assert.equal(three.capacity, one.capacity * 3);
  assert.equal(schedule(inputs({ warmupWeeks: 0, emailsPerInboxPerDay: 70 })).capacity, one.capacity * 2);
  const seven = schedule(inputs({ warmupWeeks: 0, sendingDaysPerWeek: 7 }));
  assert.equal(seven.capacity, campaignDays(3) * 35);
  assert.ok(three.firms > one.firms * 2.5);
  assert.ok(seven.firms > one.firms);
});

test("4. follow-ups and delays: sequences overlap, every follow-up is booked inside the campaign", () => {
  // No follow-ups: every send is a new contact and the capacity is used in full.
  const none = schedule(inputs({ warmupWeeks: 0, followUps: 0, contactsPerFirm: 1 }));
  assert.equal(none.firms, none.capacity);
  assert.equal(none.utilization, 1);
  // A hand-checked case: 2 sends a day, every day, 30 days; one follow-up the next day.
  // Two firms start every other day (the follow-ups fill the day after), up to day 28.
  const tiny = schedule({ inboxes: 1, emailsPerInboxPerDay: 2, warmupWeeks: 0, warmupPercent: 100, sendingDaysPerWeek: 7, months: 1, contactsPerFirm: 1, followUps: 1, followUpDelayDays: 1 });
  assert.equal(tiny.days, 30);
  assert.equal(tiny.firms, 30);
  assert.equal(tiny.followUpEmails, 30);
  assert.equal(tiny.lastStartDay, 28);
  // Follow-ups are never counted as firms, and each one is booked.
  const r = schedule(inputs());
  assert.equal(r.initialEmails, r.firms * r.emailsPerFirm / 3);
  assert.equal(r.followUpEmails, r.firms * 2 * 2);
  assert.equal(r.scheduled, r.initialEmails + r.followUpEmails);
  assert.ok(r.weeks.some((week) => week.initial > 0 && week.followUps > 0), "new outreach and follow-ups share weeks");
  // The schedule never claims more than a plain division, and longer delays never add firms.
  assert.ok(r.firms <= r.naiveFirms);
  assert.ok(schedule(inputs({ followUpDelayDays: 14 })).firms <= schedule(inputs({ followUpDelayDays: 3 })).firms);
  assert.ok(r.tailUnused > 0);
  assert.ok(r.bottlenecks.some((note) => note.startsWith("Follow-up timing")));
});

test("5. unique firms with several contacts per firm", () => {
  const two = schedule(inputs({ warmupWeeks: 0, followUps: 0, contactsPerFirm: 2 }));
  const three = schedule(inputs({ warmupWeeks: 0, followUps: 0, contactsPerFirm: 3 }));
  assert.equal(two.contactsReached, two.firms * 2);
  assert.equal(three.contactsReached, three.firms * 3);
  // 35 a day: 17 firms of 2 (34 sends) or 11 firms of 3 (33 sends) per day.
  assert.equal(two.firms, sendingDays(3, 5) * 17);
  assert.equal(three.firms, sendingDays(3, 5) * 11);
});

test("13. invalid inputs and boundaries", () => {
  assert.ok(inputProblems(inputs({ inboxes: 0 })).some((p) => p.startsWith("Sending inboxes")));
  assert.ok(inputProblems(inputs({ inboxes: 1.5 })).some((p) => p.includes("whole number")));
  assert.ok(inputProblems(inputs({ months: Number.NaN })).some((p) => p.includes("enter a number")));
  assert.ok(inputProblems(inputs({ warmupWeeks: 5, months: 1 })).some((p) => p.includes("warm-up lasts")));
  assert.ok(inputProblems(inputs({ contactsPerFirm: 5, emailsPerInboxPerDay: 4 })).some((p) => p.includes("same day")));
  assert.ok(inputProblems(inputs({ months: 1, followUps: 5, followUpDelayDays: 7 })).some((p) => p.includes("sequence takes")));
  assert.throws(() => schedule(inputs({ inboxes: -1 })));
  assert.deepEqual(inputProblems(inputs({ inboxes: 100, emailsPerInboxPerDay: 100, months: 12 })), []);
  assert.deepEqual(inputProblems(inputs({ inboxes: 1, emailsPerInboxPerDay: 2, contactsPerFirm: 2, months: 1 })), []);
  // Backward: how many inboxes a target needs, or null when none can.
  const needed = inboxesNeeded(inputs(), 1000)!;
  assert.ok(schedule(inputs({ inboxes: needed }), 1000).firms >= 1000);
  assert.ok(schedule(inputs({ inboxes: needed - 1 }), 1000).firms < 1000);
  assert.equal(inboxesNeeded(inputs({ months: 1 }), 1_000_000), null);
  assert.throws(() => buildPlan([], { inputs: inputs(), target: 0, useGeneralists: false }));
});

// ---------------------------------------------------------------------------
// Allocation

let position = 0;
function row(firmId: string, status: StoredResult["status"], tier: string | null, detail: Record<string, unknown> = {}, reason?: string): StoredResult {
  position += 1;
  return { firmId, firmName: `Fund ${firmId}`, status, tier, reasonCodes: reason ? [reason] : [], detail, score: 100 - position / 100, position };
}
const many = (prefix: string, count: number, status: StoredResult["status"], tier: string | null) =>
  Array.from({ length: count }, (_, i) => row(`${prefix}${i + 1}`, status, tier));

function fixture({ core = 14, sphere = 30, tier3 = 40, tier4 = 50, generalists = 25 } = {}): StoredResult[] {
  position = 0;
  return [
    ...many("C", core, "tiered", "core"),
    ...many("S", sphere, "tiered", "sphere"),
    ...many("T", tier3, "tiered", "tier3"),
    ...many("F", tier4, "tiered", "tier4"),
    ...many("G", generalists, "generalist", null),
    row("X1", "excluded", null, {}, "geo_outside"),
    row("N1", "excluded", null, {}, "stage_one_off"),
    row("U1", "unresolved", null, {}, "geo_ambiguous"),
    row("R1", "tiered", "core", { rejected: "Client veto" }),
    row("O2", "tiered", "core", { representedBy: "C1" }),
    row("C1#2", "tiered", "sphere"),
  ];
}

test("6. Core is capped at 10; the rest flows Sphere, Tier 3, Tier 4 by the target", () => {
  const pools = poolsOf(fixture());
  const small = allocate(pools, 25, false);
  assert.deepEqual(small.rows.map((r) => [r.source, r.planned]), [["core", CORE_CAP], ["sphere", 15], ["tier3", 0], ["tier4", 0], ["generalist", 0]]);
  assert.equal(small.rows[0].remaining, 4);
  assert.match(small.rows[0].note, /Capped at 10/);
  const larger = allocate(pools, 100, false);
  assert.deepEqual(larger.rows.map((r) => r.planned), [10, 30, 40, 20, 0]);
  assert.equal(larger.shortfall, 0);
  // Firms keep the run's order: the best fit of each tier first.
  assert.deepEqual(small.firms.slice(0, 2).map((f) => f.firmId), ["C1", "C2"]);
});

test("7. short pools: each tier gives what it has, nothing is manufactured", () => {
  const pools = poolsOf(fixture({ core: 3, sphere: 2, tier3: 1, tier4: 4, generalists: 0 }));
  const plan = allocate(pools, 50, false);
  assert.deepEqual(plan.rows.map((r) => [r.planned, r.remaining]), [[3, 0], [2, 0], [1, 0], [4, 0], [0, 0]]);
  assert.match(plan.rows[0].note, /Only 3 eligible Core firms/);
  assert.equal(plan.planned, 10);
  assert.equal(plan.shortfall, 40);
  assert.equal(plan.maxAchievable, 10);
});

test("8. generalists top up a real shortfall, only when approved, and stay labelled", () => {
  const pools = poolsOf(fixture({ core: 5, sphere: 5, tier3: 5, tier4: 5, generalists: 25 }));
  const without = allocate(pools, 40, false);
  assert.equal(without.generalistsProposed, 20);
  assert.equal(without.rows[4].planned, 0);
  assert.equal(without.shortfall, 20);
  const approved = allocate(pools, 40, true);
  assert.equal(approved.rows[4].planned, 20);
  assert.equal(approved.shortfall, 0);
  assert.ok(approved.firms.filter((f) => f.firmId.startsWith("G")).every((f) => f.source === "generalist"));
  const beyond = allocate(pools, 60, true);
  assert.equal(beyond.rows[4].planned, 25);
  assert.equal(beyond.shortfall, 15);
  assert.equal(beyond.maxAchievable, 45);
  // No shortfall, no generalists, even when approved.
  assert.equal(allocate(pools, 15, true).rows[4].planned, 0);
});

test("9–10. each firm once; excluded, unresolved, near-miss, rejected and represented firms never enter", () => {
  const pools = poolsOf(fixture());
  const all = allocate(pools, 10_000, true);
  const ids = all.firms.map((f) => f.firmId.replace(/#\d+$/, ""));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["X1", "N1", "U1", "R1", "O2", "C1#2"]) assert.ok(!all.firms.some((f) => f.firmId === id), id);
  assert.equal(all.planned, 10 + 30 + 40 + 50 + 25);
});

test("11–12. the same run and inputs give the same plan; a new plan leaves earlier ones and the run untouched", () => {
  const rows = fixture();
  const frozen = JSON.stringify(rows);
  const request = { inputs: inputs(), target: 120, useGeneralists: true };
  const first = buildPlan(rows, request);
  const kept = JSON.stringify(first);
  const second = buildPlan(rows, request);
  assert.deepEqual(second, first);
  buildPlan(rows, { inputs: inputs({ inboxes: 4 }), target: null, useGeneralists: false });
  assert.equal(JSON.stringify(first), kept);
  assert.equal(JSON.stringify(rows), frozen);
  // A target the inboxes can't reach in time is reported, with the inboxes that would.
  const big = buildPlan(rows, { inputs: inputs({ months: 1 }), target: 150, useGeneralists: false });
  assert.equal(big.reach!.fits, false);
  assert.ok(big.reach!.inboxesNeeded! > 1);
  // Blank target: plan for what the inboxes reach.
  const forward = buildPlan(rows, { inputs: inputs({ months: 1 }), target: null, useGeneralists: false });
  assert.equal(forward.target, forward.capacity.firms);
  assert.equal(forward.targetSource, "capacity");
});
