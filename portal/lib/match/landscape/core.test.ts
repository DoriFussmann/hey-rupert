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
