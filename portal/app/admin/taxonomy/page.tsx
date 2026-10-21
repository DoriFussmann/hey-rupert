import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Disclosure } from "@/components/disclosure";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveDb } from "@/lib/match/db-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isBrokenAlias, newRawValues } from "@/lib/taxonomy/core";
import {
  NODE_KINDS,
  loadChanges,
  loadLatestRun,
  loadTaxonomy,
  rawValueCounts,
} from "@/lib/taxonomy/server";
import { CategoryBrowser } from "@/app/admin/taxonomy/category-browser";
import { ChangeLog } from "@/app/admin/taxonomy/change-log";
import { CoveragePanel } from "@/app/admin/taxonomy/coverage-panel";
import { FirmLookup } from "@/app/admin/taxonomy/firm-lookup";
import { RecomputeButton } from "@/app/admin/taxonomy/recompute-button";
import { RelationshipReview } from "@/app/admin/taxonomy/relationship-review";
import { ValueReview, type ValueItem } from "@/app/admin/taxonomy/value-review";
import { FofPanel, type FofItem } from "@/app/admin/taxonomy/fof-panel";
import { n } from "@/app/admin/clients/[id]/match/ui";
import { DUPLICATE_LEVELS, DUPLICATE_LEVEL_INFO, findDuplicates } from "@/lib/match/tiers/duplicates";
import { fofCandidates, loadFofExceptions } from "@/lib/match/tiers/server";

// Always live data. A coverage run maps every firm of the live database.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mb-lg rounded-card border border-error/40 bg-surface px-lg py-md text-body-sm text-error">
      {children}
    </p>
  );
}

export default async function TaxonomyPage() {
  await requireAdmin();
  const header = (
    <PageHeader
      title="Investor taxonomy"
      description="The canonical sectors, stages, geographies, financing types and firm types the Fund Database maps to, how each provider value maps, and how sectors relate. The provider's data is never changed: every firm keeps its original values."
      actions={
        <Link href="/admin/fund-database" className="text-body-sm text-secondary hover:text-heading">
          Fund Database →
        </Link>
      }
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
  const [taxonomy, live] = await Promise.all([loadTaxonomy(supabase), loadLiveDb(supabase)]);
  if (!taxonomy.ok) {
    return (
      <>
        {header}
        <Alert>{taxonomy.error}</Alert>
      </>
    );
  }
  const index = taxonomy.value;
  const [run, changes, exceptions] = await Promise.all([
    live.ok ? loadLatestRun(supabase, live.value.version.id) : Promise.resolve(null),
    loadChanges(supabase),
    loadFofExceptions(supabase),
  ]);
  const dupes = live.ok ? findDuplicates(live.value.db, index) : null;
  const fofItems: FofItem[] = live.ok && exceptions.ok ? fofCandidates(live.value.db, index, exceptions.value) : [];

  const counts = live.ok ? rawValueCounts(live.value.version.id, live.value.db) : [];
  const firmsByValue = new Map(counts.map((value) => [`${value.field}|${value.rawKey}`, value.firms]));
  const values: ValueItem[] = index.taxonomy.aliases.map((alias) => ({
    ...alias,
    firms: firmsByValue.get(`${alias.field}|${alias.rawKey}`) ?? 0,
    broken: isBrokenAlias(index, alias),
  }));
  const unregistered = live.ok ? newRawValues(live.value.db, index).length : 0;
  const latest = run?.ok ? run.value : null;
  const stale = live.ok && (!latest || latest.revision < index.taxonomy.revision);

  return (
    <>
      {header}
      {!live.ok ? <Alert>{live.error}</Alert> : null}
      {run && !run.ok ? <Alert>{run.error}</Alert> : null}

      <section className="mb-lg flex flex-wrap items-center justify-between gap-md rounded-card border border-border bg-surface px-lg py-md">
        <div className="text-body-sm">
          <p className="text-heading">
            {live.ok ? `Live database: ${live.value.version.fileName}` : "No live database"} · Taxonomy revision{" "}
            {index.taxonomy.revision}
          </p>
          <p className="mt-xs text-muted">
            {latest
              ? `Coverage last computed at revision ${latest.revision}.`
              : "Coverage has not been computed for the live database yet."}
            {stale ? " The taxonomy has changed since: recompute to update the numbers below." : ""}
            {unregistered > 0 ? ` ${unregistered} value${unregistered === 1 ? " is" : "s are"} not in the taxonomy yet; recomputing adds them for review.` : ""}
          </p>
        </div>
        {live.ok ? <RecomputeButton highlight={stale || unregistered > 0} /> : null}
      </section>

      {latest ? <CoveragePanel run={latest} /> : null}

      <Disclosure id="values" title="Value mappings" meta="Provider values and their canonical categories" defaultOpen>
        <ValueReview values={values} nodes={index.taxonomy.nodes} />
      </Disclosure>
      <Disclosure id="relationships" title="Sector relationships" meta="The graph later matching tiers use">
        <RelationshipReview edges={index.taxonomy.edges} nodes={index.taxonomy.nodes} />
      </Disclosure>
      <Disclosure id="categories" title="Categories" meta={`${index.taxonomy.nodes.length} canonical categories`}>
        <CategoryBrowser nodes={index.taxonomy.nodes} aliases={index.taxonomy.aliases} kinds={NODE_KINDS} />
      </Disclosure>
      <Disclosure id="duplicates" title="Possible duplicate firms" meta="Shown once in matching only when an admin decides">
        {dupes ? (
          <>
            <table className="w-full max-w-2xl text-left text-body-sm">
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
              <Link href="/admin/taxonomy/duplicates" className="text-secondary underline hover:text-heading">
                Open the duplicate report and decide
              </Link>
            </p>
          </>
        ) : (
          <p className="text-body-sm text-muted">No live Fund Database.</p>
        )}
      </Disclosure>
      <Disclosure id="fund-of-funds" title="Fund-of-funds exceptions" meta="Funds whose only financing is fund of funds">
        {exceptions.ok ? <FofPanel items={fofItems} /> : <Alert>{exceptions.error}</Alert>}
      </Disclosure>
      <Disclosure id="firm-lookup" title="Firm lookup" meta="One firm's raw values next to its mapping">
        <FirmLookup />
      </Disclosure>
      <Disclosure id="changes" title="Change log" meta="Latest 50 changes">
        {changes.ok ? <ChangeLog changes={changes.value} /> : <Alert>{changes.error}</Alert>}
      </Disclosure>
    </>
  );
}
