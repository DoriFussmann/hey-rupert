import { PageHeader } from "@/components/page-header";
import { FormTemplateEditor } from "@/components/form-template-editor";
import { LegalVersionHistory } from "@/components/legal-version-history";
import { getFormTemplate, getLegalHistory } from "@/app/admin/actions";
import { STATEMENT_OF_WORK_SLUG } from "@/lib/form-fields";

export default async function StatementOfWorkFormPage() {
  const [template, versions] = await Promise.all([
    getFormTemplate(STATEMENT_OF_WORK_SLUG),
    getLegalHistory(STATEMENT_OF_WORK_SLUG),
  ]);

  return (
    <>
      <PageHeader
        title="Statement of Work"
        description="The Statement of Work sent to clients. Edit the text, then generate and send it from a client page."
      />
      <FormTemplateEditor
        slug={STATEMENT_OF_WORK_SLUG}
        title={template.title}
        initialContent={template.content}
        defaultContent={template.defaultContent}
      />
      <LegalVersionHistory history={versions.history} error={versions.error} done="Confirmed" waiting="Not confirmed" />
    </>
  );
}
