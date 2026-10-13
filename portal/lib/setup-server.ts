import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  MATERIALS_BUCKET,
  asMaterials,
  asResponse,
  isSetupStepId,
  type SetupHistoryEntry,
  type SetupRowStatus,
  type SetupStepId,
  type SetupStepState,
} from "@/lib/setup";

type ServiceClient = ReturnType<typeof createServiceClient>;

const ROW_STATUSES: SetupRowStatus[] = [
  "draft",
  "submitted",
  "published",
  "with_client",
  "changes_requested",
  "confirmed",
];

function asHistory(value: unknown): SetupHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .map((item) => ({
      version: Number(item.version) || 0,
      published_at: String(item.published_at ?? ""),
      response: asResponse(item.response),
    }));
}

export function asSetupStepState(row: Record<string, unknown>): SetupStepState | null {
  if (!isSetupStepId(row.step)) return null;
  const status = ROW_STATUSES.includes(row.status as SetupRowStatus)
    ? (row.status as SetupRowStatus)
    : "draft";
  return {
    client_id: String(row.client_id),
    step: row.step,
    status,
    draft: row.draft ?? {},
    published: row.published ?? null,
    version: Number(row.version) || 0,
    published_at: row.published_at != null ? String(row.published_at) : null,
    response: asResponse(row.response),
    history: asHistory(row.history),
    turn_since: row.turn_since != null ? String(row.turn_since) : null,
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

/** Setup rows for the given clients, grouped by client id. Empty on error. */
export async function loadSetupSteps(
  supabase: ServiceClient,
  clientIds: string[],
): Promise<Map<string, SetupStepState[]>> {
  const grouped = new Map<string, SetupStepState[]>();
  if (clientIds.length === 0) return grouped;

  const { data, error } = await supabase
    .from("setup_steps")
    .select("*")
    .in("client_id", clientIds);

  if (error || !data) return grouped;

  for (const raw of data) {
    const row = asSetupStepState(raw as Record<string, unknown>);
    if (!row) continue;
    const list = grouped.get(row.client_id) ?? [];
    list.push(row);
    grouped.set(row.client_id, list);
  }
  return grouped;
}

export async function loadSetupStep(
  supabase: ServiceClient,
  clientId: string,
  step: SetupStepId,
): Promise<{ ok: true; row: SetupStepState | null } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("setup_steps")
    .select("*")
    .eq("client_id", clientId)
    .eq("step", step)
    .maybeSingle();

  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  return {
    ok: true,
    row: data ? asSetupStepState(data as Record<string, unknown>) : null,
  };
}

export function setupTableError(message: string, code?: string) {
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("setup_steps") ||
    message.toLowerCase().includes("schema cache")
  ) {
    return "Setup is not set up in the database yet. Run portal/supabase/setup_phase.sql in Supabase.";
  }
  return message;
}

/** Signed download links for a client's uploaded materials (1 hour). */
export async function signMaterialLinks(
  supabase: ServiceClient,
  payload: unknown,
): Promise<Record<string, string>> {
  const { files } = asMaterials(payload);
  const links: Record<string, string> = {};
  await Promise.all(
    files.map(async (file) => {
      const { data } = await supabase.storage
        .from(MATERIALS_BUCKET)
        .createSignedUrl(file.path, 60 * 60, { download: file.name });
      if (data?.signedUrl) links[file.path] = data.signedUrl;
    }),
  );
  return links;
}

export function nowIso() {
  return new Date().toISOString();
}
