import assert from "node:assert/strict";
import { test } from "node:test";
import { companyInfo } from "./company-info.ts";
import type { MatchAnswers } from "../match/shared.ts";

test("the company at a glance: the one-liner apart, the profile's sections with filled fields only", () => {
  const answers = { company_name: "Clinipay", one_liner: " Payments for clinics. ", stage: "Seed", raise_amount: "$2M", website: "" } as unknown as MatchAnswers;
  const info = companyInfo(answers, { summary: "Clinics pay late.", industry: "Fintech", geography: "", stage: "Seed", raise_amount: "$2M", generated_at: "", based_on: "", edited_at: null });
  assert.equal(info.oneLiner, "Payments for clinics.");
  assert.deepEqual(info.sections[0], { title: "Overview", summary: "Clinics pay late.", rows: [{ label: "Industry", value: "Fintech" }, { label: "Stage", value: "Seed" }, { label: "Raising", value: "$2M" }] });
  const company = info.sections.find((section) => section.title === "Company");
  assert.deepEqual(company?.rows, [{ label: "Company name", value: "Clinipay" }]);
  assert.ok(info.sections.find((section) => section.title === "Round")?.rows.some((row) => row.label === "Raising" && row.value === "$2M"));
  assert.ok(info.sections.every((section) => section.rows.length > 0 || section.summary));
});

test("no profile and no brief: nothing to show", () => {
  assert.deepEqual(companyInfo(null, null), { oneLiner: "", sections: [] });
});
