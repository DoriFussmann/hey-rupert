import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  PROMPTS,
  PROMPT_NOTE_MAX,
  promptDefinition,
  promptTextProblems,
  resolvePrompts,
  type ActivePrompt,
  type PromptKey,
  type PromptOverride,
  type PromptRow,
} from "@/lib/prompts";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const PROMPTS_MIGRATION_MISSING =
  "Prompt versions are not set up in the database yet. Run portal/supabase/prompt_versions.sql in Supabase.";

function promptsError(message: string, code?: string) {
  if (
    code === "42P01" ||
    code === "42703" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /active_version|form_template_versions|prompt_uses|prompt_save_version/.test(message)
  ) {
    return PROMPTS_MIGRATION_MISSING;
  }
  return message;
}

/** Why an AI call runs: recorded with the prompt version it used. */
export type PromptUse = {
  /** The client the output is for, when there is one. */
  clientId?: string | null;
  /** A few words: what the output is. */
  purpose: string;
  actor?: string | null;
  /** Unsaved text the admin is testing for one of the prompts. Marks the use as a test. */
  override?: PromptOverride | null;
};

/**
 * The active version of each prompt an AI call needs, read from the database
 * on every call, so an edit applies to the next run with no deploy. Fails,
 * naming the prompt, when one is missing or invalid; never substitutes a
 * built-in text. Each use is recorded with its version.
 */
export async function loadPrompts<K extends PromptKey>(
  supabase: ServiceClient,
  keys: K[],
  use: PromptUse,
): Promise<Result<Record<K, ActivePrompt>>> {
  const slugs = keys.map((key) => promptDefinition(key).slug);
  const { data, error } = await supabase.from("form_templates").select("slug, content, active_version").in("slug", slugs);
  if (error) return { ok: false, error: promptsError(error.message, error.code) };
  const resolved = resolvePrompts((data ?? []) as PromptRow[], keys, use.override);
  if (!resolved.ok) return resolved;

  const clientId = use.clientId && /^[0-9a-f-]{36}$/i.test(use.clientId) ? use.clientId : null;
  const { error: logError } = await supabase.from("prompt_uses").insert(
    keys.map((key) => ({
      prompt_key: key,
      slug: promptDefinition(key).slug,
      version: resolved.value[key].version,
      client_id: clientId,
      purpose: use.purpose.slice(0, 200),
      test: Boolean(use.override),
      actor: use.actor ?? null,
    })),
  );
  // The record of use never blocks the work itself; a failure is logged for the developer.
  if (logError) console.error(`Prompt use not recorded: ${logError.message}`);
  return resolved;
}

/** One loaded prompt. */
export async function loadPrompt(supabase: ServiceClient, key: PromptKey, use: PromptUse): Promise<Result<ActivePrompt>> {
  const loaded = await loadPrompts(supabase, [key], use);
  return loaded.ok ? { ok: true, value: loaded.value[key] } : loaded;
}

/** Saves text as the prompt's next version and makes it active. Earlier versions never change. */
export async function savePromptVersion(
  supabase: ServiceClient,
  key: PromptKey,
  text: string,
  note: string,
  actor: string | null,
): Promise<Result<{ version: number }>> {
  const problems = promptTextProblems(text);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };
  const definition = promptDefinition(key);
  const { data, error } = await supabase.rpc("prompt_save_version", {
    p_slug: definition.slug,
    p_title: `AI prompt: ${definition.title}`,
    p_content: text.trim(),
    p_note: note.trim().slice(0, PROMPT_NOTE_MAX),
    p_actor: actor,
  });
  if (error || !data) return { ok: false, error: promptsError(error?.message ?? "The prompt was not saved.", error?.code) };
  return { ok: true, value: { version: Number((data as { version: number }).version) } };
}

export type PromptVersion = { version: number; content: string; note: string; createdBy: string | null; createdAt: string };

/** Every saved version of a prompt, newest first. */
export async function listPromptVersions(supabase: ServiceClient, key: PromptKey): Promise<Result<PromptVersion[]>> {
  const { data, error } = await supabase
    .from("form_template_versions")
    .select("version, content, note, created_by, created_at")
    .eq("slug", promptDefinition(key).slug)
    .order("version", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: promptsError(error.message, error.code) };
  return {
    ok: true,
    value: (data ?? []).map((row) => ({
      version: Number(row.version),
      content: String(row.content ?? ""),
      note: String(row.note ?? ""),
      createdBy: row.created_by != null ? String(row.created_by) : null,
      createdAt: String(row.created_at ?? ""),
    })),
  };
}

export type PromptUseRow = { version: number; clientName: string | null; purpose: string; test: boolean; actor: string | null; at: string };

/** The latest uses of a prompt, newest first, with the client's name. */
export async function listPromptUses(supabase: ServiceClient, key: PromptKey, limit = 25): Promise<Result<PromptUseRow[]>> {
  const { data, error } = await supabase
    .from("prompt_uses")
    .select("version, client_id, purpose, test, actor, created_at")
    .eq("slug", promptDefinition(key).slug)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: promptsError(error.message, error.code) };
  const rows = data ?? [];
  const ids = Array.from(new Set(rows.map((row) => row.client_id).filter((id): id is string => typeof id === "string")));
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: clients } = await supabase.from("clients").select("id, company_name").in("id", ids);
    for (const client of clients ?? []) names.set(String(client.id), String(client.company_name ?? ""));
  }
  return {
    ok: true,
    value: rows.map((row) => ({
      version: Number(row.version),
      clientName: row.client_id ? names.get(String(row.client_id)) || null : null,
      purpose: String(row.purpose ?? ""),
      test: row.test === true,
      actor: row.actor != null ? String(row.actor) : null,
      at: String(row.created_at ?? ""),
    })),
  };
}

export type PromptStatus = { key: PromptKey; activeVersion: number | null; updatedAt: string | null; valid: boolean };

/** Each prompt's active version, for the list page. */
export async function loadPromptStatuses(supabase: ServiceClient): Promise<Result<PromptStatus[]>> {
  const { data, error } = await supabase
    .from("form_templates")
    .select("slug, content, active_version, updated_at")
    .in(
      "slug",
      PROMPTS.map((prompt) => prompt.slug),
    );
  if (error) return { ok: false, error: promptsError(error.message, error.code) };
  const bySlug = new Map((data ?? []).map((row) => [String(row.slug), row]));
  return {
    ok: true,
    value: PROMPTS.map((prompt) => {
      const row = bySlug.get(prompt.slug);
      const activeVersion = row?.active_version != null ? Number(row.active_version) : null;
      return {
        key: prompt.key,
        activeVersion,
        updatedAt: row?.updated_at != null ? String(row.updated_at) : null,
        valid: activeVersion !== null && activeVersion > 0 && promptTextProblems(String(row?.content ?? "")).length === 0,
      };
    }),
  };
}
