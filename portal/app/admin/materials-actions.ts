"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { intakeFileProblem } from "@/lib/intake";
import { attachMaterialFile, loadMaterialsView, safeFileName } from "@/lib/materials-server";
import { MATERIALS_BUCKET, MATERIAL_MAX_FILES, type MaterialFile } from "@/lib/setup";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

async function requireAdmin(clientId: string) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (!UUID.test(String(clientId ?? ""))) return { ok: false as const, error: "Unknown client." };
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client not found." };
  return { ok: true as const, supabase };
}

/**
 * Step 1 of Rupert adding a file to a client's company materials (for
 * example one the founder emailed): checks it and returns a one-time signed
 * URL the browser uploads to directly, in the client's own materials folder.
 */
export async function createAdminMaterialUpload(
  clientId: string,
  file: { name: string; size: number },
): Promise<Result<{ path: string; token: string }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const name = String(file?.name ?? "").trim();
  const problem = intakeFileProblem({ name, size: Number(file?.size) || 0 });
  if (problem) return { ok: false, error: problem };
  const view = await loadMaterialsView(access.supabase, clientId);
  if (!view.ok) return view;
  if (view.view.files.length >= MATERIAL_MAX_FILES) {
    return { ok: false, error: `Up to ${MATERIAL_MAX_FILES} files can be attached.` };
  }
  const path = `${clientId}/${randomUUID()}/${safeFileName(name)}`;
  const { data, error } = await access.supabase.storage.from(MATERIALS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: `Upload could not start: ${error?.message ?? "unknown error"}.` };
  return { ok: true, path: data.path, token: data.token };
}

/**
 * Step 2: the uploaded file joins the client's company materials, marked as
 * added by Rupert. The analysis reads it like the client's own files, and
 * the client sees it under Company Files. No alert is sent.
 */
export async function registerAdminMaterialFile(
  clientId: string,
  file: { path: string; name: string; size: number; type: string },
): Promise<Result<{ file: MaterialFile }>> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const attached = await attachMaterialFile(
    access.supabase,
    clientId,
    {
      path: String(file?.path ?? ""),
      name: String(file?.name ?? "file"),
      size: Number(file?.size) || 0,
      type: String(file?.type ?? ""),
    },
    "admin",
  );
  if (!attached.ok) return attached;
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/portal", "layout");
  return { ok: true, file: attached.file };
}
