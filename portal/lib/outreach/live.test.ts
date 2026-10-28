import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LIVE_SETTINGS,
  asLiveSettings,
  campaignWeek,
  perDayForWeek,
  sendingPlan,
  weekLabel,
  weekRange,
  campaignBody,
  clientTotals,
  deliveryPatch,
  fundStage,
  goLiveGaps,
  inboxHealthy,
  isWave2Due,
  leadFor,
  leadsForWave,
  replyText,
  suggestsRelease,
  toInstantlyHtml,
} from "./live.ts";
import { emailsHash } from "./core.ts";

const emails = [
  { subject: "Ledgerline, seed", body: "Hi Ana,\n\nThree <lines>.\n\nDana" },
  { subject: "Ignored subject", body: "One more.\n\nDana" },
  { subject: "", body: "Last.\n\nDana" },
];

function message(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    person: { fid: "F1", name: "Ana Lopez", first_name: "Ana", title: "Partner", email: `${id}@north.vc`, seq: "Primary" },
    fund_name: "North Fund",
    emails,
    slot: "active" as const,
    status: "approved" as const,
    approved_hash: emailsHash(emails),
    position: 0,
    pushed_at: null as string | null,
    ...extra,
  };
}

test("settings are cleaned and fall back to safe defaults", () => {
  const s = asLiveSettings({ daily_limit: 999, timezone: "bad tz!", from: "18:00", to: "09:00", followup_days: [0, 3], track_opens: false });
  assert.equal(s.daily_limit, 200);
  assert.equal(s.timezone, "America/Detroit");
  assert.deepEqual([s.from, s.to], ["09:00", "17:00"]);
  assert.deepEqual(s.followup_days, [1, 3]);
  assert.equal(s.track_opens, false);
});

test("the campaign: three variable steps, follow-ups in the same thread, stop for company on reply", () => {
  const body = campaignBody("Acme · Hey Rupert", "dana@acme.com", asLiveSettings(null));
  const steps = body.sequences[0].steps;
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.variants[0].subject), ["{{subject_1}}", "", ""]);
  assert.deepEqual(steps.map((s) => s.delay), [4, 5, 0]);
  assert.equal(body.stop_for_company, true);
  assert.deepEqual(body.email_list, ["dana@acme.com"]);
  assert.deepEqual(Object.entries(body.campaign_schedule.schedules[0].days).filter(([, on]) => on).map(([d]) => d), ["1", "2", "3", "4", "5"]);
  const test = campaignBody("t", "dana@acme.com", asLiveSettings(null), { test: true });
  assert.equal(test.sequences[0].steps[0].delay_unit, "minutes");
});

test("a lead carries its own emails as HTML variables, opt-out on the first only", () => {
  const lead = leadFor(message("a"), "Not relevant? Tell me.");
  assert.equal(lead.custom_variables.body_1, "Hi Ana,<br/><br/>Three &lt;lines&gt;.<br/><br/>Dana<br/><br/>Not relevant? Tell me.");
  assert.equal(lead.custom_variables.body_2, "One more.<br/><br/>Dana");
  assert.equal(lead.last_name, "Lopez");
  assert.equal(leadFor(message("a"), "", "dori@test.com").email, "dori@test.com");
  assert.equal(toInstantlyHtml("a & b\r\nc"), "a &amp; b<br/>c");
});

test("waves push approved, unpushed, active contacts once each", () => {
  const edited = message("c");
  edited.emails = [{ subject: "x", body: "changed" }, emails[1], emails[2]];
  const all = [message("a"), message("b", { position: 1 }), edited, message("d", { pushed_at: "2026-10-26" }), message("e", { slot: "reserve" })];
  assert.deepEqual(leadsForWave(all, 1).map((m) => m.id), ["a"]);
  assert.deepEqual(leadsForWave(all, 2).map((m) => m.id), ["b"]);
  const now = Date.parse("2026-10-30T00:00:00Z");
  assert.ok(isWave2Due("2026-10-26T00:00:00Z", 3, now));
  assert.ok(!isWave2Due("2026-10-28T00:00:00Z", 3, now));
  assert.ok(!isWave2Due(null, 3, now));
});

test("Go Live gates, in the client's words", () => {
  assert.deepEqual(goLiveGaps({ campaignReady: true, inboxConnected: true, inboxHealthy: true, invoicePaid: true, alreadyLive: false }), []);
  const gaps = goLiveGaps({ campaignReady: false, inboxConnected: true, inboxHealthy: false, invoicePaid: false, alreadyLive: false });
  assert.equal(gaps.length, 3);
  assert.ok(inboxHealthy(1) && !inboxHealthy(2) && !inboxHealthy(-1) && !inboxHealthy(null));
});

test("events update delivery; unknown events change nothing", () => {
  assert.deepEqual(deliveryPatch("email_sent", "t", 2), { sent_at: "t", last_step: 2 });
  assert.deepEqual(deliveryPatch("lead_meeting_booked", "t", null), { meeting_at: "t" });
  assert.equal(deliveryPatch("link_clicked", "t", null), null);
});

test("reply text drops quoted history; labels suggest, Rupert decides", () => {
  assert.equal(replyText("Sounds good, Thursday?\n\nOn Mon, Oct 26, 2026 Dana wrote:\n> Hi", null), "Sounds good, Thursday?");
  assert.equal(replyText("", "<p>Yes&nbsp;please</p><p>Best</p>"), "Yes please\n\nBest");
  assert.ok(suggestsRelease("interested") && !suggestsRelease("out_of_office") && !suggestsRelease(null));
});

test("the client's pipeline counts released replies only", () => {
  const rows = [
    { firm_id: "A", fund_name: "A", pushed_at: "t", sent_at: "t", opened_at: "t", meeting_at: null, bounced_at: null },
    { firm_id: "A", fund_name: "A", pushed_at: "t", sent_at: null, opened_at: null, meeting_at: null, bounced_at: null },
  ];
  assert.equal(fundStage(rows, []), "contacted");
  assert.equal(fundStage(rows, [{ firm_id: "A", label: "pass" }]), "passed");
  assert.equal(fundStage(rows, [{ firm_id: "A", label: "pass" }, { firm_id: "A", label: "interested" }]), "replied");
  assert.equal(fundStage([{ ...rows[0], meeting_at: "t" }], []), "meeting");
  assert.equal(fundStage([{ ...rows[1], pushed_at: null }], []), null);
  assert.deepEqual(clientTotals(rows, [{ firm_id: "A", label: "interested" }]), { funds: 1, contacted: 1, opened: 1, replied: 1, meetings: 0 });
});

import { dripQueue, interleaveByTier, testAddress, testAddressId } from "./live.ts";

test("interleave: every stretch holds the tiers in proportion, order within a tier kept", () => {
  const items = [
    ...Array.from({ length: 2 }, (_, i) => ({ tier: 1, n: `c${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ tier: 2, n: `s${i}` })),
    ...Array.from({ length: 4 }, (_, i) => ({ tier: 3, n: `t${i}` })),
  ];
  const out = interleaveByTier(items);
  assert.equal(out.length, 12);
  // The first 6 already hold every tier, roughly 1 : 3 : 2.
  const first = out.slice(0, 6).map((x) => x.tier);
  assert.deepEqual([1, 2, 3].map((t) => first.filter((x) => x === t).length), [1, 3, 2]);
  assert.deepEqual(out.filter((x) => x.tier === 2).map((x) => x.n), ["s0", "s1", "s2", "s3", "s4", "s5"]);
});

function qm(id: string, firm: string, tier: number, position: number, extra: Record<string, unknown> = {}) {
  const m = message(id, { position, ...extra }) as ReturnType<typeof message> & { tier: number; firm_id: string };
  return { ...m, tier, firm_id: firm };
}

test("drip: a daily batch, second contacts only after their fund's first plus the delay", () => {
  const day = 86_400_000;
  const now = Date.parse("2026-11-10T12:00:00Z");
  const sentFiveDaysAgo = new Date(now - 5 * day).toISOString();
  const sentYesterday = new Date(now - day).toISOString();
  const all = [
    qm("a1", "A", 1, 0, { pushed_at: sentFiveDaysAgo }),
    qm("a2", "A", 1, 1),
    qm("b1", "B", 2, 0, { pushed_at: sentYesterday }),
    qm("b2", "B", 2, 1),
    qm("c1", "C", 2, 0),
    qm("d1", "D", 3, 0),
    qm("e2", "E", 4, 1),
  ];
  const queue = dripQueue(all, { delayDays: 3, releasedEarly: false, limit: 0, now });
  // a2 is due (A went out 5 days ago); b2 is not yet; E has no first contact, so e2 counts as a first.
  assert.deepEqual(queue.map((m) => m.id), ["a2", ...interleaveByTier([all[4], all[5], all[6]]).map((m) => m.id)]);
  assert.equal(dripQueue(all, { delayDays: 3, releasedEarly: false, limit: 2, now }).length, 2);
  assert.ok(dripQueue(all, { delayDays: 3, releasedEarly: true, limit: 0, now }).some((m) => m.id === "b2"));
});

test("test addresses go to the test inbox and map back to the contact", () => {
  const address = testAddress("dori@thenightventures.com", { id: "1a2b3c4d-0000-0000-0000-000000000000", fund_name: "Acre Venture Partners", person: { first_name: "Lucas" } });
  assert.equal(address, "dori+acre-venture-partner-lucas-1a2b3c4d@thenightventures.com");
  assert.equal(testAddressId(address), "1a2b3c4d");
  assert.equal(testAddressId("lucas@acre.vc"), null);
});

test("test mode campaigns run in minutes, every day, without stop-for-company", () => {
  const body = campaignBody("t", "dori@x.com", asLiveSettings(null), { testMode: true });
  assert.equal(body.sequences[0].steps[0].delay_unit, "minutes");
  assert.equal(body.stop_for_company, false);
  assert.equal(campaignBody("t", "dori@x.com", asLiveSettings(null)).stop_for_company, true);
});

test("Eastern by default; America/New_York becomes Instantly's America/Detroit", () => {
  assert.equal(asLiveSettings(null).timezone, "America/Detroit");
  assert.equal(asLiveSettings({ timezone: "America/New_York" }).timezone, "America/Detroit");
  assert.deepEqual(asLiveSettings({ ramp: [5, "x", 8] }).ramp, [5, 8]);
});

test("the ramp: 10 a day in week 1, 20 in week 2, then 30", () => {
  const s = asLiveSettings(null);
  assert.deepEqual([1, 2, 3, 9].map((w) => perDayForWeek(s, w)), [10, 20, 30, 30]);
  assert.equal(perDayForWeek({ ...s, new_per_day: 0 }, 1), 0);
});

test("campaign weeks are 5 weekdays from the launch day", () => {
  assert.equal(campaignWeek("2026-11-04", "2026-11-04"), 1);
  assert.equal(campaignWeek("2026-11-04", "2026-11-10"), 1);
  assert.equal(campaignWeek("2026-11-04", "2026-11-11"), 2);
  assert.deepEqual(weekRange("2026-11-02", 2), { start: "2026-11-09", end: "2026-11-13" });
  assert.equal(weekLabel("2026-11-30", "2026-12-04"), "Nov 30 – Dec 4");
});

test("the sending plan reaches everyone, marks the current week, then follow-ups only", () => {
  const plan = sendingPlan({ total: 300, settings: DEFAULT_LIVE_SETTINGS, launchDay: "2026-11-02", today: "2026-11-17" });
  assert.equal(plan.reduce((n, w) => n + w.newInvestors, 0), 300);
  assert.deepEqual(plan.slice(0, 3).map((w) => [w.phase, w.perDay, w.status]), [
    ["Warm-up", 10, "done"],
    ["Ramp-up", 20, "done"],
    ["Full pace", 30, "current"],
  ]);
  assert.equal(plan[plan.length - 1].phase, "Follow-ups only");
  assert.ok(plan.every((w) => w.emails <= DEFAULT_LIVE_SETTINGS.daily_limit * 5));
  const before = sendingPlan({ total: 40, settings: DEFAULT_LIVE_SETTINGS, launchDay: "2026-11-02", today: null });
  assert.equal(before[0].status, "next");
});
