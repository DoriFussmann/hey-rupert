// The company at a glance, beside the email editor: a one-liner and the
// Company Profile's sections, filled fields only. Pure module.

import { MATCH_SECTIONS, fieldDisplay, sectionFields, type MatchAnswers } from "../match/shared.ts";
import type { IntakeBrief } from "../intake.ts";

export type CompanyInfo = {
  /** What the company is, in one line. Empty: none on file. */
  oneLiner: string;
  /** The Company Profile's sections, in its order; a section with nothing filled is left out. */
  sections: { title: string; summary?: string; rows: { label: string; value: string }[] }[];
};

export function companyInfo(answers: MatchAnswers | null, brief: IntakeBrief | null): CompanyInfo {
  const sections: CompanyInfo["sections"] = [];
  if (brief) {
    const rows = [
      { label: "Industry", value: brief.industry },
      { label: "Geography", value: brief.geography },
      { label: "Stage", value: brief.stage },
      { label: "Raising", value: brief.raise_amount },
    ]
      .map((row) => ({ ...row, value: row.value.trim() }))
      .filter((row) => row.value);
    if (brief.summary.trim() || rows.length) sections.push({ title: "Overview", summary: brief.summary.trim() || undefined, rows });
  }
  const oneLiner = typeof answers?.one_liner === "string" ? answers.one_liner.trim() : "";
  if (answers) {
    for (const title of MATCH_SECTIONS) {
      const rows = sectionFields(title, answers)
        // The one-liner has its own place.
        .filter((field) => field.id !== "one_liner")
        .map((field) => ({ label: field.label, value: fieldDisplay(field, answers[field.id]) ?? "" }))
        .filter((row) => row.value);
      if (rows.length) sections.push({ title, rows });
    }
  }
  return { oneLiner, sections };
}
