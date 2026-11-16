import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { isTrackedEmail, NO_TRACKING, parseResendEvent, portalViews, summarizeEvents, trackingParts } from "./email-tracking.ts";
import { resendSignatureValid } from "./email-tracking-signature.ts";

test("agreements and access links are never tracked; client updates are", () => {
  for (const key of ["client:statement_of_work_ready", "client:service_order_ready", "client:nda_ready", "nudge:nda", "nudge:sow", "nudge:service_order", "viewer_welcome"]) {
    assert.equal(isTrackedEmail(key), false, key);
  }
  for (const key of ["client:framing_ready", "client:investor_list_ready", "client:email_copy_ready", "client:question_answered", "nudge:setup:investor_list", "reminder", "feedback_replies", undefined, null]) {
    assert.equal(isTrackedEmail(key), true, String(key));
  }
});

test("reads Resend's events; a click carries its own time and link", () => {
  const now = "2026-11-16T21:00:00.000Z";
  assert.deepEqual(parseResendEvent({ type: "email.opened", created_at: "2026-11-16T20:40:00Z", data: { email_id: "abc" } }, now), {
    type: "opened",
    emailId: "abc",
    at: "2026-11-16T20:40:00.000Z",
    link: null,
  });
  assert.deepEqual(
    parseResendEvent({ type: "email.clicked", created_at: "2026-11-16T20:45:00Z", data: { email_id: "abc", click: { link: "https://www.heyrupert.com/portal", timestamp: "2026-11-16T20:44:30Z" } } }, now),
    { type: "clicked", emailId: "abc", at: "2026-11-16T20:44:30.000Z", link: "https://www.heyrupert.com/portal" },
  );
  // No usable time: the moment it was received.
  assert.equal(parseResendEvent({ type: "email.delivered", data: { email_id: "abc" } }, now)?.at, now);
});

test("ignores events it doesn't use and bodies without an email id", () => {
  const now = "2026-11-16T21:00:00.000Z";
  assert.equal(parseResendEvent({ type: "email.sent", data: { email_id: "abc" } }, now), null);
  assert.equal(parseResendEvent({ type: "contact.created", data: { id: "x" } }, now), null);
  assert.equal(parseResendEvent({ type: "email.opened", data: {} }, now), null);
  assert.equal(parseResendEvent("nope", now), null);
  assert.equal(parseResendEvent(null, now), null);
});

test("the state comes from every event, whatever order they arrived in", () => {
  const events = [
    { type: "clicked" as const, at: "2026-11-16T20:50:00.000Z" },
    { type: "opened" as const, at: "2026-11-16T20:48:00.000Z" },
    { type: "delivered" as const, at: "2026-11-16T20:37:10.000Z" },
    { type: "opened" as const, at: "2026-11-16T20:41:00.000Z" },
  ];
  const expected = {
    delivered_at: "2026-11-16T20:37:10.000Z",
    first_opened_at: "2026-11-16T20:41:00.000Z",
    last_opened_at: "2026-11-16T20:48:00.000Z",
    open_count: 2,
    first_clicked_at: "2026-11-16T20:50:00.000Z",
    click_count: 1,
    bounced_at: null,
  };
  assert.deepEqual(summarizeEvents(events), expected);
  assert.deepEqual(summarizeEvents([...events].reverse()), expected);
  assert.deepEqual(summarizeEvents([]), NO_TRACKING);
});

test("a spam complaint counts as not delivered to the reader, like a bounce", () => {
  assert.equal(summarizeEvents([{ type: "complained", at: "2026-11-16T21:00:00.000Z" }]).bounced_at, "2026-11-16T21:00:00.000Z");
});

test("portal view: only the newest email of a step, and only a view after it", () => {
  const emails = [
    { id: "new", template_key: "client:investor_list_ready", status: "sent", created_at: "2026-11-16T20:37:04.000Z" },
    { id: "old", template_key: "client:investor_list_ready", status: "sent", created_at: "2026-11-16T01:22:42.000Z" },
    { id: "framing", template_key: "client:framing_ready", status: "sent", created_at: "2026-11-11T18:26:40.000Z" },
    { id: "nda", template_key: "client:nda_ready", status: "sent", created_at: "2026-11-08T15:04:21.000Z" },
    { id: "failed", template_key: "client:email_copy_ready", status: "failed", created_at: "2026-11-17T10:00:00.000Z" },
  ];
  const steps = [
    { step: "investor_list", client_viewed_at: null },
    { step: "framing", client_viewed_at: "2026-11-15T08:29:18.000Z" },
    { step: "email_copy", client_viewed_at: null },
  ];
  assert.deepEqual(portalViews(emails, steps), { new: null, framing: "2026-11-15T08:29:18.000Z" });

  // Viewed the earlier version, then a new email went out: not viewed yet.
  const stale = portalViews(emails, [{ step: "investor_list", client_viewed_at: "2026-11-16T10:00:00.000Z" }]);
  assert.deepEqual(stale, { new: null });
});

test("the status line under an email", () => {
  const when = (iso: string) => iso.slice(11, 16);
  const text = (parts: { text: string }[]) => parts.map((p) => p.text).join(" · ");
  const opened = { ...NO_TRACKING, delivered_at: "2026-11-16T20:37:10.000Z", first_opened_at: "2026-11-16T20:41:00.000Z", last_opened_at: "2026-11-16T20:48:00.000Z", open_count: 2, first_clicked_at: "2026-11-16T20:50:00.000Z", click_count: 1 };

  assert.equal(text(trackingParts({ tracked: true, tracking: opened }, "2026-11-16T20:51:00.000Z", when)), "Delivered · Opened 2× (last 20:48) · Clicked a link 20:50 · Viewed in portal 20:51");
  assert.equal(text(trackingParts({ tracked: true, tracking: { ...NO_TRACKING, delivered_at: "2026-11-16T20:37:10.000Z" } }, null, when)), "Delivered · Not opened yet · Not viewed in portal yet");
  assert.equal(text(trackingParts({ tracked: true, tracking: { ...NO_TRACKING, bounced_at: "2026-11-16T20:38:00.000Z" } }, undefined, when)), "Bounced 20:38");
  // Untracked: no open or click claims, but a portal view still shows.
  assert.equal(text(trackingParts({ tracked: false, tracking: NO_TRACKING }, undefined, when)), "");
  assert.equal(text(trackingParts({ tracked: false, tracking: NO_TRACKING }, "2026-11-16T20:51:00.000Z", when)), "Viewed in portal 20:51");
});

test("Resend's signature: valid, wrong, stale, and one of several", () => {
  const secret = `whsec_${Buffer.from("a-signing-secret-of-some-length").toString("base64")}`;
  const body = JSON.stringify({ type: "email.opened", data: { email_id: "abc" } });
  const now = Date.parse("2026-11-16T21:00:00Z");
  const timestamp = String(now / 1000);
  const sign = (id: string, ts: string, raw: string, key = secret) =>
    createHmac("sha256", Buffer.from(key.slice("whsec_".length), "base64")).update(`${id}.${ts}.${raw}`).digest("base64");
  const good = `v1,${sign("msg_1", timestamp, body)}`;

  assert.equal(resendSignatureValid(secret, body, { id: "msg_1", timestamp, signature: good }, now), true);
  assert.equal(resendSignatureValid(secret, body, { id: "msg_1", timestamp, signature: `v1,bm90LXRoZS1zaWduYXR1cmU= ${good}` }, now), true);
  // A changed body, another delivery's id, a different secret.
  assert.equal(resendSignatureValid(secret, `${body} `, { id: "msg_1", timestamp, signature: good }, now), false);
  assert.equal(resendSignatureValid(secret, body, { id: "msg_2", timestamp, signature: good }, now), false);
  assert.equal(resendSignatureValid(`whsec_${Buffer.from("another-secret").toString("base64")}`, body, { id: "msg_1", timestamp, signature: good }, now), false);
  // Older than five minutes: a replay.
  assert.equal(resendSignatureValid(secret, body, { id: "msg_1", timestamp, signature: good }, now + 6 * 60 * 1000), false);
  // Missing pieces.
  assert.equal(resendSignatureValid(secret, body, { id: null, timestamp, signature: good }, now), false);
  assert.equal(resendSignatureValid(secret, body, { id: "msg_1", timestamp, signature: null }, now), false);
  assert.equal(resendSignatureValid("", body, { id: "msg_1", timestamp, signature: good }, now), false);
  assert.equal(resendSignatureValid(secret, body, { id: "msg_1", timestamp, signature: good.replace("v1,", "v2,") }, now), false);
});
