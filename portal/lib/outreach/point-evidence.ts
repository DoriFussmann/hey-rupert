// What stands behind each point of the approved narrative, for Rupert while
// he writes the emails: how the Company Brief scored the point, and the
// brief's sections that hold its facts and sources. Pure module.

import { sectionTitle, type BriefTopic, type CompanyBrief } from "../brief.ts";

export type PointEvidence = {
  /** Why it is a strength. */
  why: string;
  /** The claim, as said to investors. */
  say: string;
  /** What not to overstate. Internal. */
  watchOut: string;
  /** The brief's sections behind the point, with their sources as the brief wrote them. */
  sections: { title: string; text: string }[];
};

/** The brief sections that hold each selling point's facts. A point not listed (one added under Agents → Selling points) has none. */
export const POINT_SECTIONS: Record<string, string[]> = {
  founder_fit: ["team"],
  traction: ["traction"],
  customers: ["traction"],
  why_now: ["why_now"],
  category_momentum: ["market", "competition"],
  product_edge: ["product", "solution"],
  capital_efficiency: ["financials"],
  backers: ["round"],
  business_model: ["business_model"],
  distribution: ["go_to_market"],
};

const norm = (value: string) => value.trim().toLowerCase();

/**
 * The evidence for each narrative point, in the narrative's order. A point is
 * matched to the brief's chosen selling point by title, else by position (the
 * narrative keeps the brief's order; a title may have been reworded). Null
 * where there is no brief or no match.
 */
export function pointEvidence(
  titles: string[],
  brief: Pick<CompanyBrief, "points" | "sections"> | null,
  topics: BriefTopic[],
): (PointEvidence | null)[] {
  if (!brief) return titles.map(() => null);
  const chosen = brief.points.chosen
    .map((id) => brief.points.scores.find((score) => score.point === id))
    .filter((score): score is NonNullable<typeof score> => Boolean(score));
  const byPosition = chosen.length === titles.length;
  return titles.map((title, index) => {
    const score = chosen.find((item) => norm(item.title) === norm(title)) ?? (byPosition ? chosen[index] : undefined);
    if (!score) return null;
    const sections = (POINT_SECTIONS[score.point] ?? [])
      .map((key) => ({ title: sectionTitle(key, topics), text: (brief.sections[key] ?? "").trim() }))
      .filter((section) => section.text);
    const evidence = { why: score.reason.trim(), say: score.pitch.trim(), watchOut: score.watch_out.trim(), sections };
    return evidence.why || evidence.say || evidence.watchOut || sections.length ? evidence : null;
  });
}
