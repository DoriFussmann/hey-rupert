import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveDb } from "@/lib/match/db-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { cardClass, n } from "@/app/admin/clients/[id]/match/ui";
import { EngineSwitch } from "@/app/admin/matching/engine-switch";
import { FofPanel, type FofItem } from "@/app/admin/matching/fof-panel";
import { ENGINE_MIGRATION_MISSING, loadEngineChanges, loadEngineSetting } from "@/lib/match/engine-setting";
import { MATCH_ENGINE_LABEL } from "@/lib/match/shared";
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
      title="Four-tier matching"
      description="Choose the match engine for every client, compare both engines for a client, and review duplicate firms and fund-of-funds exceptions."
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
  const [taxonomy, live, exceptions, clients, engine, changes] = await Promise.all([
    loadTaxonomy(supabase),
    loadLiveDb(supabase),
    loadFofExceptions(supabase),
    supabase.from("clients").select("id, company_name, is_match_sandbox, archived_at").order("company_name"),
    loadEngineSetting(supabase),
    loadEngineChanges(supabase, 30),
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
      <Section title="Match engine">
        {!engine.ok ? (
          <p role="alert" className="text-body-sm text-error">{engine.error}</p>
        ) : (
          <>
            <p className="text-body-sm text-secondary">
              In use for every client: <span className="text-heading">{MATCH_ENGINE_LABEL[engine.value.engine]}</span>
              {engine.value.updatedAt
                ? ` · since ${new Date(engine.value.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} by ${engine.value.updatedBy ?? "unknown"}`
                : " · the default"}
              .
            </p>
            <p className="mt-xs text-body-sm text-muted">
              It decides what the Match page shows, what verification checks and what Push to client sends. Switching never changes a saved run, a
              pushed list or a list already sent: each list keeps the tiers it was pushed with.
            </p>
            {!engine.value.configured ? <p role="alert" className="mt-xs text-body-sm text-warning">{ENGINE_MIGRATION_MISSING}</p> : null}
            <EngineSwitch engine={engine.value.engine} configured={engine.value.configured} />
            {changes.ok && changes.value.length > 0 ? (
              <details className="mt-sm">
                <summary className="cursor-pointer text-body-sm text-secondary hover:text-heading">Change log ({changes.value.length})</summary>
                <ul className="mt-xs space-y-xs text-body-sm text-secondary">
                  {changes.value.map((change) => (
                    <li key={change.id}>
                      {new Date(change.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {change.actor ?? "unknown"} ·{" "}
                      {change.from ? MATCH_ENGINE_LABEL[change.from] : "Default (current)"} → {change.to ? MATCH_ENGINE_LABEL[change.to] : "–"}
                      {change.note ? ` · ${change.note}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {!changes.ok ? <p role="alert" className="mt-xs text-body-sm text-error">{changes.error}</p> : null}
          </>
        )}
      </Section>
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

      <Section title="Clients">
        {clients.error ? (
          <p role="alert" className="text-body-sm text-error">{clients.error.message}</p>
        ) : clientRows.length === 0 ? (
          <p className="text-body-sm text-muted">No clients.</p>
        ) : (
          <ul className="grid gap-xs text-body-sm sm:grid-cols-2 lg:grid-cols-3">
            {clientRows.map((client) => (
              <li key={client.id} className="text-secondary">
                {client.company_name}
                {client.is_match_sandbox ? " (sandbox)" : ""}:{" "}
                <Link href={`/admin/clients/${client.id}/match/four-tier`} className="underline hover:text-heading">
                  Runs
                </Link>{" "}
                ·{" "}
                <Link href={`/admin/clients/${client.id}/match/compare`} className="underline hover:text-heading">
                  Compare
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
