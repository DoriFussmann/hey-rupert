import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanInvestor, cleanInvestorList, investorKey, mergeInvestor } from "./investors.ts";

const backing = (competitorId: string, round = "", lead = false, sourceUrl = "https://news.example.com/a") => ({
  competitorId,
  competitor: competitorId.toUpperCase(),
  round,
  lead,
  sourceUrl,
});

test("the same investor: suffixes and punctuation don't matter", () => {
  assert.equal(investorKey("Insight Partners"), investorKey("Insight"));
  assert.equal(investorKey("Andreessen Horowitz"), investorKey("andreessen-horowitz"));
  assert.notEqual(investorKey("Footwork"), investorKey("Acrew Capital"));
});

test("merging: one investor across two competitors keeps both, the longer name and any lead", () => {
  const a = cleanInvestor({ name: "Insight", source: "step2a", backed: [backing("stuut", "Series B")] }, "1")!;
  const b = cleanInvestor({ name: "Insight Partners", website: "insightpartners.com", source: "research", backed: [backing("monk", "Seed", true)] }, "2")!;
  const c = cleanInvestor({ name: "Insight Partners", source: "research", backed: [backing("stuut", "Series B", true)] }, "3")!;
  const list = [a, b, c].reduce((acc, x) => mergeInvestor(acc, x), [] as ReturnType<typeof cleanInvestorList>);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Insight Partners");
  assert.equal(list[0].website, "https://insightpartners.com/");
  assert.equal(list[0].source, "research");
  assert.deepEqual(
    list[0].backed.map((x) => [x.competitorId, x.round, x.lead]),
    [
      ["stuut", "Series B", true],
      ["monk", "Seed", true],
    ],
  );
});

test("the same website means the same investor, even under another name", () => {
  const a = cleanInvestor({ name: "a16z", website: "https://a16z.com", backed: [backing("x")] }, "1")!;
  const b = cleanInvestor({ name: "Andreessen Horowitz", website: "a16z.com/about", backed: [backing("y")] }, "2")!;
  assert.equal(mergeInvestor([a], b).length, 1);
});

test("list order: most competitors backed first, then leads, then by name", () => {
  const list = cleanInvestorList(
    [
      { name: "Zeta", backed: [backing("a"), backing("b")] },
      { name: "Alpha", backed: [backing("a")] },
      { name: "Beta", backed: [backing("a", "Seed", true)] },
      { name: "", backed: [] },
    ],
    (i) => `id${i}`,
  );
  assert.deepEqual(list.map((x) => x.name), ["Zeta", "Beta", "Alpha"]);
});
