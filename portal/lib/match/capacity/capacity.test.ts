import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredResult } from "../tiers/stored.ts";
import {
  CORE_CAP,
  DEFAULT_SPLIT,
  ZERO_COUNTS,
  actualSplit,
  allocateCounts,
  poolsOf,
  sizesOf,
  suggestCounts,
  weightProblems,
  type Counts,
  type RemovedFirm,
} from "./allocate.ts";
import { buildPlan, confirmProblems, monthsNeeded, planProblems, type PlanRequest } from "./plan.ts";
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
  assert.throws(() => buildPlan([], { inputs: inputs(), counts: { ...ZERO_COUNTS }, useGeneralists: false, removed: [] }));
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

const counts = (values: Partial<Counts>): Counts => ({ ...ZERO_COUNTS, ...values });
const request = (extra: Partial<PlanRequest> = {}): PlanRequest => ({
  inputs: inputs(),
  counts: null,
  useGeneralists: false,
  weights: DEFAULT_SPLIT,
  removed: [],
  ...extra,
});

test("6. suggested split: Core first, capped at 10; the rest 40 / 35 / 25", () => {
  const sizes = sizesOf(poolsOf(fixture()));
  assert.deepEqual(sizes, { core: 14, sphere: 30, tier3: 40, tier4: 50, generalist: 25 });
  assert.deepEqual(suggestCounts(sizes, 110, false), counts({ core: CORE_CAP, sphere: 30, tier3: 40, tier4: 30 }));
  // With room everywhere, 100 after Core splits exactly 40 / 35 / 25.
  const plenty = { core: 20, sphere: 500, tier3: 500, tier4: 500, generalist: 0 };
  assert.deepEqual(suggestCounts(plenty, 110, false), counts({ core: 10, sphere: 40, tier3: 35, tier4: 25 }));
  assert.deepEqual(suggestCounts(plenty, 5, false), counts({ core: 5 }));
  assert.deepEqual(suggestCounts(plenty, 0, false), counts({}));
  // Every suggestion adds up to the total while the tiers have room.
  for (const total of [11, 37, 99, 333, 1000]) {
    const suggested = suggestCounts(plenty, total, false);
    assert.equal(Object.values(suggested).reduce((a, b) => a + b, 0), total, String(total));
  }
});

test("7. short tiers pass the rest on; generalists only when approved; nothing is manufactured", () => {
  const sizes = { core: 3, sphere: 2, tier3: 1, tier4: 4, generalist: 25 };
  assert.deepEqual(suggestCounts(sizes, 50, false), counts({ core: 3, sphere: 2, tier3: 1, tier4: 4 }));
  assert.deepEqual(suggestCounts(sizes, 50, true), counts({ core: 3, sphere: 2, tier3: 1, tier4: 4, generalist: 25 }));
  assert.deepEqual(suggestCounts(sizes, 20, true), counts({ core: 3, sphere: 2, tier3: 1, tier4: 4, generalist: 10 }));
  // No shortage: no generalists, even when approved.
  assert.equal(suggestCounts({ core: 20, sphere: 500, tier3: 500, tier4: 500, generalist: 25 }, 200, true).generalist, 0);
});

test("8. allocation takes each tier's best funds and reports Available, Planned and Short", () => {
  const pools = poolsOf(fixture({ core: 14, sphere: 30, tier3: 5, tier4: 50 }));
  const plan = allocateCounts(pools, counts({ core: 10, sphere: 12, tier3: 8, tier4: 20 }));
  assert.deepEqual(
    plan.rows.map((r) => [r.source, r.available, r.planned, r.short]),
    [["core", 14, 10, 0], ["sphere", 30, 12, 0], ["tier3", 5, 5, 3], ["tier4", 50, 20, 0], ["generalist", 25, 0, 0]],
  );
  assert.equal(plan.shortfall, 3);
  assert.equal(plan.planned, 47);
  assert.deepEqual(plan.firms.slice(0, 2).map((f) => f.firmId), ["C1", "C2"]);
  assert.ok(plan.firms.filter((f) => f.firmId.startsWith("G")).length === 0);
});

test("9–10. each firm once; excluded, unresolved, near-miss, rejected and represented firms never enter", () => {
  const pools = poolsOf(fixture());
  const all = allocateCounts(pools, counts({ core: 100, sphere: 100, tier3: 100, tier4: 100, generalist: 100 }));
  const ids = all.firms.map((f) => f.firmId.replace(/#\d+$/, ""));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["X1", "N1", "U1", "R1", "O2", "C1#2"]) assert.ok(!all.firms.some((f) => f.firmId === id), id);
  assert.equal(all.planned, 14 + 30 + 40 + 50 + 25);
  assert.ok(all.firms.filter((f) => f.firmId.startsWith("G")).every((f) => f.source === "generalist"));
});

test("11. removing a fund: the next one in its tier moves in, and it stays out", () => {
  const pools = poolsOf(fixture());
  const before = allocateCounts(pools, counts({ core: 10, sphere: 5 }));
  const removed: RemovedFirm[] = [{ firmId: "S2", name: "Fund S2", source: "sphere", reason: "Founder knows them", by: "a@b.c", at: "2026-10-21T00:00:00Z" }];
  const after = allocateCounts(pools, counts({ core: 10, sphere: 5 }), removed);
  assert.deepEqual(after.firms.filter((f) => f.source === "sphere").map((f) => f.firmId), ["S1", "S3", "S4", "S5", "S6"]);
  assert.equal(after.planned, before.planned);
  assert.equal(after.rows[1].available, 29);
  assert.deepEqual(after.removed, removed);
  // A tier with nothing left to replace it comes up short.
  const small = poolsOf(fixture({ core: 2 }));
  const out: RemovedFirm[] = [{ ...removed[0], firmId: "C1", source: "core" }];
  assert.equal(allocateCounts(small, counts({ core: 2 }), out).rows[0].short, 1);
  // The suggested split leaves removed funds out of the sizes too.
  assert.equal(sizesOf(pools, removed).sphere, 29);
});

test("12. plans: the same run and request give the same plan; checks; months needed", () => {
  const rows = fixture();
  const frozen = JSON.stringify(rows);
  const first = buildPlan(rows, request({ counts: counts({ core: 10, sphere: 20, tier3: 20, tier4: 20 }) }));
  const kept = JSON.stringify(first);
  assert.deepEqual(buildPlan(rows, request({ counts: counts({ core: 10, sphere: 20, tier3: 20, tier4: 20 }) })), first);
  buildPlan(rows, request({ inputs: inputs({ inboxes: 4 }) }));
  assert.equal(JSON.stringify(first), kept);
  assert.equal(JSON.stringify(rows), frozen);
  assert.equal(first.total, 70);
  assert.equal(first.fundsRequired, first.capacity.firms);
  assert.deepEqual(confirmProblems(first), []);
  // No counts: the suggested split of what the inboxes reach.
  const suggested = buildPlan(rows, request());
  assert.deepEqual(suggested.counts, suggestCounts(sizesOf(poolsOf(rows)), suggested.fundsRequired, false));
  // A shortage blocks confirming; Core over 10 and unapproved generalists are refused.
  const short = buildPlan(rows, request({ counts: counts({ tier3: 60 }) }));
  assert.ok(confirmProblems(short).some((p) => p.includes("short by 20")));
  assert.ok(planProblems(request({ counts: counts({ core: 11 }) })).some((p) => p.includes("capped at 10")));
  assert.ok(planProblems(request({ counts: counts({ generalist: 3 }) })).some((p) => p.includes("Approve generalists")));
  assert.ok(planProblems(request({ counts: counts({ core: 1.5 }) })).some((p) => p.includes("whole number")));
  // Months needed: the fewest months whose schedule fits the total.
  const oneMonth = schedule(inputs({ months: 1 })).firms;
  assert.equal(monthsNeeded(inputs(), oneMonth), 1);
  assert.equal(monthsNeeded(inputs(), oneMonth + 1), 2);
  const months = monthsNeeded(inputs(), 500)!;
  assert.ok(schedule(inputs({ months }), 500).firms >= 500);
  assert.ok(schedule(inputs({ months: months - 1 }), 500).firms < 500);
  assert.equal(monthsNeeded(inputs(), 1_000_000), null);
});

test("14. exhausted tiers: the rest is shared by weight, no tier over 1.5× its target, the remainder is a shortfall", () => {
  // The Test Pilot run: Tier 3 and Tier 4 run out; Sphere stops at 1.5 × 132 = 198, not 249.
  const pilot = { core: 721, sphere: 994, tier3: 13, tier4: 68, generalist: 133 };
  const suggested = suggestCounts(pilot, 340, false);
  assert.deepEqual(suggested, counts({ core: 10, sphere: 198, tier3: 13, tier4: 68 }));
  assert.equal(340 - Object.values(suggested).reduce((a, b) => a + b, 0), 51);
  // The real split is reported, not the weights.
  assert.deepEqual(actualSplit(suggested), { sphere: 71, tier3: 5, tier4: 24 });
  // One tier short: its share goes to the others by weight (40 : 25), within their ceilings.
  assert.deepEqual(suggestCounts({ core: 20, sphere: 500, tier3: 10, tier4: 500, generalist: 0 }, 110, false), counts({ core: 10, sphere: 55, tier3: 10, tier4: 35 }));
  // Small plans still add up.
  for (const total of [11, 12, 13, 17]) {
    const small = suggestCounts({ core: 20, sphere: 500, tier3: 500, tier4: 500, generalist: 0 }, total, false);
    assert.equal(Object.values(small).reduce((a, b) => a + b, 0), total, String(total));
  }
});

test("15. generalists top up a real shortfall only, and only when approved", () => {
  const pilot = { core: 721, sphere: 994, tier3: 13, tier4: 68, generalist: 133 };
  assert.equal(suggestCounts(pilot, 340, false).generalist, 0);
  assert.equal(suggestCounts(pilot, 340, true).generalist, 51);
  assert.equal(suggestCounts({ ...pilot, generalist: 20 }, 340, true).generalist, 20);
  assert.equal(suggestCounts({ core: 20, sphere: 500, tier3: 500, tier4: 500, generalist: 50 }, 110, true).generalist, 0);
});

test("16. weights: the admin's weights drive the suggestion, are checked, and are saved with the plan", () => {
  const plenty = { core: 20, sphere: 500, tier3: 500, tier4: 500, generalist: 0 };
  assert.deepEqual(suggestCounts(plenty, 110, false, { sphere: 50, tier3: 30, tier4: 20 }), counts({ core: 10, sphere: 50, tier3: 30, tier4: 20 }));
  assert.deepEqual(suggestCounts(plenty, 110, false, { sphere: 100, tier3: 0, tier4: 0 }), counts({ core: 10, sphere: 100 }));
  assert.deepEqual(weightProblems(DEFAULT_SPLIT), []);
  assert.ok(weightProblems({ sphere: 50, tier3: 30, tier4: 30 }).some((p) => p.includes("add up to 100")));
  assert.ok(weightProblems({ sphere: 50.5, tier3: 29.5, tier4: 20 }).some((p) => p.includes("whole number")));
  assert.throws(() => buildPlan([], request({ weights: { sphere: 90, tier3: 30, tier4: 0 } })));
  const plan = buildPlan(fixture(), request({ weights: { sphere: 50, tier3: 30, tier4: 20 } }));
  assert.deepEqual(plan.weights, { sphere: 50, tier3: 30, tier4: 20 });
  assert.deepEqual(plan.split, actualSplit(plan.counts));
  assert.equal(plan.unfilled, Math.max(0, plan.fundsRequired - plan.total));
});

