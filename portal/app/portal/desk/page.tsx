import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { DeskFilters } from "@/components/desk/desk-filters";
import { AssetShelf, DeskCard, ItemList, ItemRow } from "@/components/desk/desk-parts";
import { getPortalView } from "@/lib/data";
import {
  arrangeItems,
  assetShelf,
  deskItemPath,
  filterItems,
  isDeskStatus,
  isDeskStep,
  isDeskType,
} from "@/lib/desk";
import { listDeskItems, listDeskMessages, signDeskFiles } from "@/lib/desk-server";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { AskRupert } from "./ask-rupert";

export const metadata = { title: "The Desk" };

const DESCRIPTION =
  "Everything you send Rupert and every answer, in one place and in order. Hand something in here; the answer comes back here.";

/**
 * The client's Desk: what is waiting on them first, then the whole record,
 * newest first, and every asset Rupert has shared. The client is always the
 * signed-in one (or the one an admin or viewer is looking at, read-only).
 */
export default async function DeskPage({
  searchParams,
}: {
  searchParams?: { step?: string; type?: string; status?: string };
}) {
  const { client, viewAs } = await getPortalView();

  if (!client || !isServiceRoleConfigured()) {
    return (
      <>
        <PageHeader title="The Desk" description={DESCRIPTION} />
        <EmptyState title="Your Desk isn't available right now." description="Please try again in a moment, or use Book a call." />
      </>
    );
  }

  const supabase = createServiceClient();
  const [items, messages] = await Promise.all([listDeskItems(supabase, client.id), listDeskMessages(supabase, client.id)]);
  if (!items.ok || !messages.ok) {
    return (
      <>
        <PageHeader title="The Desk" description={DESCRIPTION} />
        <EmptyState title="Your Desk is being set up." description="It will be here shortly. Until then, email Rupert as usual." />
      </>
    );
  }

  const filter = {
    step: isDeskStep(searchParams?.step) ? searchParams.step : ("" as const),
    type: isDeskType(searchParams?.type) ? searchParams.type : ("" as const),
    status: isDeskStatus(searchParams?.status) ? searchParams.status : ("" as const),
  };
  const filtered = Boolean(filter.step || filter.type || filter.status);
  const { waiting, rest: others } = arrangeItems(items.value, "client");
  // With a filter on, the list below is everything that matches; without one, what isn't already above.
  const rest = filtered
    ? filterItems(items.value, filter).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    : others;

  const shelf = assetShelf(messages.value);
  const fileLinks = await signDeskFiles(supabase, client.id, shelf.map((asset) => asset.attachment));
  const now = new Date();

  return (
    <>
      <PageHeader title="The Desk" description={DESCRIPTION} actions={<AskRupert readOnly={viewAs} />} />

      {waiting.length > 0 ? (
        <DeskCard title="Waiting on you" meta={`${waiting.length} ${waiting.length === 1 ? "item" : "items"}`}>
          <ItemList empty="">
            {waiting.map((item) => (
              <ItemRow key={item.id} item={item} href={deskItemPath(item.id)} side="client" now={now} />
            ))}
          </ItemList>
        </DeskCard>
      ) : null}

      <DeskCard
        title={filtered ? "Matching items" : waiting.length > 0 ? "Everything else" : "Your record"}
        meta={items.value.length === 0 ? undefined : `${rest.length} ${rest.length === 1 ? "item" : "items"}, newest first`}
        action={
          items.value.length > 0 ? (
            <Suspense fallback={null}>
              <DeskFilters side="client" />
            </Suspense>
          ) : null
        }
      >
        <ItemList
          empty={
            filtered
              ? "Nothing matches those filters."
              : items.value.length === 0
                ? "Nothing here yet. Whatever you send Rupert, from here or from any step, will be listed with its date and his answer."
                : "Nothing else yet."
          }
        >
          {rest.map((item) => (
            <ItemRow key={item.id} item={item} href={deskItemPath(item.id)} side="client" now={now} />
          ))}
        </ItemList>
      </DeskCard>

      <DeskCard id="assets" title="Asset shelf" meta="Everything Rupert has shared with you, latest version.">
        <AssetShelf
          assets={shelf}
          fileLinks={fileLinks}
          itemHref={deskItemPath}
          empty="Nothing shared yet. Documents Rupert shares with you stay here, so you can reopen them any time."
        />
      </DeskCard>
    </>
  );
}
