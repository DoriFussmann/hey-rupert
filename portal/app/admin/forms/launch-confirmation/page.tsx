import { PageHeader } from "@/components/page-header";
import { FormTemplateEditor } from "@/components/form-template-editor";
import { LegalVersionHistory } from "@/components/legal-version-history";
import { getFormTemplate, getLegalHistory } from "@/app/admin/actions";
import { LAUNCH_CONFIRMATION_SLUG } from "@/lib/form-fields";

export default async function LaunchConfirmationFormPage() {
  const [template, versions] = await Promise.all([
    getFormTemplate(LAUNCH_CONFIRMATION_SLUG),
    getLegalHistory(LAUNCH_CONFIRMATION_SLUG),
  ]);

  return (
    <>
      <PageHeader
        title="Launch Confirmation"
        description="The confirmation a client signs with the first monthly invoice, before Go Live. Sending and signing it in the portal is not built yet; for now, send it by email."
      />
      <FormTemplateEditor
        slug={LAUNCH_CONFIRMATION_SLUG}
        title={template.title}
        initialContent={template.content}
        defaultContent={template.defaultContent}
        note="Fill in the bracketed fields for each client before sending."
      />
      <LegalVersionHistory history={versions.history} error={versions.error} done="Signed" waiting="Not signed" />
    </>
  );
}
