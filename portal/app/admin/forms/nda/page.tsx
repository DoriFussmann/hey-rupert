import { PageHeader } from "@/components/page-header";
import { FormTemplateEditor } from "@/components/form-template-editor";
import { getFormTemplate } from "@/app/admin/actions";
import { NDA_SLUG } from "@/lib/form-fields";
import { CLIENT_TOKENS } from "@/lib/service-order";

export default async function NdaFormPage() {
  const template = await getFormTemplate(NDA_SLUG);

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
    </>
  );
}
