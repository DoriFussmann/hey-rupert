// The company profile as one Markdown document, for "Download as Markdown"
// on the profile page. Pure module: the route loads the data.

import {
  EMPTY_FIELD_MEANS,
  MATCH_SECTIONS,
  NONE_OK_FIELDS,
  fieldDisplay,
  sectionFields,
  type MatchAnswers,
} from "../match/shared.ts";
import type { IntakeBrief } from "../intake.ts";
import {
  READINESS_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  type Classification,
  type CompanyProfile,
  type ProfileIssue,
  type Readiness,
} from "./core.ts";

export type ProfileMarkdownInput = {
  company: string;
  exportedAt: string;
  brief: IntakeBrief | null;
  answers: MatchAnswers;
  classification: { profile: CompanyProfile; readiness: Readiness; issues: ProfileIssue[] } | null;
};

function classLine(label: string, c: Classification | null) {
  return `- **${label}:** ${c ? `${c.label} (${STATUS_LABEL[c.status]})` : "Not set"}`;
}

function overview(brief: IntakeBrief) {
  const facts = [
    ["Industry", brief.industry],
    ["Geography", brief.geography],
    ["Stage", brief.stage],
    ["Raising", brief.raise_amount],
  ]
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `- **${label}:** ${value}`);
  return ["## Overview", brief.summary.trim(), ...(facts.length > 0 ? ["", ...facts] : [])].join("\n");
}

function classification({ profile, readiness, issues }: NonNullable<ProfileMarkdownInput["classification"]>) {
  const primary = profile.sectors.find((sector) => sector.role === "primary") ?? null;
  const secondaries = profile.sectors.filter((sector) => sector.role === "secondary");
  const lines = [
    "## Classification",
    `**Readiness:** ${READINESS_LABEL[readiness]}`,
    "",
    classLine("Primary sector", primary),
    ...secondaries.map((sector) => classLine("Secondary sector", sector)),
    classLine("Stage", profile.stage),
    classLine("HQ country", profile.hq.country),
    ...(profile.hq.state ? [classLine("HQ state", profile.hq.state)] : []),
    ...(profile.hq.city ? [`- **HQ city:** ${profile.hq.city}`] : []),
  ];
  if (issues.length > 0) {
    lines.push(
      "",
      "### Open points",
      ...issues.map((issue) => `- ${SEVERITY_LABEL[issue.severity]} · ${issue.field}: ${issue.message}`),
    );
  }
  return lines.join("\n");
}

function sections(answers: MatchAnswers) {
  return MATCH_SECTIONS.map((section) => {
    const rows = sectionFields(section, answers).map((field) => {
      const shown = fieldDisplay(field, answers[field.id]);
      const fallback = NONE_OK_FIELDS.has(field.id) ? "None" : EMPTY_FIELD_MEANS[field.id] ?? "Not provided";
      return `- **${field.label}:** ${shown ?? fallback}`;
    });
    return [`## ${section}`, ...rows].join("\n");
  });
}

export function companyProfileMarkdown(input: ProfileMarkdownInput) {
  const company = input.company.trim() || "Company";
  return [
    `# ${company}: Company Profile`,
    `Exported ${input.exportedAt.slice(0, 10)}.`,
    ...(input.brief ? [overview(input.brief)] : []),
    ...(input.classification ? [classification(input.classification)] : []),
    ...sections(input.answers),
  ].join("\n\n") + "\n";
}

/** A safe file name for the download, e.g. "acme-robotics-company-profile.md". */
export function profileFileName(company: string) {
  const slug = company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "company"}-company-profile.md`;
}
