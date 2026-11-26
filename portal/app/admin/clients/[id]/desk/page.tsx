import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { DeskFilters } from "@/components/desk/desk-filters";
import { AssetShelf, DeskCard, ItemList, ItemRow } from "@/components/desk/desk-parts";
import { Disclosure } from "@/components/disclosure";
import { PageHeader } from "@/components/page-header";
import { getAdminClient } from "@/lib/data";
import {
  adminDeskPath,
  arrangeItems,
  assetShelf,
  filterItems,
  isDeskId,
  isDeskStatus,
  isDeskStep,
  isDeskType,
} from "@/lib/desk";
import { portalOutputs } from "@/lib/desk-outputs";
import { listDeskItems, listDeskMessages, signDeskFiles } from "@/lib/desk-server";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { LogOutsideForm, NewItemForm } from "./desk-forms";

export const metadata = { title: "Desk" };

/** A client's Desk, from Rupert's side: what waits on us first, then the whole record. */
export default async function AdminClientDeskPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { step?: string; type?: string; status?: string };
}) {
  if (!isDeskId(params.id) || !isServiceRoleConfigured()) notFound();
  const client = await getAdminClient(params.id);
  if (!client) notFound();

  const supabase = createServiceClient();
  const [items, messages] = await Promise.all([listDeskItems(supabase, client.id), listDeskMessages(supabase, client.id)]);
  const back = <BackLink href={`/admin/clients/${client.id}`} label={client.company_name} />;
  if (!items.ok || !messages.ok) {
    return (
      <>
        {back}
        <PageHeader title="Desk" />
        <p className="text-body-sm text-error">{items.ok ? (messages.ok ? "" : messages.error) : items.error}</p>
      </>
    );
  }

  const filter = {
    step: isDeskStep(searchParams?.step) ? searchParams.step : ("" as const),
    type: isDeskType(searchParams?.type) ? searchParams.type : ("" as const),
    status: isDeskStatus(searchParams?.status) ? searchParams.status : ("" as const),
  };
  const filtered = Boolean(filter.step || filter.type || filter.status);
  const { waiting, rest: others } = arrangeItems(items.value, "admin");
  const rest = filtered
    ? filterItems(items.value, filter).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    : others;
  const shelf = assetShelf(messages.value);
  const fileLinks = await signDeskFiles(supabase, client.id, shelf.map((asset) => asset.attachment));
  const outputs = portalOutputs(client.setup_steps, Boolean(client.intake_completed_at));
  const href = (itemId: string) => adminDeskPath(client.id, itemId);
  const now = new Date();

  return (
    <>
      {back}
      <PageHeader
        title="Desk"
        description={`Everything ${client.company_name} has sent, wherever they sent it, and every answer. The client sees the same list.`}
      />

      <DeskCard title="Waiting on us" meta={waiting.length > 0 ? "Oldest first" : undefined}>
        <ItemList empty="Nothing is waiting on us.">
          {waiting.map((item) => (
            <ItemRow key={item.id} item={item} href={href(item.id)} side="admin" now={now} />
          ))}
        </ItemList>
      </DeskCard>

      <DeskCard
        title={filtered ? "Matching items" : "Everything else"}
        meta={`${rest.length} ${rest.length === 1 ? "item" : "items"}, newest first`}
        action={
          <Suspense fallback={null}>
            <DeskFilters side="admin" />
          </Suspense>
        }
      >
        <ItemList empty={filtered ? "Nothing matches those filters." : "Nothing else yet."}>
          {rest.map((item) => (
            <ItemRow key={item.id} item={item} href={href(item.id)} side="admin" now={now} />
          ))}
        </ItemList>
      </DeskCard>

      <Disclosure title="Post to Their Desk" meta="A question, an update or a shared asset">
        <div className="mt-md rounded-card border border-border bg-surface">
          <NewItemForm clientId={client.id} outputs={outputs} />
        </div>
      </Disclosure>
      <Disclosure title="Log an Outside Message" meta="An email or a call, with its real date">
        <div className="mt-md rounded-card border border-border bg-surface">
          <LogOutsideForm clientId={client.id} />
        </div>
      </Disclosure>
      <Disclosure title="Asset Shelf" meta={`${shelf.length} shared`}>
        <div className="mt-md rounded-card border border-border bg-surface">
          <AssetShelf assets={shelf} fileLinks={fileLinks} itemHref={href} empty="Nothing shared yet." />
        </div>
      </Disclosure>
    </>
  );
}
