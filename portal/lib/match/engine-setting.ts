import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { MatchEngine } from "@/lib/match/shared";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ENGINE_MIGRATION_MISSING =
  "The match engine switch is not set up in the database yet. Run portal/supabase/match_engine.sql in Supabase.";

export type EngineSetting = {
  engine: MatchEngine;
  note: string;
  updatedBy: string | null;
  updatedAt: string | null;
  /** False when the setting table is missing: the current engine is used. */
  configured: boolean;
};

export type EngineChange = {
  id: number;
  from: MatchEngine | null;
  to: MatchEngine | null;
  note: string;
  actor: string | null;
  at: string;
};

function asEngine(value: unknown): MatchEngine | null {
  return value === "four_tier" ? "four_tier" : value === "current" ? "current" : null;
}

function isMissing(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /match_engine_/.test(message);
}

/**
 * The engine every client's Match page uses. With no setting saved, or before
 * match_engine.sql is run, it is the current engine.
 */
export async function loadEngineSetting(supabase: ServiceClient): Promise<Result<EngineSetting>> {
  const { data, error } = await supabase
    .from("match_engine_setting")
    .select("engine, note, updated_by, updated_at")
    .eq("id", "global")
    .maybeSingle();
  if (error) {
    if (isMissing(error.message, error.code)) {
      return { ok: true, value: { engine: "current", note: "", updatedBy: null, updatedAt: null, configured: false } };
    }
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    value: {
      engine: asEngine(data?.engine) ?? "current",
      note: String(data?.note ?? ""),
      updatedBy: data?.updated_by != null ? String(data.updated_by) : null,
      updatedAt: data?.updated_at != null ? String(data.updated_at) : null,
      configured: true,
    },
  };
}

/** The engine in use; the current engine when the setting can't be read. */
export async function matchEngine(supabase: ServiceClient): Promise<MatchEngine> {
  const loaded = await loadEngineSetting(supabase);
  return loaded.ok ? loaded.value.engine : "current";
}

/** Switches the engine for every client. The change is logged with who made it and why. */
export async function setEngineSetting(
  supabase: ServiceClient,
  engine: MatchEngine,
  note: string,
  actor: string | null,
): Promise<Result<EngineSetting>> {
  const reason = note.trim().slice(0, 1000);
  if (reason.length < 5) return { ok: false, error: "Say why you are switching (5 characters or more)." };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("match_engine_setting")
    .upsert({ id: "global", engine, note: reason, updated_by: actor, updated_at: now }, { onConflict: "id" })
    .select("engine, note, updated_by, updated_at")
    .single();
  if (error || !data) {
    if (error && isMissing(error.message, error.code)) return { ok: false, error: ENGINE_MIGRATION_MISSING };
    return { ok: false, error: error?.message ?? "The switch was not saved." };
  }
  return {
    ok: true,
    value: {
      engine: asEngine(data.engine) ?? "current",
      note: String(data.note ?? ""),
      updatedBy: data.updated_by != null ? String(data.updated_by) : null,
      updatedAt: data.updated_at != null ? String(data.updated_at) : null,
      configured: true,
    },
  };
}

/** Every switch, newest first. */
export async function loadEngineChanges(supabase: ServiceClient, limit = 50): Promise<Result<EngineChange[]>> {
  const { data, error } = await supabase
    .from("match_engine_changes")
    .select("id, before, after, actor, at")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissing(error.message, error.code)) return { ok: true, value: [] };
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    value: (data ?? []).map((row) => {
      const before = (row.before ?? null) as Record<string, unknown> | null;
      const after = (row.after ?? null) as Record<string, unknown> | null;
      return {
        id: Number(row.id),
        from: asEngine(before?.engine),
        to: asEngine(after?.engine),
        note: String(after?.note ?? ""),
        actor: row.actor != null ? String(row.actor) : null,
        at: String(row.at ?? ""),
      };
    }),
  };
}
