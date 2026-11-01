import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanUrl, namesFromText, orderCompetitors, sameName } from "./core.ts";

test("links: a scheme is added; anything that isn't a web address is dropped", () => {
  assert.equal(cleanUrl("monk.com"), "https://monk.com/");
  assert.equal(cleanUrl("https://www.tesorio.com/about"), "https://www.tesorio.com/about");
  assert.equal(cleanUrl("not a url"), "");
  assert.equal(cleanUrl("javascript:alert(1)"), "");
  assert.equal(cleanUrl(""), "");
});

test("order: client-named first, one per name, at most 10, nameless rows dropped", () => {
  const items = [
    { name: "Monk", source: "web" },
    { name: "Stuut", source: "client" },
    { name: "monk ", source: "web" },
    { name: "", source: "web" },
    ...Array.from({ length: 12 }, (_, i) => ({ name: `Co ${i}`, source: "web" })),
  ];
  const list = orderCompetitors(items, (i) => `id${i}`);
  assert.equal(list.length, 10);
  assert.deepEqual(list.slice(0, 3).map((c) => c.name), ["Stuut", "Monk", "Co 0"]);
  assert.equal(list[0].source, "client");
  assert.equal(list[1].links.website, "unchecked");
});

test("names: matching ignores case and punctuation; 'None' gives no names", () => {
  assert.ok(sameName("Tesorio, Inc", "tesorio inc"));
  assert.ok(!sameName("", ""));
  assert.deepEqual(namesFromText("None"), []);
  assert.deepEqual(namesFromText("- Tesorio\n- Upflow, Monk"), ["Tesorio", "Upflow", "Monk"]);
});

test("matching fields: the stage comes from the round's name, the country from the HQ", async () => {
  const { stageFromRound, countryFromHq, cleanCompetitor } = await import("./core.ts");
  assert.equal(stageFromRound("$25M Series A"), "Series A");
  assert.equal(stageFromRound("$4M pre-seed"), "Pre-Seed");
  assert.equal(stageFromRound("€1M seed round"), "Seed");
  assert.equal(stageFromRound("$52.5M Series B"), "Series B");
  assert.equal(stageFromRound("Series D"), "Series C and Beyond");
  assert.equal(stageFromRound("$9M"), "");
  assert.equal(countryFromHq("San Francisco, CA"), "United States");
  assert.equal(countryFromHq("New York, USA"), "United States");
  assert.equal(countryFromHq("London, UK"), "United Kingdom");
  assert.equal(countryFromHq("Malmö, Sweden"), "Sweden");
  assert.equal(countryFromHq(""), "");
  // A list saved before these fields existed gets them from its round and HQ; the sector stays empty.
  const old = cleanCompetitor({ name: "Monk", hq: "New York, NY", funding: { lastRound: "$25M Series A" } }, "x")!;
  assert.deepEqual([old.stage, old.geography, old.primarySector], ["Series A", "United States", ""]);
});
