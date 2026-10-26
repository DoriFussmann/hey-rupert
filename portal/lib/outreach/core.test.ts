import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asQuickFacts,
  coreMessageIssues,
  coreSummary,
  emailsHash,
  firstNameOf,
  isApproved,
  personKey,
  researchIsFresh,
  selectCoreContacts,
  templateFor,
  type RunPerson,
} from "./core.ts";
import { asOutreachStyles, emptyTypedCopy, typeGroups } from "./copy.ts";

const person = (email: string, seq = "", score = 1, name = "Jane Doe"): RunPerson => ({ fid: "F1", key: email, name, title: "Partner", email, score, seq });

test("2 active contacts per fund: Primary, Backup, then the best of the rest; others are reserves", () => {
  const people = [person("c@f.com", "", 5), person("b@f.com", "Backup"), person("a@f.com", "Primary"), person("d@f.com", "", 9), person("", "", 99)];
  const picked = selectCoreContacts(people, () => false);
  assert.deepEqual(picked.active.map((p) => p.email), ["a@f.com", "b@f.com"]);
  assert.deepEqual(picked.reserve.map((p) => p.email), ["d@f.com", "c@f.com"]);
  assert.equal(picked.leftOut, 0);
});

test("a flagged Primary is skipped and the next best becomes active; repeats count once", () => {
  const people = [person("a@f.com", "Primary"), person("b@f.com", "Backup"), person("B@f.com"), person("c@f.com", "", 3)];
  const picked = selectCoreContacts(people, (p) => p.email === "a@f.com");
  assert.deepEqual(picked.active.map((p) => p.email), ["b@f.com", "c@f.com"]);
  assert.equal(picked.reserve.length, 0);
  assert.equal(picked.leftOut, 1);
});

test("first names drop honorifics; keys are FirmID plus lowercase email", () => {
  assert.equal(firstNameOf("Dr. Ana Lopez"), "Ana");
  assert.equal(firstNameOf("(no name)"), "");
  assert.equal(personKey({ fid: "F9", email: " Ana@Fund.com " }), "F9|ana@fund.com");
});

test("Quick Facts need a real link; at most five, no repeats", () => {
  const facts = asQuickFacts([
    { fact: "Led the seed of Acme in 2025", url: "https://fund.com/news", about: "fund" },
    { fact: "No source", url: "" },
    { fact: "Bad link", url: "javascript:alert(1)" },
    { fact: "led the seed of acme in 2025", url: "https://x.com" },
    { fact: "Writes about fintech", url: "https://blog.com/p", about: "person" },
  ]);
  assert.deepEqual(facts.map((f) => [f.fact, f.about]), [["Led the seed of Acme in 2025", "fund"], ["Writes about fintech", "person"]]);
});

test("research older than the cache window is stale", () => {
  const now = Date.parse("2026-10-26T00:00:00Z");
  assert.ok(researchIsFresh("2026-10-01T00:00:00Z", now));
  assert.ok(!researchIsFresh("2026-07-01T00:00:00Z", now));
  assert.ok(!researchIsFresh(null, now));
});

test("a personal email may not keep {{fields}}; approval holds only for the approved text", () => {
  const emails = [{ subject: "Ledgerline", body: "Hi {{first_name}}, short.\n\nDana" }, { subject: "", body: "More.\n\nDana" }, { subject: "", body: "Last.\n\nDana" }];
  const issues = coreMessageIssues(emails, 80).filter((i) => i.level === "error");
  assert.equal(issues.length, 1);
  assert.match(issues[0].text, /still has \{\{first_name\}\}/);

  const message = { status: "approved" as const, approved_hash: emailsHash(emails), emails };
  assert.ok(isApproved(message));
  assert.ok(!isApproved({ ...message, emails: [{ ...emails[0], body: "Edited" }, emails[1], emails[2]] }));
});

test("summary counts active contacts only", () => {
  const emails = [{ subject: "s", body: "b" }];
  const rows = [
    { firm_id: "A", slot: "active" as const, status: "approved" as const, approved_hash: emailsHash(emails), emails },
    { firm_id: "A", slot: "active" as const, status: "drafted" as const, approved_hash: null, emails },
    { firm_id: "A", slot: "reserve" as const, status: "pending" as const, approved_hash: null, emails: [] },
    { firm_id: "B", slot: "active" as const, status: "error" as const, approved_hash: null, emails: [] },
  ];
  assert.deepEqual(coreSummary(rows), { funds: 2, active: 3, reserve: 1, written: 2, approved: 1, failed: 1 });
});

test("each Core contact is written from its type's template, or the group its type was merged into", () => {
  const row = (id: string, fund_type: string) => ({ id, fund_name: id, contact: "", details: "", tier: 1 as const, why: "", comments: "", fund_type });
  const typed = emptyTypedCopy(typeGroups([row("1", "VC"), row("2", "VC"), row("3", "VC"), row("4", "Family office")]), asOutreachStyles(null));
  assert.equal(templateFor(typed, "VC")?.type, "VC");
  assert.equal(templateFor(typed, "Family office")?.type, "Other");
  assert.equal(templateFor(typed, "Angel group")?.type, "Other");
  assert.equal(templateFor(null, "VC"), null);
});
