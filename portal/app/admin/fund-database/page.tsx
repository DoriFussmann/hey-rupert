import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ContactCorrections } from "@/app/admin/fund-database/contact-corrections";
import { ContactImport } from "@/app/admin/fund-database/contact-import";
import { DatabaseHistory } from "@/app/admin/fund-database/database-history";
import { FundDatabaseManager } from "@/app/admin/fund-database/fund-database-manager";
import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isServiceRoleConfigured } from "@/lib/env";
import type { ContactImportView } from "@/lib/match/contact-import";
import { asFundDbVersion, loadLiveDb, matchTableError } from "@/lib/match/db-server";
import { loadStagedImport } from "@/lib/match/import-server";
import { SITE_LABEL, type FundDbVersion, type SiteState } from "@/lib/match/shared";
import { loadCheckIndex } from "@/lib/match/sites-server";
import type { CorrectionRow, LeadRow } from "@/lib/match/verify";
import { loadCorrectionRows, loadLeadRows } from "@/lib/match/verify-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { matchPath } from "@/lib/match/shared";
import { isClientId } from "@/lib/view-as";

// Importing a workbook, contacts and the website batch run in server actions on this page.
export const maxDuration = 300;

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

async function loadPage(): Promise<{
  versions: FundDbVersion[];
  sites: { checked: number; recent: number; byStatus: { label: string; count: number }[] };
  error: string | null;
}> {
  const empty = { checked: 0, recent: 0, byStatus: [] };
  if (!isServiceRoleConfigured()) {
    return { versions: [], sites: empty, error: "Service role key is not configured." };
  }
  await requireAdmin();
  const supabase = createServiceClient();
  const [{ data, error }, index] = await Promise.all([
    supabase.from("fund_db_versions").select("*").order("created_at", { ascending: false }).limit(50),
    loadCheckIndex(supabase),
  ]);
  if (error) return { versions: [], sites: empty, error: matchTableError(error.message, error.code) };
  if (!index.ok) return { versions: [], sites: empty, error: index.error };

  const counts = new Map<string, number>();
  let recent = 0;
  for (const row of index.rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    if (Date.now() - Date.parse(row.checked_at) < MONTH_MS) recent += 1;
  }
  return {
    versions: (data ?? []).map(asFundDbVersion),
    sites: {
      checked: index.rows.length,
      recent,
      byStatus: Array.from(counts.entries())
        .map(([status, count]) => ({ label: SITE_LABEL[status as SiteState] ?? status, count }))
        .sort((a, b) => b.count - a.count),
    },
    error: null,
  };
}

async function loadCorrections(): Promise<{ corrections: CorrectionRow[]; leads: LeadRow[]; error: string | null }> {
  if (!isServiceRoleConfigured()) return { corrections: [], leads: [], error: null };
  const supabase = createServiceClient();
  const live = await loadLiveDb(supabase);
  const [corrections, leads] = await Promise.all([
    loadCorrectionRows(supabase, live.ok ? live.value.db.contacts : null),
    loadLeadRows(supabase),
  ]);
  if (!corrections.ok) return { corrections: [], leads: [], error: corrections.error };
  if (!leads.ok) return { corrections: [], leads: [], error: leads.error };
  return { corrections: corrections.value, leads: leads.value, error: null };
}

/** Every version that went live, oldest first, for the Database history. */
async function loadHistory(): Promise<FundDbVersion[]> {
  if (!isServiceRoleConfigured()) return [];
  const { data, error } = await createServiceClient()
    .from("fund_db_versions")
    .select("*")
    .not("applied_at", "is", null)
    .order("created_at", { ascending: true })
    .limit(1000);
  return error ? [] : (data ?? []).map(asFundDbVersion);
}

async function loadImport(): Promise<{ staged: ContactImportView | null; error: string | null }> {
  if (!isServiceRoleConfigured()) return { staged: null, error: null };
  const loaded = await loadStagedImport(createServiceClient());
  return loaded.ok ? { staged: loaded.value, error: null } : { staged: null, error: loaded.error };
}

export default async function FundDatabasePage({
  searchParams,
}: {
  searchParams: { client?: string | string[] };
}) {
  // Client matching moved to the Matching page; old links still land there.
  const requested = typeof searchParams.client === "string" ? searchParams.client : null;
  if (isClientId(requested)) redirect(matchPath(requested));
  const [{ versions, sites, error }, fixes, history, contactImport] = await Promise.all([
    loadPage(),
    loadCorrections(),
    loadHistory(),
    loadImport(),
  ]);
  const live = versions.find((version) => version.status === "live") ?? null;
  const verification = {
    leftFirm: fixes.corrections.filter((row) => row.flag === "left_firm").length,
    removed: fixes.corrections.filter((row) => row.flag === "removed").length,
    corrected: fixes.corrections.filter((row) => row.email || row.firstName || row.lastName || row.title).length,
  };

  return (
    <>
      <PageHeader
        title="Fund Database"
        description="The investor data matching runs on. Private: clients only ever see fund names and counts."
        actions={
          <Link href="/admin/taxonomy" className="text-body-sm text-secondary hover:text-heading">
            Investor taxonomy →
          </Link>
        }
      />
      {error ? (
        <p role="alert" className="mb-lg rounded-card border border-error/40 bg-surface px-lg py-md text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <ContactCorrections corrections={fixes.corrections} leads={fixes.leads} error={fixes.error} />
      <FundDatabaseManager versions={versions} sites={sites} />
      <ContactImport staged={contactImport.staged} error={contactImport.error} hasLive={Boolean(live)} />
      <DatabaseHistory versions={history} live={live} verification={verification} />
    </>
  );
}
