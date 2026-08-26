import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "@/app/admin/clients/[id]/client-form";
import { ClientStageSelect } from "@/app/admin/clients/[id]/stage-select";
import { ScopeOfWorkEditor } from "@/app/admin/clients/[id]/scope-of-work-editor";
import { getAdminClient } from "@/lib/data";
import { formatDate } from "@/lib/format";

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await getAdminClient(params.id);

  if (!client) {
    notFound();
  }

  return (
    <>
      <p className="mb-md">
        <Link
          href="/admin"
          className="text-body-sm text-primary no-underline hover:text-primary-hover"
        >
          Clients
        </Link>
      </p>
      <PageHeader
        title={client.company_name}
        description={`Opened ${formatDate(client.created_at)}. Last activity ${formatDate(client.last_activity_at)}.`}
        actions={
          <ClientStageSelect clientId={client.id} stage={client.stage} />
        }
      />
      <ClientForm client={client} />
      <ScopeOfWorkEditor
        clientId={client.id}
        content={client.scope_of_work_content ?? ""}
      />
    </>
  );
}
