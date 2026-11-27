import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAnalytics, percent, whoGotIt, whoOpened } from "./analytics.ts";

const tz = "America/Detroit";
const messages = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", email: "ann@vc.com", tier: 1, fund_type: "VC", meeting_at: "2026-11-10T15:00:00Z" },
  { id: "bbbbbbbb-0000-0000-0000-000000000002", email: "bo@fo.com", tier: 2, fund_type: "Family office", meeting_at: null },
];
const at = (day: string) => `${day}T15:00:00Z`;
const events = [
  { event_type: "email_sent", lead_email: "ann@vc.com", step: 1, at: at("2026-11-02") },
  { event_type: "email_opened", lead_email: "ann@vc.com", step: 1, at: at("2026-11-02") },
  { event_type: "email_opened", lead_email: "ann@vc.com", step: 1, at: at("2026-11-03") },
  { event_type: "email_sent", lead_email: "bo@fo.com", step: 1, at: at("2026-11-02") },
  { event_type: "email_bounced", lead_email: "bo@fo.com", step: 1, at: at("2026-11-02") },
  // Test mode: a + alias ending with the contact's id prefix.
  { event_type: "email_sent", lead_email: "me+fund-ann-aaaaaaaa@x.com", step: 2, at: at("2026-11-09") },
];
const replies = [
  { message_id: messages[0].id, lead_email: "ann@vc.com", at: at("2026-11-09"), auto: false },
  { message_id: null, lead_email: "bo@fo.com", at: at("2026-11-09"), auto: true },
];

test("totals, splits and opens counted once per contact and email", () => {
  const all = computeAnalytics({ messages, events, replies, timeZone: tz, period: { from: null, to: null }, days: [] });
  assert.deepEqual([all.totals.sent, all.totals.bounced, all.totals.delivered, all.totals.opened], [3, 1, 2, 1]);
  assert.equal(all.totals.replies, 1, "auto-replies don't count");
  assert.equal(all.totals.meetings, 1);
  assert.deepEqual(all.tiers.map((r) => [r.name, r.sent]), [["Core", 2], ["Sphere", 1]]);
  assert.deepEqual(all.types.map((r) => r.name), ["VC", "Family office"]);
  assert.equal(percent(all.totals.openRate), "50%");
});

test("a period keeps only its days, and charts the days it is given", () => {
  const week1 = computeAnalytics({ messages, events, replies, timeZone: tz, period: { from: "2026-11-02", to: "2026-11-06" }, days: ["2026-11-02", "2026-11-03"] });
  assert.equal(week1.totals.sent, 2);
  assert.equal(week1.totals.replies, 0);
  assert.deepEqual(week1.daily, [{ day: "2026-11-02", sent: 2 }, { day: "2026-11-03", sent: 0 }]);
  assert.equal(percent(null), "–");
});

test("whoOpened: by fund, newest first, each contact once per email; names only when given", () => {
  const messages = [
    { id: "a", email: "ana@north.vc", tier: 1, fund_type: "VC", fund_name: "North", firm_id: "N", person_name: "Ana Lopez", person_title: "Partner" },
    { id: "b", email: "ben@north.vc", tier: 1, fund_type: "VC", fund_name: "North", firm_id: "N" },
    { id: "c", email: "cy@south.vc", tier: 2, fund_type: "VC", fund_name: "South", firm_id: "S" },
  ];
  const ev = (event_type: string, lead_email: string, step: number, at: string) => ({ event_type, lead_email, step, at });
  const events = [
    ev("email_sent", "ana@north.vc", 1, "2026-11-27T15:00:00Z"),
    ev("email_sent", "ben@north.vc", 1, "2026-11-27T15:10:00Z"),
    ev("email_sent", "cy@south.vc", 1, "2026-11-27T15:20:00Z"),
    ev("email_opened", "ana@north.vc", 1, "2026-11-27T16:00:00Z"),
    ev("email_opened", "ana@north.vc", 1, "2026-11-27T16:30:00Z"),
    ev("email_opened", "cy@south.vc", 1, "2026-11-27T17:00:00Z"),
  ];
  const funds = whoOpened({ messages, events, timeZone: "America/Detroit", period: { from: null, to: null } });
  assert.deepEqual(funds.map((f) => f.fund), ["South", "North"]);
  const north = funds[1];
  assert.equal(north.opened, 1);
  assert.equal(north.emailed, 2);
  assert.equal(north.opens, 1, "two opens of one email count once");
  assert.equal(north.lastAt, "2026-11-27T16:30:00Z");
  assert.deepEqual(north.people[0], { name: "Ana Lopez", title: "Partner", steps: [1], lastAt: "2026-11-27T16:30:00Z" });
  assert.equal(funds[0].people[0].name, "");
  assert.equal(whoOpened({ messages, events, timeZone: "America/Detroit", period: { from: "2026-11-28", to: null } }).length, 0);
});

test("whoGotIt: funds emailed, newest first, delivered = sent - bounced, per contact and email", () => {
  const messages = [
    { id: "a", email: "ana@north.vc", tier: 1, fund_type: "VC", fund_name: "North", firm_id: "N", person_name: "Ana Lopez", person_title: "Partner" },
    { id: "b", email: "ben@north.vc", tier: 1, fund_type: "VC", fund_name: "North", firm_id: "N" },
    { id: "c", email: "cy@south.vc", tier: 2, fund_type: "VC", fund_name: "South", firm_id: "S" },
  ];
  const ev = (event_type: string, lead_email: string, step: number, at: string) => ({ event_type, lead_email, step, at });
  const events = [
    ev("email_sent", "ana@north.vc", 1, "2026-11-27T15:00:00Z"),
    ev("email_sent", "ben@north.vc", 1, "2026-11-27T15:10:00Z"),
    ev("email_bounced", "ben@north.vc", 1, "2026-11-27T15:11:00Z"),
    ev("email_sent", "cy@south.vc", 1, "2026-11-27T15:20:00Z"),
    ev("email_opened", "cy@south.vc", 1, "2026-11-27T17:00:00Z"),
  ];
  const funds = whoGotIt({ messages, events, timeZone: "America/Detroit", period: { from: null, to: null } });
  assert.deepEqual(funds.map((f) => f.fund), ["South", "North"]);
  const north = funds[1];
  assert.deepEqual([north.emailed, north.bounced, north.sent, north.delivered], [2, 1, 2, 1]);
  assert.equal(north.lastAt, "2026-11-27T15:11:00Z");
  assert.equal(north.people.find((p) => p.name === "Ana Lopez")?.bounced, false);
  assert.equal(funds[0].lastAt, "2026-11-27T15:20:00Z", "an open is not a send");
});
