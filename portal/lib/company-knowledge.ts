// "What Rupert Knows": the founder's view of everything Rupert works from,
// in one place. Pure module: which facts, summaries and files are shown,
// and only what was already shared with the founder (never a draft).

import type { IntakeBrief, IntakeSummaryItem } from "./intake.ts";
import { asMaterials, asNarrative, type MaterialFile } from "./setup.ts";

export type KnowledgeFact = { label: string; value: string };

type ClientFacts = {
  company_name?: string | null;
  company_website?: string | null;
  raise_stage?: string | null;
  raise_amount?: string | null;
  vertical?: string | null;
  geography?: string | null;
};

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

/** The company at a glance: the client record first, the intake brief where the record is empty. */
export function knowledgeFacts(client: ClientFacts, brief: Pick<IntakeBrief, "industry" | "geography" | "stage" | "raise_amount"> | null) {
  const facts: KnowledgeFact[] = [
    { label: "Company", value: text(client.company_name) },
    { label: "Website", value: text(client.company_website) },
    { label: "Stage", value: text(client.raise_stage) || text(brief?.stage) },
    { label: "Raising", value: text(client.raise_amount) || text(brief?.raise_amount) },
    { label: "Sector", value: text(client.vertical) || text(brief?.industry) },
    { label: "Based in", value: text(client.geography) || text(brief?.geography) },
  ];
  return facts.filter((fact) => fact.value);
}

const NOT_PROVIDED = /^not provided\.?$/i;

/** The intake summary the founder confirmed, without topics left empty. Null until confirmed. */
export function confirmedAnswers(
  interview: { status: string; summary: IntakeSummaryItem[] | null } | null,
): IntakeSummaryItem[] | null {
  if (!interview || interview.status !== "completed" || !interview.summary) return null;
  return interview.summary.filter((item) => text(item.answer) && !NOT_PROVIDED.test(text(item.answer)));
}

type StepRow = { step: string; status: string; version: number; published: unknown; draft: unknown } | null | undefined;

/**
 * Rupert's read of the company, as sent to the founder with the Outreach
 * Narrative, and the narrative's short version. Null until it was sent.
 */
export function sharedRead(framing: StepRow) {
  if (!framing || framing.version <= 0) return null;
  const narrative = asNarrative(framing.published);
  const read = narrative.feedback?.summary.trim() ?? "";
  const story = narrative.summary.trim();
  if (!read && !story) return null;
  return { read, story, confirmed: framing.status === "confirmed" };
}

/** Every file Rupert has: what the founder shared and what Rupert added, newest first. */
export function knowledgeFiles(materials: StepRow): MaterialFile[] {
  if (!materials) return [];
  const payload = asMaterials(materials.status === "submitted" ? materials.published : materials.draft);
  return [...payload.files].sort((a, b) => (b.uploaded_at || "").localeCompare(a.uploaded_at || ""));
}
