import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { MATERIAL_MAX_FILES, asMaterials, type MaterialFile } from "@/lib/setup";
import { loadSetupStep, nowIso, setupTableError } from "@/lib/setup-server";

// Company materials shared by the intake (files shared in the chat) and the
// test pilot (the test deck): files land on the client's materials draft, so
// the client never uploads them twice.

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

/** Attaches an uploaded file to the client's materials draft. */
export async function attachMaterialFile(
  supabase: ServiceClient,
  clientId: string,
  file: { path: string; name: string; size: number; type: string },
): Promise<{ ok: true; file: MaterialFile } | { ok: false; error: string }> {
  const path = text(file?.path);
  if (!path.startsWith(`${clientId}/`) || path.includes("..")) {
    return { ok: false, error: "That upload does not belong to this client." };
  }
  const loaded = await loadOrCreateMaterials(supabase, clientId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status === "submitted") {
    return { ok: false, error: "The materials are already submitted." };
  }
  const draft = asMaterials(row.draft);
  const existing = draft.files.find((item) => item.path === path);
  if (existing) return { ok: true, file: existing };
  if (draft.files.length >= MATERIAL_MAX_FILES) {
    return { ok: false, error: `Up to ${MATERIAL_MAX_FILES} files can be attached.` };
  }
  const entry: MaterialFile = {
    path,
    name: text(file?.name).slice(0, 255) || "file",
    size: Number(file?.size) || 0,
    type: text(file?.type).slice(0, 120),
    uploaded_at: nowIso(),
  };
  const { data, error } = await supabase
    .from("setup_steps")
    .update({ draft: { ...draft, files: [...draft.files, entry] }, updated_at: nowIso() })
    .eq("client_id", clientId)
    .eq("step", "materials")
    .eq("updated_at", row.updated_at)
    .select("client_id");
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  if (!data || data.length === 0) {
    return { ok: false, error: "The materials changed meanwhile. Try again." };
  }
  return { ok: true, file: entry };
}
