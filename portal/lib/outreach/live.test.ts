import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asLiveSettings,
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
  assert.equal(s.timezone, "America/Chicago");
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
