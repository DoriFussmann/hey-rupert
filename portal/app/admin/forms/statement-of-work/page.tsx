import { PageHeader } from "@/components/page-header";
import { StatementOfWorkTemplateEditor } from "@/app/admin/forms/statement-of-work/template-editor";
import { getFormTemplate } from "@/app/admin/actions";

export default async function StatementOfWorkFormPage() {
  const template = await getFormTemplate();

  return (
    <>
      <PageHeader
        title="Statement of Work"
        description="The Statement of Work sent to clients. Edit the text, then generate and send it from a client page."
      />
      <StatementOfWorkTemplateEditor initialContent={template.content} />
    </>
  );
}
