import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { AddClientButton } from "@/app/admin/add-client-panel";
import { ClientTable } from "@/app/admin/client-table";
import { listClients } from "@/lib/data";

export default async function AdminClientsPage() {
  const clients = await listClients();

  return (
    <>
      <PageHeader
        title="Clients"
        description="Every engagement currently on the books."
        actions={<AddClientButton />}
      />
      {clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          description="New clients will appear here once they are added."
        />
      ) : (
        <ClientTable clients={clients} />
      )}
    </>
  );
}
