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
import { FirmLookup, type FilterOption } from "@/app/admin/taxonomy/firm-lookup";
import { ClassifyButton } from "@/app/admin/taxonomy/classify-button";
import { RelationshipReview } from "@/app/admin/taxonomy/relationship-review";
import { ValueReview, type ValueItem } from "@/app/admin/taxonomy/value-review";
import { FofPanel, type FofItem } from "@/app/admin/taxonomy/fof-panel";
import { n } from "@/app/admin/clients/[id]/match/ui";
import { DUPLICATE_LEVELS, DUPLICATE_LEVEL_INFO, findDuplicates, identityProposals, resolveIdentities } from "@/lib/match/tiers/duplicates";
import { fofCandidates, loadFofExceptions, loadIdentityDecisions } from "@/lib/match/tiers/server";
import type { TaxIndex, TaxNode } from "@/lib/taxonomy/core";

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

/** The categories a lookup filter offers: active ones of a dimension, in a stable order. */
function options(index: TaxIndex, dimension: TaxNode["dimension"]): FilterOption[] {
  const nodes = index.taxonomy.nodes.filter((node) => node.dimension === dimension && node.status === "active");
  const ladder = (node: TaxNode) => Number((node.attrs as { ladder?: unknown }).ladder ?? 99);
  return nodes
    .sort((a, b) => (dimension === "stage" ? ladder(a) - ladder(b) : 0) || a.label.localeCompare(b.label))
    .map((node) => ({ id: node.id, label: node.label }));
}

function Attention({ items }: { items: { label: string; count: number; href: string; hint: string }[] }) {
  const open = items.filter((item) => item.count > 0);
  return (
    <section aria-labelledby="attention" className="mb-lg rounded-card border border-border bg-surface px-lg py-md">
      <h2 id="attention" className="text-h4 text-heading">
        Needs attention
      </h2>
      {open.length === 0 ? (
        <p className="mt-xs text-body-sm text-success">Nothing waiting.</p>
      ) : (
        <ul className="mt-sm grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.label}>
              <a
                href={item.href}
                className={`block rounded-md border px-md py-sm no-underline ${item.count > 0 ? "border-warning/40 hover:bg-background" : "border-border"}`}
              >
                <p className="text-label uppercase tracking-label text-muted">{item.label}</p>
                <p className={`mt-xs font-mono text-h4 ${item.count > 0 ? "text-warning" : "text-secondary"}`}>{n(item.count)}</p>
                <p className="text-body-sm text-muted">{item.hint}</p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function TaxonomyPage() {
  await requireAdmin();
  const header = (
    <PageHeader
      title="Taxonomy"
      description="The Fund Database, classified: clean categories, how each provider value maps to them, and how sectors relate."
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
  const [run, changes, exceptions, decisions] = await Promise.all([
    live.ok ? loadLatestRun(supabase, live.value.version.id) : Promise.resolve(null),
    loadChanges(supabase),
    loadFofExceptions(supabase),
    loadIdentityDecisions(supabase),
  ]);
  const dupes = live.ok ? findDuplicates(live.value.db, index) : null;
  // Groups waiting for a decision: same-ID and certain duplicates nobody decided, and decisions made for other records.
  const undecided =
    dupes && decisions.ok
      ? resolveIdentities(identityProposals(dupes), decisions.value).filter(
          (group) => group.stale || (!group.decision && (group.level === "same_id" || group.level === "certain")),
        ).length
      : 0;
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
  const unmapped = index.taxonomy.aliases.filter((alias) => alias.state === "unmapped").length;
  const valuesToReview = index.taxonomy.aliases.filter((alias) => alias.state === "unmapped" || alias.review === "needs_review").length;
  const attention = [
    { label: "Values to review", count: valuesToReview + unregistered, href: "#values", hint: unregistered > 0 ? `${n(unregistered)} new: click Classify new data` : "Accept or fix each mapping" },
    { label: "Sector links to review", count: index.taxonomy.edges.filter((edge) => edge.review === "needs_review").length, href: "#relationships", hint: "Only approved links place a fund" },
    { label: "Duplicate firms to decide", count: undecided, href: "/admin/taxonomy/duplicates", hint: "Shown once only after a decision" },
    { label: "Fund-of-funds exceptions", count: exceptions.ok ? Array.from(exceptions.value.values()).filter((item) => item.status === "needs_review").length : 0, href: "#fund-of-funds", hint: "Awaiting review" },
  ];

  return (
    <>
      {header}
      {!live.ok ? <Alert>{live.error}</Alert> : null}
      {run && !run.ok ? <Alert>{run.error}</Alert> : null}

      <section className="mb-lg flex flex-wrap items-center justify-between gap-md rounded-card border border-border bg-surface px-lg py-md">
        <div className="text-body-sm">
          <p className="text-heading">
            {live.ok ? `Live database: ${live.value.version.fileName}` : "No live database"} · Taxonomy revision {index.taxonomy.revision}
          </p>
          <p className="mt-xs text-muted">
            {unregistered > 0
              ? `${n(unregistered)} value${unregistered === 1 ? " is" : "s are"} not classified yet.`
              : unmapped > 0
                ? `${n(unmapped)} value${unmapped === 1 ? " is" : "s are"} not mapped yet.`
                : "Every value is classified."}
            {stale && unregistered === 0 ? " The counts below are from an earlier revision." : ""} Classify finds new values and asks the AI for suggestions; you
            approve each one.
          </p>
        </div>
        {live.ok ? <ClassifyButton highlight={stale || unregistered > 0 || unmapped > 0} /> : null}
      </section>

      {latest ? <CoveragePanel run={latest} /> : null}
      <Attention items={attention} />
      <FirmLookup sectors={options(index, "sector")} geographies={options(index, "geography")} stages={options(index, "stage")} />

      <Disclosure id="values" title="Value mappings" meta="Provider values and their canonical categories" defaultOpen>
        <ValueReview values={values} nodes={index.taxonomy.nodes} />
      </Disclosure>
      <Disclosure id="relationships" title="Sector relationships" meta="The links that decide the tiers">
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
      <Disclosure id="changes" title="Change log" meta="Latest 50 changes">
        {changes.ok ? <ChangeLog changes={changes.value} /> : <Alert>{changes.error}</Alert>}
      </Disclosure>
    </>
  );
}
