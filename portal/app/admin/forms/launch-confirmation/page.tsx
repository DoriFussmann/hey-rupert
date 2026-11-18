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
        description="The agreement a client confirms as the last step of Go Live, after connecting the inbox and paying the first monthly invoice. No signature: they tick a box, and the text they confirmed is kept with its version."
      />
      <FormTemplateEditor
        slug={LAUNCH_CONFIRMATION_SLUG}
        title={template.title}
        initialContent={template.content}
        defaultContent={template.defaultContent}
        note="The bracketed fields are filled in for each client: funds, contacts, inbox, postal address, monthly fee and plan length. The Current terms paragraph is shown only to a client who signed an earlier Service Order version."
      />
      <LegalVersionHistory history={versions.history} error={versions.error} done="Confirmed" waiting="Not confirmed" />
    </>
  );
}
