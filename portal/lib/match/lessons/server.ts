import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { FundDb } from "@/lib/match/engine/index.mjs";
import type { TaxIndex } from "@/lib/taxonomy/core";
import { rawForFn } from "@/lib/match/added/core";
import { LESSON_FIELDS, lessonsRevision, withLessons, type FundLesson, type LessonField } from "./core.ts";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Row = { firm_id: string | null; field: string | null; labels: string[] | null; note: string | null; recorded_by: string | null; recorded_at: string | null };

const isField = (value: unknown): value is LessonField => LESSON_FIELDS.includes(value as LessonField);

/** Every lesson. Empty before the migration, so matching never breaks. */
export async function loadLessons(supabase: ServiceClient): Promise<FundLesson[]> {
  const { data, error } = await supabase.from("fund_lessons").select("firm_id, field, labels, note, recorded_by, recorded_at").order("recorded_at").range(0, 9999);
  if (error || !data) return [];
  return (data as Row[])
    .filter((r) => r.firm_id && isField(r.field))
    .map((r) => ({ firmId: r.firm_id!, field: r.field as LessonField, labels: r.labels ?? [], note: r.note ?? "", by: r.recorded_by, at: r.recorded_at ?? "" }));
}

/** The database with every lesson's values added to its fund, and the lessons' fingerprint. */
export function applyLessons(db: FundDb, index: TaxIndex, lessons: FundLesson[]): { db: FundDb; revision: string } {
  const revision = lessonsRevision(lessons);
  if (!revision) return { db, revision };
  const rawFor = rawForFn(index);
  const byLabel = new Map<string, "industry" | "vertical">();
  for (const n of Array.from(index.nodes.values())) {
    if (n.status === "active" && n.dimension === "sector" && n.kind === "sector") {
      byLabel.set(n.label.toLowerCase(), n.attrs.granularity === "broad" ? "industry" : "vertical");
    }
  }
  return { db: { ...db, firms: withLessons(db.firms, lessons, rawFor, (label) => byLabel.get(label.toLowerCase()) ?? null) }, revision };
}

/** Saves the lesson for one field of one fund (replacing the field's earlier one); no labels removes it. */
export async function saveLesson(
  supabase: ServiceClient,
  lesson: { firmId: string; field: LessonField; labels: string[]; note: string; clientId: string; landscapeId: string; investorName: string; by: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const explain = (message: string, code?: string) =>
    code === "42P01" || code === "PGRST205" || /fund_lessons/.test(message) ? "Run supabase/fund_lessons.sql first: the database can't be fixed from here yet." : message;
  if (!lesson.labels.length) {
    const { error } = await supabase.from("fund_lessons").delete().eq("firm_id", lesson.firmId).eq("field", lesson.field);
    return error ? { ok: false, error: explain(error.message, error.code) } : { ok: true };
  }
  const { error } = await supabase.from("fund_lessons").upsert(
    {
      firm_id: lesson.firmId,
      field: lesson.field,
      labels: lesson.labels,
      note: lesson.note.trim().slice(0, 1000),
      found_for_client: lesson.clientId,
      landscape_id: lesson.landscapeId,
      investor_name: lesson.investorName.slice(0, 200),
      recorded_by: lesson.by,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: "firm_id,field" },
  );
  return error ? { ok: false, error: explain(error.message, error.code) } : { ok: true };
}
