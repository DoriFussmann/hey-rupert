import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAnalytics, percent } from "./analytics.ts";

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
