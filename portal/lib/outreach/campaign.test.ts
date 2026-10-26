import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXPORT_COLUMNS,
  buildBlockers,
  campaignSummary,
  exportRows,
  otherGroupFor,
  renderOtherEmails,
  textToHtml,
  tidyGreeting,
  toCsv,
  waveOf,
  type CampaignMessage,
} from "./campaign.ts";
import { asOutreachStyles, emptyTypedCopy, typeGroups } from "./copy.ts";
import { emailsHash } from "./core.ts";
import { parseCsv } from "../csv.ts";

const row = (id: string, tier: 1 | 2 | 3 | 4, fund_type: string) => ({ id, fund_name: id, contact: "", details: "", tier, why: "", comments: "", fund_type });

function message(id: string, extra: Partial<CampaignMessage> = {}): CampaignMessage {
  const emails = [
    { subject: "Ledgerline, seed", body: "Hi Ana,\n\nThree lines.\n\nDana" },
    { subject: "", body: "One more.\n\nDana" },
    { subject: "", body: "Last.\n\nDana" },
  ];
  return {
    id,
    firm_id: "F1",
    fund_name: "North Fund",
    fund_type: "VC",
    person: { fid: "F1", name: "Dr. Ana Maria Lopez", first_name: "Ana", title: "Partner", email: `${id}@north.vc`, seq: "Primary" },
    slot: "active",
    position: 0,
    emails,
    status: "approved",
    approved_hash: emailsHash(emails),
    tier: 1,
    ...extra,
  };
}

test("other tiers: each fund uses its type's sequence (or Other), with the tier line and names filled", () => {
  const typed = emptyTypedCopy(typeGroups([row("a", 2, "VC"), row("b", 3, "VC"), row("c", 4, "VC"), row("d", 2, "PE")]), asOutreachStyles(null));
  const vc = typed.others.find((g) => g.type === "VC")!;
  vc.emails = [
    { subject: "Ledgerline", body: "Hi {{first_name}},\n\n{{tier_line}}\n\nDana" },
    { subject: "", body: "More for {{fund_name}}.\n\nDana" },
    { subject: "", body: "Last.\n\nDana" },
  ];
  vc.tier_lines = { "2": "{{fund_name}} backs fintech next to ours.", "3": "Broader.", "4": "Weaker." };
  assert.equal(otherGroupFor(typed, "VC")?.type, "VC");
  assert.equal(otherGroupFor(typed, "PE")?.type, "Other", "a small type is written as part of Other");
  assert.equal(otherGroupFor(typed, "Angel group")?.type, "Other", "a type the copy never had falls back to Other");
  const vcOnly = emptyTypedCopy(typeGroups([row("a", 2, "VC"), row("b", 3, "VC"), row("c", 4, "VC")]), asOutreachStyles(null));
  assert.equal(otherGroupFor(vcOnly, "Angel group"), null, "no group at all: the fund can't be written");

  const emails = renderOtherEmails(vc, 2, { first_name: "Ana" }, "North Fund");
  assert.equal(emails[0].body, "Hi Ana,\n\nNorth Fund backs fintech next to ours.\n\nDana");
  assert.equal(emails[1].body, "More for North Fund.\n\nDana");
  assert.equal(tidyGreeting(renderOtherEmails(vc, 3, { first_name: "" }, "X"))[0].body, "Hi,\n\nBroader.\n\nDana");
});

test("blockers: client confirmation and every active Core contact approved", () => {
  const ok = buildBlockers({ copyConfirmed: true, copyByType: true, coreFunds: 1, core: [message("a"), message("r", { slot: "reserve", status: "pending", approved_hash: null })] });
  assert.deepEqual(ok, []);
  const edited = message("b");
  edited.emails = [{ ...edited.emails[0], body: "Changed" }, edited.emails[1], edited.emails[2]];
  const blocked = buildBlockers({ copyConfirmed: false, copyByType: true, coreFunds: 1, core: [edited] });
  assert.equal(blocked.length, 2);
  assert.match(blocked[1], /1 Core contact isn't approved: Dr. Ana Maria Lopez \(North Fund\)/);
  assert.match(buildBlockers({ copyConfirmed: true, copyByType: true, coreFunds: 2, core: [] })[0], /Line up and write/);
});

test("export: approved text only, opt-out on the first email, waves by position", () => {
  const edited = message("c", { position: 1 });
  edited.emails = [{ ...edited.emails[0], body: "Edited after approval" }, edited.emails[1], edited.emails[2]];
  const all = [message("a"), message("b", { position: 1 }), edited, message("r", { slot: "reserve" })];
  const { rows, skipped } = exportRows(all, "Not relevant? Tell me.", null);
  assert.deepEqual(rows.map((r) => r.email), ["a@north.vc", "b@north.vc"]);
  assert.deepEqual(skipped.map((m) => m.id), ["c"]);
  assert.equal(rows[0].body_1, "Hi Ana,\n\nThree lines.\n\nDana\n\nNot relevant? Tell me.");
  assert.equal(rows[0].body_2, "One more.\n\nDana");
  assert.equal(rows[0].last_name, "Maria Lopez");
  assert.equal(rows[0].tier, "Core");
  assert.equal(rows[1].wave, "2");
  assert.deepEqual(exportRows(all, "", 1).rows.map((r) => r.email), ["a@north.vc"]);
  assert.equal(waveOf({ position: 3 }), 2);
});

test("the CSV parses back with every column, multi-line bodies intact", () => {
  const { rows } = exportRows([message("a")], "Opt out line", null);
  const parsed = parseCsv(toCsv(rows));
  assert.deepEqual(parsed[0], [...EXPORT_COLUMNS]);
  assert.equal(parsed[1][EXPORT_COLUMNS.indexOf("body_1")], rows[0].body_1);
  assert.equal(textToHtml("Hi <b>,\n\nLine 1\nLine 2"), "<p>Hi &lt;b&gt;,</p><p>Line 1<br>Line 2</p>");
});

test("summary counts active contacts by tier and wave", () => {
  const summary = campaignSummary([message("a"), message("b", { position: 1, tier: 2, firm_id: "F2" }), message("r", { slot: "reserve" })]);
  assert.deepEqual(summary, { funds: 2, contacts: 2, wave1: 1, wave2: 1, byTier: { Core: 1, Sphere: 1 }, approved: 2 });
});
