import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { AddClientButton } from "@/app/admin/add-client-panel";
import { ClientTable } from "@/app/admin/client-table";
import { ProspectList } from "@/app/admin/prospect-list";
import { listClients } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { listProspects, type ProspectListItem } from "@/lib/prospects/server";
import { createServiceClient } from "@/lib/supabase/admin";

async function loadProspects(): Promise<{ prospects: ProspectListItem[]; error?: string }> {
  if (!isServiceRoleConfigured()) return { prospects: [] };
  const result = await listProspects(createServiceClient());
  return result.ok ? { prospects: result.prospects } : { prospects: [], error: result.error };
}

export default async function AdminClientsPage() {
  const [clients, prospects] = await Promise.all([listClients(), loadProspects()]);

  return (
    <>
      <PageHeader
        title="Clients & Prospects"
        description="Founders who booked a call, and every engagement currently on the books."
        actions={<AddClientButton />}
      />
      <ProspectList prospects={prospects.prospects} error={prospects.error} />
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
