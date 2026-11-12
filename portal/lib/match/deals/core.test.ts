import assert from "node:assert/strict";
import { test } from "node:test";
import { DEALS_DECK_TITLE, MAX_TABLE_ROWS, asDealsDeck, deckCellText } from "./core.ts";

const table = (rows = 2) => ({
  kind: "table",
  tab: "Competitors",
  eyebrow: "Competitive Landscape",
  title: "Competitors Raised $10M",
  columns: [
    { key: "company", label: "Company", width: 40 },
    { key: "round", label: "Latest round", strong: true },
    { key: "list", label: "On your outreach list", align: "right" },
  ],
  rows: Array.from({ length: rows }, (_, i) => ({
    company: { text: `Acme ${i}`, sub: "Does AR" },
    round: { text: "$5M Seed", tag: "New" },
    list: { text: "2 backers", pill: "mint" },
  })),
  note: { tone: "navy", label: "Signal", text: "Two raised this year." },
});

const investors = () => ({
  kind: "investors",
  tab: "Investors",
  eyebrow: "Investor Layer",
  title: "3 Investors Backed One of These",
  stats: [{ value: "3", label: "on your list", highlight: true }, { value: "", label: "dropped" }],
  groups: [{ title: "Backed a competitor", tone: "mint", rows: [{ company: "Acme 0", investors: [{ name: "Fund One", tone: "orange" }, { name: "Fund Two" }, { name: " " }] }] }],
  legend: [{ tone: "mint", label: "competitor backer" }, { tone: "purple", label: "dropped" }],
});

test("a well-formed deck is kept, with the default title", () => {
  const deck = asDealsDeck({ slides: [table(), investors()] });
  assert.ok(deck);
  assert.equal(deck.title, DEALS_DECK_TITLE);
  assert.equal(deck.slides.length, 2);
  const first = deck.slides[0];
  assert.equal(first.kind, "table");
  if (first.kind === "table") {
    assert.equal(deckCellText(first.rows[0].company), "Acme 0");
    assert.deepEqual(first.rows[0].list, { text: "2 backers", pill: "mint" });
    assert.equal(first.columns[1].strong, true);
  }
});

test("empty stats, investors and unknown legend tones are dropped, the slide stays", () => {
  const deck = asDealsDeck({ slides: [investors()] });
  const slide = deck?.slides[0];
  assert.ok(slide && slide.kind === "investors");
  assert.equal(slide.stats.length, 1);
  assert.deepEqual(slide.groups[0].rows[0].investors, [{ name: "Fund One", tone: "orange" }, { name: "Fund Two" }]);
  assert.deepEqual(slide.legend, [{ tone: "mint", label: "competitor backer" }]);
});

test("one bad slide drops the whole deck", () => {
  assert.equal(asDealsDeck({ slides: [table(), { kind: "chart", tab: "X", title: "Y" }] }), null);
  assert.equal(asDealsDeck({ slides: [{ ...table(), title: "" }] }), null);
  assert.equal(asDealsDeck({ slides: [{ ...table(), rows: [{ round: "$5M Seed" }] }] }), null);
  assert.equal(asDealsDeck({ slides: [{ ...investors(), groups: [] }] }), null);
});

test("a table that would not fit a slide is refused", () => {
  assert.ok(asDealsDeck({ slides: [table(MAX_TABLE_ROWS)] }));
  assert.equal(asDealsDeck({ slides: [table(MAX_TABLE_ROWS + 1)] }), null);
});

test("anything that is not a deck is null", () => {
  for (const value of [null, undefined, "deck", [], {}, { slides: [] }, { slides: "x" }]) assert.equal(asDealsDeck(value), null);
});
