import { DeskCard, ItemList, ItemRow } from "@/components/desk/desk-parts";
import { PageHeader } from "@/components/page-header";
import { adminDeskPath } from "@/lib/desk";
import { listWaitingOnUs } from "@/lib/desk-server";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

export const metadata = { title: "Desk" };

/** The cross-client inbox: every open Desk item waiting on us, oldest first. */
export default async function AdminDeskInboxPage() {
  const inbox = isServiceRoleConfigured()
    ? await listWaitingOnUs(createServiceClient())
    : { ok: false as const, error: "Service role key is not configured." };
  const now = new Date();

  return (
    <>
      <PageHeader title="Desk" description="Every open item waiting on us, across clients, oldest first." />
      {inbox.ok ? (
        <DeskCard title="Waiting on us" meta={`${inbox.value.length} ${inbox.value.length === 1 ? "item" : "items"}`}>
          <ItemList empty="Nothing is waiting on us.">
            {inbox.value.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                href={adminDeskPath(item.clientId, item.id)}
                side="admin"
                now={now}
                lead={item.company || item.person || "Client"}
              />
            ))}
          </ItemList>
        </DeskCard>
      ) : (
        <p className="text-body-sm text-error">{inbox.error}</p>
      )}
    </>
  );
}
