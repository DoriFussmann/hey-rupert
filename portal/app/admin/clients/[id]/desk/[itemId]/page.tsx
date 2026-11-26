import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { DeskCard, MessageThread, StatusChip, itemMeta } from "@/components/desk/desk-parts";
import { Disclosure } from "@/components/disclosure";
import { getAdminClient } from "@/lib/data";
import { adminDeskPath, isDeskId } from "@/lib/desk";
import { portalOutputs } from "@/lib/desk-outputs";
import { loadDeskItem, loadDeskNotes, signDeskFiles } from "@/lib/desk-server";
import { isServiceRoleConfigured } from "@/lib/env";
import { formatDateAtTime } from "@/lib/format";
import { createServiceClient } from "@/lib/supabase/admin";
import { AdminReplyForm, InternalNotes, LogOutsideForm } from "../desk-forms";

export const metadata = { title: "Desk" };

/** One Desk item, from Rupert's side: the record, the reply box, and his internal notes. */
export default async function AdminDeskItemPage({ params }: { params: { id: string; itemId: string } }) {
  if (!isDeskId(params.id) || !isDeskId(params.itemId) || !isServiceRoleConfigured()) notFound();
  const client = await getAdminClient(params.id);
  if (!client) notFound();

  const supabase = createServiceClient();
  const loaded = await loadDeskItem(supabase, client.id, params.itemId);
  if (!loaded.ok || !loaded.value) notFound();
  const { item, messages } = loaded.value;
  const [notes, fileLinks] = await Promise.all([
    loadDeskNotes(supabase, client.id, item.id),
    signDeskFiles(supabase, client.id, messages.flatMap((message) => message.attachments)),
  ]);
  const outputs = portalOutputs(client.setup_steps, Boolean(client.intake_completed_at));

  return (
    <>
      <BackLink href={adminDeskPath(client.id)} label={`${client.company_name} · Desk`} />
      <header className="mb-lg flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <h1 className="text-h2 font-light text-heading">{item.title}</h1>
          <p className="mt-sm text-label uppercase tracking-label text-muted">
            {itemMeta(item)} · {formatDateAtTime(item.occurredAt)}
            {item.sourceHref ? (
              <>
                {" · "}
                <Link href={`/admin/clients/${client.id}`} className="text-primary no-underline hover:text-primary-hover">
                  Client page
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <StatusChip status={item.status} side="admin" />
      </header>

      <DeskCard title="The record" meta="What the client sees. Messages can't be edited or deleted.">
        <MessageThread messages={messages} side="admin" fileLinks={fileLinks} />
      </DeskCard>

      <DeskCard title="Reply">
        <AdminReplyForm clientId={client.id} itemId={item.id} status={item.status} outputs={outputs} />
      </DeskCard>

      <DeskCard title="Internal notes" meta="Only you see these.">
        {notes.ok ? (
          <InternalNotes clientId={client.id} itemId={item.id} notes={notes.value} />
        ) : (
          <p className="px-lg py-md text-body-sm text-error">{notes.error}</p>
        )}
      </DeskCard>

      <Disclosure title="Log an Outside Message on This Item" meta="An email or a call about it, with its real date">
        <div className="mt-md rounded-card border border-border bg-surface">
          <LogOutsideForm clientId={client.id} itemId={item.id} />
        </div>
      </Disclosure>
    </>
  );
}
