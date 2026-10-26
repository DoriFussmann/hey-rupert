import assert from "node:assert/strict";
import { test } from "node:test";
import type { InvestorRow } from "../setup.ts";
import {
  DEFAULT_OPT_OUT_LINE,
  asOutreachStyles,
  asTypedCopy,
  emailIssues,
  emptyTypedCopy,
  fundTypeKey,
  outreachRows,
  presetFor,
  renderForTier,
  typeGroups,
  typedCopyIssues,
  type TypedCopy,
} from "./copy.ts";

function row(id: string, tier: 1 | 2 | 3 | 4, fund_type: string, extra: Partial<InvestorRow> = {}): InvestorRow {
  return { id, fund_name: `Fund ${id}`, contact: "", details: "", tier, why: "", comments: "", fund_type, ...extra };
}

test("fund types map from the list's short labels", () => {
  assert.equal(fundTypeKey("VC"), "VC");
  assert.equal(fundTypeKey("Corporate Venture Capital"), "VC");
  assert.equal(fundTypeKey("Family office"), "Family office");
  assert.equal(fundTypeKey("Angel group"), "Angel group");
  assert.equal(fundTypeKey("PE"), "PE");
  assert.equal(fundTypeKey("Accelerator"), "Other");
  assert.equal(fundTypeKey(""), "Other");
});

test("known funds leave the outreach unless overridden; excluded and hidden duplicates never enter", () => {
  const list = {
    rows: [row("A", 1, "VC"), row("B", 1, "VC"), row("C", 2, "VC"), row("D", 2, "VC", { hidden_duplicate: true })],
    client_flags: { A: { known: true }, B: { excluded: true } },
  };
  const plain = outreachRows(list);
  assert.deepEqual(plain.rows.map((r) => r.id), ["C"]);
  assert.deepEqual(plain.knownLeftOut.map((r) => r.id), ["A"]);
  const overridden = outreachRows(list, new Set(["A"]));
  assert.deepEqual(overridden.rows.map((r) => r.id), ["A", "C"]);
  assert.equal(overridden.knownLeftOut.length, 0);
});

test("groups split Core from the rest and merge small types into Other", () => {
  const rows = [
    row("1", 1, "VC"), row("2", 1, "VC"), row("3", 1, "VC"), row("4", 1, "Family office"),
    row("5", 2, "VC"), row("6", 3, "VC"), row("7", 4, "VC"),
    row("8", 2, "Angel group"), row("9", 3, "Angel group"), row("10", 4, "Angel group"),
    row("11", 3, "PE"), row("12", 2, "Accelerator"),
    row("13", 1, "VC", { broad: true }),
  ];
  const groups = typeGroups(rows);
  assert.deepEqual(groups.core.map((g) => [g.type, g.funds, g.merged]), [["VC", 3, []], ["Other", 1, ["Family office"]]]);
  // The approved generalist counts as Tier 4, not Core.
  const others = groups.others.map((g) => [g.type, g.funds, g.tiers, g.merged]);
  assert.deepEqual(others, [
    ["VC", 4, { 2: 1, 3: 1, 4: 2 }, []],
    ["Angel group", 3, { 2: 1, 3: 1, 4: 1 }, []],
    ["Other", 2, { 3: 1, 2: 1 }, ["PE"]],
  ]);
});

test("a lone small type keeps its own name", () => {
  const groups = typeGroups([row("1", 1, "Family office"), row("2", 1, "Family office")]);
  assert.deepEqual(groups.core.map((g) => [g.type, g.funds]), [["Family office", 2]]);
});

test("styles: defaults, cleaning and the section fallback", () => {
  const defaults = asOutreachStyles(null);
  assert.equal(presetFor(defaults, "core", "VC").id, "direct");
  assert.equal(defaults.opt_out_line, DEFAULT_OPT_OUT_LINE);

  const styles = asOutreachStyles({
    presets: [
      { id: "direct", label: "Direct", rules: "r", max_words: 9999, cta: "nope", example: "" },
      { id: "Bad Id", label: "x" },
      { id: "thesis_led", label: "Thesis", max_words: 120 },
    ],
    matrix: { "core:VC": "thesis_led", "others:VC": "missing", "core:*": "direct" },
    opt_out_line: "",
  });
  assert.equal(styles.presets.length, 2);
  assert.equal(styles.presets[0].max_words, 400);
  assert.equal(styles.presets[0].cta, "question");
  assert.equal(presetFor(styles, "core", "VC").id, "thesis_led");
  assert.equal(presetFor(styles, "core", "PE").id, "direct");
  assert.equal(presetFor(styles, "others", "VC").id, "direct");
  assert.equal(styles.opt_out_line, "", "a deliberately blank opt-out line stays blank");
});

function filledCopy(): TypedCopy {
  const styles = asOutreachStyles(null);
  const copy = emptyTypedCopy(typeGroups([row("1", 1, "VC"), row("2", 1, "VC"), row("3", 1, "VC"), row("4", 2, "VC"), row("5", 3, "VC"), row("6", 3, "VC")]), styles, "run-1");
  const email = (subject: string) => ({ subject, body: "Hi {{first_name}},\n\nShort and plain.\n\nDana" });
  copy.core[0].approach = "VCs want the round and the proof.";
  copy.core[0].emails = [email("Ledgerline, seed"), email(""), email("")];
  copy.others[0].emails = [
    { subject: "Ledgerline, seed", body: "Hi {{first_name}},\n\n{{tier_line}}\n\nDana" },
    email(""),
    email(""),
  ];
  copy.others[0].tier_lines = { "2": "{{fund_name}} backs fintech next to ours.", "3": "You back finance software." };
  return copy;
}

test("complete copy has no errors and survives a round trip", () => {
  const copy = filledCopy();
  assert.deepEqual(typedCopyIssues(copy).filter((i) => i.level === "error"), []);
  const again = asTypedCopy(JSON.parse(JSON.stringify(copy)));
  assert.deepEqual(again, copy);
});

test("checks catch what the presets forbid", () => {
  const copy = filledCopy();
  copy.core[0].approach = "";
  copy.core[0].emails[0] = { subject: "Re: quick intro", body: "We are thrilled! Meet [Company]. {{tier_line}}" };
  copy.others[0].tier_lines = { "2": "Sphere line" };
  const text = typedCopyIssues(copy).filter((i) => i.level === "error").map((i) => `${i.where} ${i.text}`).join("\n");
  assert.match(text, /Core · VC needs an approach/);
  assert.match(text, /pretends to be a reply/);
  assert.match(text, /\{\{tier_line\}\}, which isn't available/);
  assert.match(text, /leftover \[placeholder\]/);
  assert.match(text, /exclamation mark/);
  assert.match(text, /hype words: thrilled/);
  assert.match(text, /needs a Tier 3 line/);
});

test("word caps are warnings: first email at the cap, follow-ups at three quarters", () => {
  const long = { subject: "s", body: Array(61).fill("word").join(" ") };
  assert.equal(emailIssues(long, 0, "core", 80, "x").length, 0);
  const follow = emailIssues({ subject: "", body: long.body }, 1, "core", 80, "x");
  assert.equal(follow.length, 1);
  assert.equal(follow[0].level, "warning");
});

test("rendering fills known fields, the tier line, and adds the opt-out line", () => {
  const copy = filledCopy();
  const out = renderForTier(copy.others[0], 0, 2, { first_name: "Alex", fund_name: "North Fund" }, copy.opt_out_line);
  assert.equal(out.body, `Hi Alex,\n\nNorth Fund backs fintech next to ours.\n\nDana\n\n${DEFAULT_OPT_OUT_LINE}`);
  const core = renderForTier(copy.core[0], 0, null, { first_name: "Alex" }, "");
  assert.equal(core.body, "Hi Alex,\n\nShort and plain.\n\nDana");
  const followUp = renderForTier(copy.others[0], 1, 2, { first_name: "Alex" }, copy.opt_out_line);
  assert.ok(!followUp.body.includes(DEFAULT_OPT_OUT_LINE), "follow-ups in the thread carry no opt-out line");
});
