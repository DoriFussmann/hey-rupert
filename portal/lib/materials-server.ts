import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  MATERIAL_MAX_FILES,
  NO_DECK_MAX,
  asMaterials,
  type MaterialFile,
  type MaterialsPayload,
  type MaterialsView,
} from "@/lib/setup";
import { loadSetupStep, nowIso, setupTableError } from "@/lib/setup-server";

// Company materials shared by the intake (files shared in the chat), the
// Company Files page and the test pilot (the test deck): files land on the
// client's materials, so the client never uploads them twice.

type ServiceClient = ReturnType<typeof createServiceClient>;

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

/** Loads the materials row, creating an empty draft the first time. */
export async function loadOrCreateMaterials(supabase: ServiceClient, clientId: string) {
  const loaded = await loadSetupStep(supabase, clientId, "materials");
  if (!loaded.ok) return loaded;
  if (loaded.row) return { ok: true as const, row: loaded.row };
  const { error } = await supabase.from("setup_steps").insert({
    client_id: clientId,
    step: "materials",
    status: "draft",
    draft: { files: [], fields: {} },
  });
  if (error && error.code !== "23505") {
    return { ok: false as const, error: setupTableError(error.message, error.code) };
  }
  const again = await loadSetupStep(supabase, clientId, "materials");
  if (!again.ok) return again;
  if (!again.row) return { ok: false as const, error: "Unable to start the materials." };
  return { ok: true as const, row: again.row };
}

export function safeFileName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, "-")
      .slice(-120) || "file"
  );
}

export function materialsView(
  row: { status: string; draft: unknown; published: unknown } | null | undefined,
): MaterialsView {
  const submitted = row?.status === "submitted";
  const payload = asMaterials(submitted ? row?.published : row?.draft);
  return { files: payload.files, noDeck: payload.no_deck, submitted };
}

export async function loadMaterialsView(
  supabase: ServiceClient,
  clientId: string,
): Promise<{ ok: true; view: MaterialsView } | { ok: false; error: string }> {
  const loaded = await loadSetupStep(supabase, clientId, "materials");
  if (!loaded.ok) return loaded;
  return { ok: true, view: materialsView(loaded.row) };
}

/**
 * Adds an uploaded file to the client's materials. Before they are
 * submitted it goes on the draft; after, it is added to what Rupert has
 * (`late: true`), without changing whose turn it is.
 */
export async function attachMaterialFile(
  supabase: ServiceClient,
  clientId: string,
  file: { path: string; name: string; size: number; type: string },
  /** Set when Rupert adds the file for the client. */
  addedBy?: "admin",
): Promise<{ ok: true; file: MaterialFile; late: boolean } | { ok: false; error: string }> {
  const path = text(file?.path);
  if (!path.startsWith(`${clientId}/`) || path.includes("..")) {
    return { ok: false, error: "That upload does not belong to this client." };
  }
  const loaded = await loadOrCreateMaterials(supabase, clientId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  const late = row.status === "submitted";
  const draft = asMaterials(row.draft);
  const shown = late ? asMaterials(row.published) : draft;
  const existing = shown.files.find((item) => item.path === path);
  if (existing) return { ok: true, file: existing, late };
  if (shown.files.length >= MATERIAL_MAX_FILES) {
    return { ok: false, error: `Up to ${MATERIAL_MAX_FILES} files can be attached.` };
  }
  const entry: MaterialFile = {
    path,
    name: text(file?.name).slice(0, 255) || "file",
    size: Number(file?.size) || 0,
    type: text(file?.type).slice(0, 120),
    uploaded_at: nowIso(),
    ...(addedBy ? { added_by: addedBy } : {}),
  };
  const withFile = (payload: MaterialsPayload): MaterialsPayload => ({
    ...payload,
    files: payload.files.some((item) => item.path === path)
      ? payload.files
      : [...payload.files, entry],
  });
  const { data, error } = await supabase
    .from("setup_steps")
    .update({
      draft: withFile(draft),
      ...(late ? { published: withFile(shown) } : {}),
      updated_at: nowIso(),
    })
    .eq("client_id", clientId)
    .eq("step", "materials")
    .eq("updated_at", row.updated_at)
    .select("client_id");
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  if (!data || data.length === 0) {
    return { ok: false, error: "The materials changed meanwhile. Try again." };
  }
  return { ok: true, file: entry, late };
}

/** Records the founder's reason for having no deck yet, on the draft. */
export async function saveNoDeckNote(
  supabase: ServiceClient,
  clientId: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = text(note).slice(0, NO_DECK_MAX);
  if (!value) return { ok: false, error: "Add a short reason first." };
  const loaded = await loadOrCreateMaterials(supabase, clientId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status === "submitted") {
    return { ok: false, error: "Your materials are already with Rupert." };
  }
  const { data, error } = await supabase
    .from("setup_steps")
    .update({ draft: { ...asMaterials(row.draft), no_deck: value }, updated_at: nowIso() })
    .eq("client_id", clientId)
    .eq("step", "materials")
    .eq("status", "draft")
    .eq("updated_at", row.updated_at)
    .select("client_id");
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Your materials changed in another window. Refresh and try again." };
  }
  return { ok: true };
}

export const INTAKE_MATERIALS_MIGRATION_MISSING =
  "The intake can't be completed until the latest database update (supabase/intake_materials.sql) is run.";

/**
 * Completes the intake and submits the materials in one database
 * transaction, and moves the client to Setup. `completed` is false when the
 * intake was already complete.
 */
export async function completeIntakeWithMaterials(
  supabase: ServiceClient,
  clientId: string,
  at: string,
): Promise<{ ok: true; completed: boolean } | { ok: false; error: string }> {
  // The materials row must exist so it is submitted with the intake.
  const materials = await loadOrCreateMaterials(supabase, clientId);
  if (!materials.ok) return materials;
  const { data, error } = await supabase.rpc("complete_intake_with_materials", {
    p_client_id: clientId,
    p_at: at,
  });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883";
    return { ok: false, error: missing ? INTAKE_MATERIALS_MIGRATION_MISSING : error.message };
  }
  return { ok: true, completed: data === true };
}
