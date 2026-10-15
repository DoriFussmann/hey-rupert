import { PageHeader } from "@/components/page-header";
import { MaterialFieldsEditor } from "@/app/admin/forms/materials/material-fields-editor";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { DEFAULT_MATERIAL_FIELDS } from "@/lib/material-fields";
import { loadMaterialFields } from "@/lib/material-fields-server";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function MaterialFieldsPage() {
  let fields = DEFAULT_MATERIAL_FIELDS;
  if (isServiceRoleConfigured()) {
    await requireAdmin();
    fields = await loadMaterialFields(createServiceClient());
  }

  return (
    <>
      <PageHeader
        title="Company Materials"
        description="The questions clients answer in Setup → Company Materials, under the deck upload. Changes apply to every client who has not submitted yet. Answers already given are kept, even for fields you remove."
      />
      <MaterialFieldsEditor initialFields={fields} defaultFields={DEFAULT_MATERIAL_FIELDS} />
    </>
  );
}
