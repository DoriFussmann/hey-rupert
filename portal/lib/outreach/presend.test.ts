import { test } from "node:test";
import assert from "node:assert/strict";
import { presendVerdict, spareFor, stepsVerdict, targetSendDay } from "./presend.ts";

const NOW = Date.parse("2026-11-24T04:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const role = (result: string, extra = {}) =>
  ({ result, currentTitle: "", newFirm: "", newFirmWebsite: "", newTitle: "", summary: "", evidence: [], ...extra }) as never;
const mailbox = (result: string) => ({ result, score: null, summary: "", suggestedEmail: "" }) as never;
const found = { result: "found", summary: "", evidence: [] } as never;
const notFound = { result: "not_found", summary: "", evidence: [] } as never;
const check = (steps: object, at = daysAgo(10), had_error = false) => ({ status: null, steps, checked_at: at, had_error });
const v = (input: Partial<Parameters<typeof presendVerdict>[0]>) =>
  presendVerdict({ delivery: null, check: null, decision: null, now: NOW, ...input });

test("no proof, no check: run the web search", () => {
  assert.deepEqual(v({}), { kind: "check", reuseMailbox: false });
});

test("our own sends: a reply or delivery in 180 days passes; a bounce fails", () => {
  const base = { last_sent_at: null, delivered_at: null, replied_at: null, bounced_at: null };
  assert.equal(v({ delivery: { ...base, delivered_at: daysAgo(30) } }).kind, "pass");
  assert.equal(v({ delivery: { ...base, replied_at: daysAgo(170) } }).kind, "pass");
  assert.equal(v({ delivery: { ...base, delivered_at: daysAgo(200) } }).kind, "check", "delivery older than 180 days");
  assert.equal(v({ delivery: { ...base, delivered_at: daysAgo(30), bounced_at: daysAgo(5) } }).kind, "fail");
  assert.equal(v({ delivery: { ...base, bounced_at: daysAgo(60), delivered_at: daysAgo(5) } }).kind, "pass", "delivered after the bounce");
});

test("Rupert's decision: remove fails, keep passes, a bounce still beats keep", () => {
  assert.equal(v({ decision: "remove", delivery: { last_sent_at: null, delivered_at: daysAgo(1), replied_at: null, bounced_at: null } }).kind, "fail");
  assert.equal(v({ decision: "keep" }).kind, "pass");
  assert.equal(v({ decision: "keep", delivery: { last_sent_at: null, delivered_at: null, replied_at: null, bounced_at: daysAgo(3) } }).kind, "fail");
});

test("a check under 180 days is reused; older or errored is not", () => {
  assert.equal(v({ check: check({ role: role("confirmed"), public: found }) }).kind, "pass");
  assert.equal(v({ check: check({ role: role("confirmed"), public: found }, daysAgo(181)) }).kind, "check");
  assert.equal(v({ check: check({ role: role("confirmed"), public: found }, daysAgo(1), true) }).kind, "check");
});

test("a fresh Verify Emails check without the address search gets it, reusing Hunter", () => {
  assert.deepEqual(v({ check: check({ role: role("confirmed"), mailbox: mailbox("accept_all") }) }), { kind: "check", reuseMailbox: true });
  assert.equal(v({ check: check({ role: role("confirmed"), mailbox: mailbox("valid") }) }).kind, "pass");
  assert.equal(v({ check: check({ role: role("left_firm"), mailbox: mailbox("valid") }) }).kind, "fail");
  assert.equal(v({ check: check({ role: role("confirmed"), mailbox: mailbox("invalid") }) }).kind, "fail");
});

test("steps: exact address found passes without Hunter; left the fund fails whatever else", () => {
  assert.equal(stepsVerdict({ role: role("not_found"), public: found })?.pass, true);
  assert.equal(stepsVerdict({ role: role("left_firm", { newFirm: "Acme" }), public: found })?.pass, false);
  assert.match(stepsVerdict({ role: role("left_firm", { newFirm: "Acme" }) })!.reason, /Acme/);
  assert.equal(stepsVerdict({ role: role("role_changed") })?.pass, false);
});

test("steps: catch-all servers pass only when the firm's format matches", () => {
  const p = (result: string) => ({ result, pattern: "first.last@" }) as never;
  assert.equal(stepsVerdict({ role: role("confirmed"), public: notFound, mailbox: mailbox("accept_all"), pattern: p("matches") })?.pass, true);
  assert.equal(stepsVerdict({ role: role("confirmed"), public: notFound, mailbox: mailbox("accept_all"), pattern: p("differs") })?.pass, false);
  assert.equal(stepsVerdict({ role: role("confirmed"), public: notFound, mailbox: mailbox("accept_all"), pattern: p("unknown") })?.pass, false);
  assert.equal(stepsVerdict({ role: role("confirmed"), public: notFound, mailbox: mailbox("unknown") })?.pass, false);
  assert.equal(stepsVerdict({ role: role("confirmed"), public: notFound }), null, "Hunter still to run");
});

test("the send day: tonight checks the next Business Day; before the push, today", () => {
  const tz = "America/Los_Angeles";
  // Mon Nov 23, 8pm PT (Tue 04:00 UTC): Tuesday.
  assert.equal(targetSendDay(Date.parse("2026-11-24T04:00:00Z"), tz), "2026-11-24");
  // Tue Nov 24, 5am PT (13:00 UTC), before the 15:00 UTC push: still Tuesday.
  assert.equal(targetSendDay(Date.parse("2026-11-24T13:00:00Z"), tz), "2026-11-24");
  // Wed Nov 25, 8pm PT: Thursday is Thanksgiving, so Friday.
  assert.equal(targetSendDay(Date.parse("2026-11-26T04:00:00Z"), tz), "2026-11-27");
  // Fri Nov 27, 8pm PT: Monday.
  assert.equal(targetSendDay(Date.parse("2026-11-28T04:00:00Z"), tz), "2026-11-30");
  assert.equal(targetSendDay(Date.parse("2026-11-24T04:00:00Z"), "America/New_York"), "2026-11-24");
});

test("spares: about 30% more than the day's room, at least 3", () => {
  assert.equal(spareFor(0), 0);
  assert.equal(spareFor(5), 3);
  assert.equal(spareFor(15), 5);
  assert.equal(spareFor(30), 9);
});
