import { SummaryView } from "@/app/admin/matching/summary-view";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadDeliverables } from "@/lib/match/summary/server";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * What was pushed from the matching for the client: the Matching Summary and
 * the Competitive Landscape Overview. On this admin page only; nothing has
 * gone to the client's portal yet (drafting the email comes next).
 */
export async function ReadyForClient({ clientId }: { clientId: string }) {
  if (!isServiceRoleConfigured()) return null;
  const list = await loadDeliverables(createServiceClient(), clientId);
  if (!list.ok) return list.error.includes("match_summary.sql") ? null : <p className="mb-lg text-body-sm text-error">{list.error}</p>;
  if (!list.value.length) return null;
  return (
    <section aria-labelledby="ready-for-client" className="mb-lg space-y-md">
      <div>
        <h2 id="ready-for-client" className="text-h3 text-heading">
          Ready for the client
        </h2>
        <p className="text-body-sm text-muted">Pushed from Matching. Not in the client&apos;s portal yet.</p>
      </div>
      {list.value.map((d) => (
        <SummaryView
          key={d.id}
          summary={d.content}
          footer={
            <>
              <span className="mr-auto text-body-sm text-muted">
                Pushed {when(d.pushedAt)}
                {d.pushedBy ? ` by ${d.pushedBy}` : ""}
              </span>
              <a
                href={`/admin/clients/${clientId}/summary-export?kind=${d.kind}&from=pushed`}
                className="rounded-md border border-border bg-surface px-md py-[6px] text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading"
              >
                Download (Excel)
              </a>
            </>
          }
        />
      ))}
    </section>
  );
}
