import { PageHeader } from "@/components/page-header";
import { FormTemplateEditor } from "@/components/form-template-editor";
import { LegalVersionHistory } from "@/components/legal-version-history";
import { getFormTemplate, getLegalHistory } from "@/app/admin/actions";
import { NDA_SLUG } from "@/lib/form-fields";
import { CLIENT_TOKENS } from "@/lib/service-order";

export default async function NdaFormPage() {
  const [template, versions] = await Promise.all([
    getFormTemplate(NDA_SLUG),
    getLegalHistory(NDA_SLUG),
  ]);

  return (
    <>
      <PageHeader
        title="NDA"
        description="The NDA sent to clients for signature after kick-off. Edit the text, then generate and send it from a client page."
      />
      <FormTemplateEditor
        slug={NDA_SLUG}
        title={template.title}
        initialContent={template.content}
        defaultContent={template.defaultContent}
        note={`${CLIENT_TOKENS.company_name} and ${CLIENT_TOKENS.signer_email} are filled in by the client when they sign. Signature blocks are added automatically.`}
      />
      <LegalVersionHistory history={versions.history} error={versions.error} done="Signed" waiting="Not signed" />
    </>
  );
}
