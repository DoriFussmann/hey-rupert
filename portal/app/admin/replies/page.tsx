import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ReplyTriage } from "@/app/admin/replies/reply-triage";
import { requireAdmin } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import { bouncedContacts, listAdminReplies } from "@/lib/outreach/replies-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function RepliesPage({ searchParams }: { searchParams: { show?: string } }) {
  const filter = searchParams.show === "all" ? "all" : "pending";
  let replies: Awaited<ReturnType<typeof listAdminReplies>> = { ok: true, value: [] };
  let bounced: Awaited<ReturnType<typeof bouncedContacts>> = [];
  if (isServiceRoleConfigured()) {
    await requireAdmin();
    const supabase = createServiceClient();
    [replies, bounced] = await Promise.all([listAdminReplies(supabase, filter), bouncedContacts(supabase)]);
  }

  return (
    <>
      <PageHeader
        title="Replies"
        description="Every investor reply comes here first. The client sees a reply only after you release it; withheld ones stay here, with your reason."
      />
      <div className="mb-md flex gap-md text-body-sm">
        <Link href="/admin/replies" className={filter === "pending" ? "text-heading" : "text-primary hover:text-primary-hover"}>
          Waiting for you
        </Link>
        <Link href="/admin/replies?show=all" className={filter === "all" ? "text-heading" : "text-primary hover:text-primary-hover"}>
          All replies
        </Link>
      </div>
      {replies.ok ? (
        <ReplyTriage replies={replies.value} claudeReady={isClaudeConfigured()} />
      ) : (
        <p role="alert" className="rounded-card border border-error/30 bg-surface px-lg py-md text-body-sm text-error">
          {replies.error}
        </p>
      )}
      {bounced.length > 0 ? (
        <section className="mt-xl rounded-card border border-border bg-surface">
          <div className="border-b border-border px-lg py-md">
            <h2 className="text-h4">Bounced contacts</h2>
            <p className="mt-xs text-body-sm text-muted">
              Consider activating a reserve contact at the fund (client page → Setup → Core contacts), then Add newly approved contacts in the Campaign panel.
            </p>
          </div>
          <ul className="divide-y divide-border text-body-sm">
            {bounced.map((item) => (
              <li key={`${item.client_id}-${item.email}`} className="flex flex-wrap gap-sm px-lg py-sm">
                <span className="text-heading">{item.fund_name}</span>
                <span className="text-muted">
                  {item.name} · {item.email}
                </span>
                <Link href={`/admin/clients/${item.client_id}#setup-core-contacts`} className="ml-auto text-primary hover:text-primary-hover">
                  Client
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
