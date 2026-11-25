import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { AddClientButton } from "@/app/admin/add-client-panel";
import { ClientTable } from "@/app/admin/client-table";
import { ProspectList } from "@/app/admin/prospect-list";
import { listClients } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { listProspects, type ProspectListItem } from "@/lib/prospects/server";
import { loadNudgeOverview } from "@/lib/nudge-server";
import { createServiceClient } from "@/lib/supabase/admin";

async function loadProspects(): Promise<{ prospects: ProspectListItem[]; error?: string }> {
  if (!isServiceRoleConfigured()) return { prospects: [] };
  const result = await listProspects(createServiceClient());
  return result.ok ? { prospects: result.prospects } : { prospects: [], error: result.error };
}

/** Prospects waiting on the Statement of Work or the Service Order: they get a Nudge button. */
async function loadNudgeable(): Promise<string[]> {
  if (!isServiceRoleConfigured()) return [];
  const result = await loadNudgeOverview(createServiceClient());
  if (!result.ok) return [];
  return result.clients
    .filter((client) => client.clientTurns.some((turn) => turn.key === "sow" || turn.key === "service_order"))
    .map((client) => client.id);
}

export default async function AdminClientsPage() {
  const [clients, prospects, nudgeable] = await Promise.all([listClients(), loadProspects(), loadNudgeable()]);

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
          title="No Clients Yet"
          description="New clients will appear here once they are added."
        />
      ) : (
        <ClientTable clients={clients} nudgeable={nudgeable} />
      )}
    </>
  );
}
