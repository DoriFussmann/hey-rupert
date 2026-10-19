import { PageHeader } from "@/components/page-header";
import { FundDatabaseManager } from "@/app/admin/fund-database/fund-database-manager";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { asFundDbVersion, matchTableError } from "@/lib/match/db-server";
import { SITE_LABEL, type FundDbVersion, type SiteState } from "@/lib/match/shared";
import { loadCheckIndex } from "@/lib/match/sites-server";
import { createServiceClient } from "@/lib/supabase/admin";

// Importing a workbook and the website batch run in server actions on this page.
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

export default async function FundDatabasePage() {
  const { versions, sites, error } = await loadPage();

  return (
    <>
      <PageHeader
        title="Fund Database"
        description="The investor database Rupert Match runs on. It stays private on the server: clients only ever see fund names and counts. Upload a new workbook when the data provider sends one; you see what changes before it goes live."
      />
      {error ? (
        <p role="alert" className="mb-lg rounded-card border border-error/40 bg-surface px-lg py-md text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <FundDatabaseManager versions={versions} sites={sites} />
    </>
  );
}
