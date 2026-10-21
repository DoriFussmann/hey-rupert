import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { AddClientButton } from "@/app/admin/add-client-panel";
import { ClientTable } from "@/app/admin/client-table";
import { listClients } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { readinessFor } from "@/lib/match/tiers/server";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function AdminClientsPage() {
  const clients = await listClients();
  // Whether each active client's profile can be matched (Ready / Limited / Blocked).
  const readiness = isServiceRoleConfigured()
    ? Object.fromEntries(await readinessFor(createServiceClient(), clients.filter((client) => !client.archived_at).map((client) => client.id)))
    : {};

  return (
    <>
      <PageHeader
        title="Clients"
        description="Pipeline of every engagement currently on the books."
        actions={<AddClientButton />}
      />
      {clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          description="New clients will appear here once they are added."
        />
      ) : (
        <ClientTable clients={clients} readiness={readiness} />
      )}
    </>
  );
}
