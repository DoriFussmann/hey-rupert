import assert from "node:assert/strict";
import { test } from "node:test";
import { asEmailCopy, emailCopyHasContent, emailCopyProblems } from "../setup.ts";
import {
  asSourceCopy,
  bucketOf,
  emptySourceCopy,
  hookOf,
  outreachFunds,
  renderSourceEmail,
  sourceCopyIssues,
  sourceEmailIssues,
  sourceGroups,
  sourceValues,
  type PlanFundLike,
  type SourceCopy,
} from "./source-copy.ts";

function fund(firmId: string, extra: Partial<PlanFundLike> = {}): PlanFundLike {
  return { firmId, name: `Fund ${firmId}`, tier: "core", type: "VC", backed: [], sameStage: [], comparables: [], hit: ["Cannabis"], ...extra };
}

const plan = {
  funds: [
    fund("A", { backed: ["Curio", "SunMed"], sameStage: ["SunMed"], comparables: ["Sunderstorm"] }),
    fund("B", { comparables: ["Sunderstorm"], type: "PE" }),
    fund("C", { tier: "sphere", hit: ["Consumer goods"] }),
    fund("D", { comparables: ["Kiva"] }),
    fund("E", {}),
  ],
  planned: [
    { firmId: "A", tier: "core", rank: 1, slots: 2 },
    { firmId: "B", tier: "core", rank: 2, slots: 3 },
    { firmId: "C", tier: "sphere", rank: 1, slots: 1 },
    { firmId: "D", tier: "core", rank: 3, slots: 1 },
    { firmId: "E", tier: "core", rank: 4, slots: 0 },
    { firmId: "gone", tier: "core", rank: 5, slots: 2 },
  ],
};

test("source groups: a competitor backer first, then a look-alike backer, else market fit", () => {
  assert.equal(bucketOf(plan.funds[0]), "competitor");
  assert.equal(bucketOf(plan.funds[1]), "lookalike");
  assert.equal(bucketOf(plan.funds[2]), "market");
  assert.equal(bucketOf({ backed: [" "], comparables: [] }), "market");
});

test("the hook: the competitor backed at the client's stage, the company like this one, or the sector that placed the fund", () => {
  assert.equal(hookOf(plan.funds[0]), "SunMed");
  assert.equal(hookOf(fund("X", { backed: ["Curio"] })), "Curio");
  assert.equal(hookOf(plan.funds[1]), "Sunderstorm");
  assert.equal(hookOf(plan.funds[2]), "Consumer goods");
  assert.equal(hookOf(fund("Y", { hit: [] })), "");
});

test("outreach funds: only what the Plan reaches, with its slots, in Plan order", () => {
  const funds = outreachFunds(plan);
  assert.deepEqual(funds.map((f) => [f.firmId, f.bucket, f.contacts]), [
    ["A", "competitor", 2],
    ["B", "lookalike", 3],
    ["C", "market", 1],
    ["D", "lookalike", 1],
  ]);
  const groups = sourceGroups(funds);
  assert.deepEqual(groups.map((g) => [g.bucket, g.funds, g.contacts]), [
    ["competitor", 1, 2],
    ["lookalike", 2, 4],
    ["market", 1, 1],
  ]);
  const lookalike = groups[1];
  assert.deepEqual(lookalike.types, { PE: 1, VC: 1 });
  assert.deepEqual(lookalike.examples, ["Kiva", "Sunderstorm"]);
  assert.deepEqual(groups[2].tiers, { sphere: 1 });
});

const good: SourceCopy = {
  groups: [
    {
      bucket: "competitor",
      funds: 1,
      contacts: 2,
      types: { VC: 1 },
      tiers: { core: 1 },
      emails: [
        {
          subject: "Vault Extracts: $1M pre-seed",
          body: "Hi {{first_name}},\n\nI'm John, founder of Vault Extracts. Your fund backed {{backed_company}}, so I'll skip the primer. Three lines:\n\nSolventless products, wholesale to Maryland dispensaries.\nMy emulsion is in 150,000+ cans.\nRaising $1M pre-seed.\n\nWorth 20 minutes?\n\nJohn",
        },
        { subject: "", body: "{{first_name}}, one more line: every pack links to its lot test results. Worth 20 minutes?\n\nJohn" },
      ],
    },
  ],
  opt_out_line: "If this isn't relevant, tell me and I won't follow up.",
};

test("good copy has no problems", () => {
  assert.deepEqual(sourceCopyIssues(good), []);
});

test("checks: the hook field, 'your fund', a follow-up subject, unknown fields, links", () => {
  const noHook = sourceEmailIssues({ subject: "S", body: "Hi {{first_name}}, three lines." }, 0, "competitor");
  assert.ok(noHook.some((i) => i.level === "error" && i.text.includes("{{backed_company}}")));
  // Market fit without {{focus}} is only a warning.
  const market = sourceEmailIssues({ subject: "S", body: "Hi {{first_name}}, three lines." }, 0, "market");
  assert.ok(market.some((i) => i.level === "warning" && i.text.includes("{{focus}}")));
  assert.ok(!market.some((i) => i.level === "error"));

  const you = sourceEmailIssues({ subject: "S", body: "You backed {{backed_company}}." }, 0, "lookalike");
  assert.ok(you.some((i) => i.text.includes("your fund")));
  assert.ok(!sourceEmailIssues({ subject: "S", body: "Your fund backed {{backed_company}}." }, 0, "lookalike").some((i) => i.text.includes("your fund")));

  const thread = sourceEmailIssues({ subject: "New subject", body: "One more line." }, 1, "market");
  assert.ok(thread.some((i) => i.text.includes("same thread")));

  const wrong = sourceEmailIssues({ subject: "S", body: "{{focus}} and {{quick_fact}}" }, 0, "competitor");
  assert.ok(wrong.some((i) => i.level === "error" && i.text.includes("{{focus}}")));
  assert.ok(wrong.some((i) => i.level === "error" && i.text.includes("{{quick_fact}}")));

  const link = sourceEmailIssues({ subject: "S", body: "Your fund backed {{backed_company}}. See www.example.com" }, 0, "competitor");
  assert.ok(link.some((i) => i.text.includes("link")));

  const long = sourceEmailIssues({ subject: "S", body: `Your fund backed {{backed_company}}. ${"word ".repeat(95)}` }, 0, "competitor");
  assert.ok(long.some((i) => i.level === "warning" && i.text.includes("90")));

  assert.ok(sourceCopyIssues({ groups: [], opt_out_line: "" }).some((i) => i.level === "error"));
});

test("rendering fills the fund's values; the opt-out goes under the first email only", () => {
  const funds = outreachFunds(plan);
  const values = sourceValues(funds[0], "Dana");
  const first = renderSourceEmail(good.groups[0], 0, values, good.opt_out_line);
  assert.match(first.body, /^Hi Dana,/);
  assert.match(first.body, /Your fund backed SunMed,/);
  assert.ok(first.body.endsWith(good.opt_out_line));
  const follow = renderSourceEmail(good.groups[0], 1, values, good.opt_out_line);
  assert.ok(!follow.body.includes(good.opt_out_line));
  // A fund with no hook keeps the field, so the gap is visible.
  assert.match(renderSourceEmail(good.groups[0], 0, sourceValues({ name: "F", bucket: "competitor", hook: "" }), "").body, /\{\{backed_company\}\}/);
});

test("stored copy round-trips as copy v3 and blocks the push while a check fails", () => {
  const stored = asEmailCopy(JSON.parse(JSON.stringify({ tiers: {}, copy_version: 3, by_source: good })));
  assert.equal(stored.copy_version, 3);
  assert.equal(stored.by_source?.groups[0].emails.length, 2);
  assert.ok(emailCopyHasContent(stored));
  assert.deepEqual(emailCopyProblems(stored), []);

  const broken = asEmailCopy({ copy_version: 3, by_source: { ...good, groups: [{ ...good.groups[0], emails: [{ subject: "", body: "" }] }] } });
  assert.ok(emailCopyProblems(broken).length > 0);

  // Unknown groups, duplicates and extra emails are dropped; the order is fixed.
  const messy = asSourceCopy({
    groups: [
      { bucket: "market", emails: [{ subject: "a", body: "b" }, { subject: "", body: "c" }, { subject: "", body: "d" }] },
      { bucket: "nope", emails: [] },
      { bucket: "competitor", emails: [] },
      { bucket: "market", emails: [] },
    ],
  });
  assert.deepEqual(messy.groups.map((g) => g.bucket), ["competitor", "market"]);
  assert.equal(messy.groups[1].emails.length, 2);
  assert.ok(!emailCopyHasContent(asEmailCopy({ copy_version: 3, by_source: emptySourceCopy(sourceGroups(outreachFunds(plan)), "") })));
});
