// "What Rupert Knows": the founder's view of everything Rupert works from,
// in one place. Pure module: which facts, summaries and files are shown,
// and only what was already shared with the founder (never a draft).

import type { IntakeBrief, IntakeSummaryItem, IntakeTopic, TopicStatus } from "./intake.ts";
import { asFeedbackPublished, asMaterials, asNarrative, type MaterialFile } from "./setup.ts";

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

export type IntakeKnowledge = { confirmed: boolean; items: IntakeSummaryItem[] };

/**
 * What the founder told Rupert in the intake: the summary they confirmed,
 * or, when they never confirmed one, what Rupert noted per topic in the
 * conversation. Topics left empty are left out. Null when there is nothing.
 */
export function intakeKnowledge(
  interview: { status: string; summary: IntakeSummaryItem[] | null; topic_status: Record<string, TopicStatus> } | null,
  topics: IntakeTopic[],
): IntakeKnowledge | null {
  if (!interview) return null;
  const answered = (item: IntakeSummaryItem) => text(item.answer) && !NOT_PROVIDED.test(text(item.answer));
  if (interview.status === "completed" && interview.summary) {
    const items = interview.summary.filter(answered);
    if (items.length > 0) return { confirmed: true, items };
  }
  const items = topics
    .map((topic) => ({ topic_id: topic.id, title: topic.title, answer: text(interview.topic_status[topic.id]?.note) }))
    .filter(answered);
  return items.length > 0 ? { confirmed: false, items } : null;
}

type StepRow = { step: string; status: string; version: number; published: unknown; draft: unknown } | null | undefined;

/**
 * Rupert's read of the company, as sent to the founder, and the Outreach
 * Narrative. Null until a narrative was sent. Narratives sent before the
 * short version existed show their core story; feedback the founder got as
 * its own step earlier stands in when the narrative carries none.
 */
export function sharedRead(framing: StepRow, legacyFeedback?: StepRow) {
  if (!framing || framing.version <= 0) return null;
  const narrative = asNarrative(framing.published);
  const legacy = legacyFeedback && legacyFeedback.version > 0 ? asFeedbackPublished(legacyFeedback.published) : null;
  const read = narrative.feedback?.summary.trim() || legacy?.summary.trim() || legacy?.framing.trim() || "";
  const story = narrative.summary.trim() || narrative.core.trim();
  if (!read && !story) return null;
  return { read, story, confirmed: framing.status === "confirmed" };
}

/** Every file Rupert has: what the founder shared and what Rupert added, newest first. */
export function knowledgeFiles(materials: StepRow): MaterialFile[] {
  if (!materials) return [];
  const payload = asMaterials(materials.status === "submitted" ? materials.published : materials.draft);
  return [...payload.files].sort((a, b) => (b.uploaded_at || "").localeCompare(a.uploaded_at || ""));
}
