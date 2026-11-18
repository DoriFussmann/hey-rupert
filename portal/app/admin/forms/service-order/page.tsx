import { PageHeader } from "@/components/page-header";
import { FormTemplateEditor } from "@/components/form-template-editor";
import { LegalVersionHistory } from "@/components/legal-version-history";
import { getFormTemplate, getLegalHistory } from "@/app/admin/actions";
import { SERVICE_ORDER_SLUG } from "@/lib/form-fields";
import { CLIENT_TOKENS } from "@/lib/service-order";

export default async function ServiceOrderFormPage() {
  const [template, versions] = await Promise.all([
    getFormTemplate(SERVICE_ORDER_SLUG),
    getLegalHistory(SERVICE_ORDER_SLUG),
  ]);

  return (
    <>
      <PageHeader
        title="Service Order"
        description="The Service Order sent to clients for signature. Edit the text, then generate and send it from a client page with the Setup Fee payment link."
      />
      <FormTemplateEditor
        slug={SERVICE_ORDER_SLUG}
        title={template.title}
        initialContent={template.content}
        defaultContent={template.defaultContent}
        note={`${CLIENT_TOKENS.company_name} and ${CLIENT_TOKENS.signer_email} are filled in by the client when they sign. Signature blocks are added automatically.`}
      />
      <LegalVersionHistory history={versions.history} error={versions.error} done="Signed" waiting="Not signed" />
    </>
  );
}
