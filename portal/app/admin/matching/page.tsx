import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveDb } from "@/lib/match/db-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { cardClass, n } from "@/app/admin/clients/[id]/match/ui";
import { FofPanel, type FofItem } from "@/app/admin/matching/fof-panel";
import { DUPLICATE_LEVELS, DUPLICATE_LEVEL_INFO, findDuplicates } from "@/lib/match/tiers/duplicates";
import { RULES_VERSION, TIER_INFO, TIER_KEYS } from "@/lib/match/tiers/core";
import { fofCandidates, loadFofExceptions } from "@/lib/match/tiers/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mb-lg rounded-card border border-error/40 bg-surface px-lg py-md text-body-sm text-error">
      {children}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${cardClass} mb-lg px-lg py-md`}>
      <h2 className="text-h4 text-heading">{title}</h2>
      <div className="mt-sm">{children}</div>
    </section>
  );
}

export default async function FourTierPage() {
  await requireAdmin();
  const header = (
    <PageHeader
      title="Four-tier matching (preview)"
      description="The four-tier engine runs alongside the current one. Compare both for a client, review possible duplicate firms (read-only) and fund-of-funds exceptions. The live Match page, founder pages and exports still use the current engine."
    />
  );
  if (!isServiceRoleConfigured()) {
    return (
      <>
        {header}
        <Alert>Service role key is not configured.</Alert>
      </>
    );
  }

  const supabase = createServiceClient();
  const [taxonomy, live, exceptions, clients] = await Promise.all([
    loadTaxonomy(supabase),
    loadLiveDb(supabase),
    loadFofExceptions(supabase),
    supabase.from("clients").select("id, company_name, is_match_sandbox, archived_at").order("company_name"),
  ]);
  if (!taxonomy.ok || !live.ok || !exceptions.ok) {
    return (
      <>
        {header}
        <Alert>{!taxonomy.ok ? taxonomy.error : !live.ok ? live.error : !exceptions.ok ? exceptions.error : ""}</Alert>
      </>
    );
  }
  const index = taxonomy.value;
  const edges = index.taxonomy.edges;
  const approved = edges.filter((e) => e.review === "approved").length;
  const rejected = edges.filter((e) => e.review === "rejected").length;
  const waiting = edges.filter((e) => e.review === "needs_review").length;
  const cannabis = edges.find((e) => e.fromId === "sector.cannabis" && e.toId === "sector.consumer_tech");
  const dupes = findDuplicates(live.value.db, index);
  const items: FofItem[] = fofCandidates(live.value.db, index, exceptions.value);
  const clientRows = (clients.data ?? []).filter((c) => !c.archived_at);

  return (
    <>
      {header}
      <Section title="Rules">
        <p className="text-body-sm text-secondary">
          Rules {RULES_VERSION}. Taxonomy revision {index.taxonomy.revision}. Fund Database: {live.value.version.fileName} ({n(live.value.db.firms.length)} firms).
        </p>
        <p className="mt-xs text-body-sm text-secondary">
          Sector relationships: {approved} approved, {rejected} rejected, {waiting} awaiting review. Only approved relationships place a fund.
          Cannabis → Consumer Tech: {cannabis ? cannabis.review.replace("_", " ") : "not in the taxonomy"}.
        </p>
        <ul className="mt-sm grid gap-xs text-body-sm sm:grid-cols-2">
          {TIER_KEYS.map((key) => (
            <li key={key}>
              <span className="text-heading">{TIER_INFO[key].label}:</span> <span className="text-secondary">{TIER_INFO[key].description}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Compare a client">
        {clients.error ? (
          <p role="alert" className="text-body-sm text-error">{clients.error.message}</p>
        ) : clientRows.length === 0 ? (
          <p className="text-body-sm text-muted">No clients.</p>
        ) : (
          <ul className="grid gap-xs text-body-sm sm:grid-cols-2 lg:grid-cols-3">
            {clientRows.map((client) => (
              <li key={client.id}>
                <Link href={`/admin/clients/${client.id}/match/compare`} className="text-secondary hover:text-heading">
                  {client.company_name}
                  {client.is_match_sandbox ? " (sandbox)" : ""}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Possible duplicate firms">
        <p className="text-body-sm text-muted">Read-only. Nothing is merged, hidden or changed.</p>
        <table className="mt-sm w-full max-w-2xl text-left text-body-sm">
          <tbody>
            {DUPLICATE_LEVELS.map((level) => (
              <tr key={level} className="border-b border-border">
                <td className="py-xs pr-md text-heading">{DUPLICATE_LEVEL_INFO[level].label}</td>
                <td className="py-xs pr-md text-right tabular-nums text-secondary">{n(dupes.counts[level].groups)} groups</td>
                <td className="py-xs text-right tabular-nums text-secondary">{n(dupes.counts[level].firms)} firms</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-sm text-body-sm">
          <Link href="/admin/matching/duplicates" className="text-secondary underline hover:text-heading">
            Open the duplicate report
          </Link>
        </p>
      </Section>

      <Section title="Funds of funds">
        <FofPanel items={items} />
      </Section>
    </>
  );
}
