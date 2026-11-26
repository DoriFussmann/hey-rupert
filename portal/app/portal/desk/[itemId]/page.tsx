import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { DeskCard, MessageThread, StatusChip, itemMeta } from "@/components/desk/desk-parts";
import { getPortalView } from "@/lib/data";
import { DESK_PATH, STEP_OPEN_LABEL, isDeskId } from "@/lib/desk";
import { loadDeskItem, signDeskFiles } from "@/lib/desk-server";
import { isServiceRoleConfigured } from "@/lib/env";
import { formatDateAtTime } from "@/lib/format";
import { createServiceClient } from "@/lib/supabase/admin";
import { ReplyForm } from "./reply-form";

export const metadata = { title: "The Desk" };

/** One item on the client's Desk: what was asked, every answer, and the reply box. */
export default async function DeskItemPage({ params }: { params: { itemId: string } }) {
  const { client, viewAs } = await getPortalView();
  if (!client || !isServiceRoleConfigured() || !isDeskId(params.itemId)) notFound();

  const supabase = createServiceClient();
  // Scoped to the client in the session: another client's item id finds nothing.
  const loaded = await loadDeskItem(supabase, client.id, params.itemId);
  if (!loaded.ok || !loaded.value) notFound();
  const { item, messages } = loaded.value;
  const fileLinks = await signDeskFiles(supabase, client.id, messages.flatMap((message) => message.attachments));

  return (
    <>
      <BackLink href={DESK_PATH} label="The Desk" />
      <header className="mb-lg flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <h1 className="text-h2 font-light text-heading">{item.title}</h1>
          <p className="mt-sm text-label uppercase tracking-label text-muted">
            {itemMeta(item)} · {formatDateAtTime(item.occurredAt)}
          </p>
        </div>
        <StatusChip status={item.status} side="client" />
      </header>

      {item.sourceHref && item.step !== "general" ? (
        <p className="mb-lg">
          <Link
            href={item.sourceHref}
            className="inline-flex rounded-md border border-primary/30 bg-primary-tint px-md py-sm text-body-sm text-primary no-underline transition-colors duration-hover hover:border-primary"
          >
            {STEP_OPEN_LABEL[item.step]}
          </Link>
        </p>
      ) : null}

      <DeskCard title="The record" meta="Messages can't be edited or deleted, so this stands as it was written.">
        <MessageThread messages={messages} side="client" fileLinks={fileLinks} />
      </DeskCard>

      <DeskCard title={item.status === "closed" ? "Closed" : "Reply"}>
        <ReplyForm itemId={item.id} status={item.status} readOnly={viewAs} />
      </DeskCard>
    </>
  );
}
