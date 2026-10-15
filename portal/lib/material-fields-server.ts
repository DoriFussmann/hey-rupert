import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  DEFAULT_MATERIAL_FIELDS,
  MATERIAL_FIELDS_SLUG,
  parseMaterialFields,
  type MaterialField,
} from "@/lib/material-fields";

type ServiceClient = ReturnType<typeof createServiceClient>;

/** The Company Materials fields set in Forms → Company Materials. */
export async function loadMaterialFields(
  supabase: ServiceClient,
): Promise<MaterialField[]> {
  const { data } = await supabase
    .from("form_templates")
    .select("content")
    .eq("slug", MATERIAL_FIELDS_SLUG)
    .maybeSingle();
  if (!data?.content) return DEFAULT_MATERIAL_FIELDS;
  try {
    return parseMaterialFields(JSON.parse(String(data.content))) ?? DEFAULT_MATERIAL_FIELDS;
  } catch {
    return DEFAULT_MATERIAL_FIELDS;
  }
}
