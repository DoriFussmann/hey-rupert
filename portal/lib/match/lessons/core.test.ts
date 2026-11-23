import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanLabels, lessonsRevision, withLessons, type FundLesson } from "./core.ts";

const lesson = (firmId: string, field: FundLesson["field"], labels: string[]): FundLesson => ({ firmId, field, labels, note: "", by: null, at: "" });
const firm = (id: string) => ({ id, name: id, stages: ["Seed"], fin: ["Equity"], geo: ["Europe"], ind: [] as string[], vert: ["Fintech"] });
const sectorField = (l: string) => (l === "Software" ? "industry" : l === "Unknown" ? null : "vertical") as "industry" | "vertical" | null;

test("withLessons: adds the lesson's values to the right field, never removes, no duplicates", () => {
  const out = withLessons(
    [firm("F1"), firm("F2")],
    [lesson("F1", "geography", ["United States", "europe"]), lesson("F1", "stage", ["Series A"]), lesson("F1", "sector", ["Software", "Cannabis", "Unknown"])],
    (field, label) => (field === "geography" && label === "United States" ? "USA" : label),
    sectorField,
  );
  assert.deepEqual(out[0].geo, ["Europe", "USA"]);
  assert.deepEqual(out[0].stages, ["Seed", "Series A"]);
  assert.deepEqual(out[0].ind, ["Software"]);
  assert.deepEqual(out[0].vert, ["Fintech", "Cannabis"]);
  assert.deepEqual(out[0].fin, ["Equity"]);
  assert.deepEqual(out[1], firm("F2"));
});

test("withLessons: no lessons, the same firms", () => {
  const firms = [firm("F1")];
  assert.equal(withLessons(firms, [], (_f, l) => l, sectorField), firms);
});

test("lessonsRevision: empty when none, stable whatever the order, changes with the labels", () => {
  assert.equal(lessonsRevision([]), "");
  assert.equal(lessonsRevision([lesson("F1", "geography", [])]), "");
  const a = lessonsRevision([lesson("F1", "geography", ["United States", "Canada"]), lesson("F2", "stage", ["Seed"])]);
  const b = lessonsRevision([lesson("F2", "stage", ["Seed"]), lesson("F1", "geography", ["Canada", "United States"])]);
  assert.equal(a, b);
  assert.notEqual(a, lessonsRevision([lesson("F1", "geography", ["United States"])]));
});

test("cleanLabels: only allowed labels, once, in the allowed order", () => {
  assert.deepEqual(cleanLabels(["europe", "Mars", "United States", "Europe", 4], ["United States", "Canada", "Europe"]), ["United States", "Europe"]);
  assert.deepEqual(cleanLabels("United States", ["United States"]), []);
});
