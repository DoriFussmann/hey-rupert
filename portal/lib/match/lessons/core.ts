// Lessons for Rupert: fixes to a Fund Database record, made by the admin in
// Step 2C / 3C when the fund's own website contradicts the record ("it does
// invest in the US"). Each lesson adds values to one field of one fund when
// the database is loaded for matching, for every client. The provider file
// is never edited: re-uploads keep the lesson, and removing it removes what
// it added. Pure module.

import { createHash } from "node:crypto";

export const LESSON_FIELDS = ["financing", "stage", "geography", "sector"] as const;
export type LessonField = (typeof LESSON_FIELDS)[number];

export type FundLesson = {
  firmId: string;
  field: LessonField;
  /** Taxonomy labels added to the fund for the field. */
  labels: string[];
  note: string;
  by: string | null;
  at: string;
};

/** The firm fields a lesson adds to (raw values, as the provider writes them). */
type LessonFirm = { id: string; stages: string[]; fin: string[]; geo: string[]; ind: string[]; vert: string[] };

/**
 * The firms with every lesson's values added (never removing one). `rawFor`
 * turns a taxonomy label into a raw value the taxonomy maps to it;
 * `sectorField` says whether a sector label is an industry (broad) or a
 * vertical (null: not a sector the taxonomy knows, skipped).
 */
export function withLessons<F extends LessonFirm>(
  firms: F[],
  lessons: FundLesson[],
  rawFor: (field: string, label: string) => string,
  sectorField: (label: string) => "industry" | "vertical" | null,
): F[] {
  if (!lessons.length) return firms;
  const byFirm = new Map<string, FundLesson[]>();
  for (const l of lessons) byFirm.set(l.firmId, [...(byFirm.get(l.firmId) ?? []), l]);
  return firms.map((f) => {
    const mine = byFirm.get(f.id);
    if (!mine) return f;
    const next = { stages: [...f.stages], fin: [...f.fin], geo: [...f.geo], ind: [...f.ind], vert: [...f.vert] };
    const add = (list: string[], raw: string) => {
      if (raw && !list.some((x) => x.toLowerCase() === raw.toLowerCase())) list.push(raw);
    };
    for (const lesson of mine) {
      for (const label of lesson.labels) {
        if (lesson.field === "geography") add(next.geo, rawFor("geography", label));
        else if (lesson.field === "stage") add(next.stages, rawFor("stage", label));
        else if (lesson.field === "financing") add(next.fin, rawFor("financing", label));
        else {
          const field = sectorField(label);
          if (field) add(field === "industry" ? next.ind : next.vert, rawFor(field, label));
        }
      }
    }
    return { ...f, ...next };
  });
}

/** A fingerprint of the lessons, so a new one shows as "the data changed since". "" when none. */
export function lessonsRevision(lessons: FundLesson[]): string {
  const lines = lessons.filter((l) => l.labels.length).map((l) => `${l.firmId}|${l.field}|${[...l.labels].sort().join(",")}`).sort();
  if (!lines.length) return "";
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 12);
}

/** The labels kept from what was asked: only allowed ones, once each, in the allowed order. */
export function cleanLabels(asked: unknown, allowed: string[]): string[] {
  if (!Array.isArray(asked)) return [];
  const want = new Set(asked.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()));
  return allowed.filter((label, i) => want.has(label.toLowerCase()) && allowed.findIndex((o) => o.toLowerCase() === label.toLowerCase()) === i);
}
