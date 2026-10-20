import { PageHeader } from "@/components/page-header";
import { ContactCorrections } from "@/app/admin/fund-database/contact-corrections";
import { MatchSandbox } from "@/app/admin/fund-database/match-sandbox";
import RME from "@/lib/match/engine/index.mjs";
import type { SandboxPanel } from "@/lib/match/sandbox";
import { loadSandboxPanel } from "@/lib/match/sandbox-server";
import { FundDatabaseManager } from "@/app/admin/fund-database/fund-database-manager";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { asFundDbVersion, loadLiveDb, matchTableError } from "@/lib/match/db-server";
import { SITE_LABEL, type FundDbVersion, type SiteState } from "@/lib/match/shared";
import { loadCheckIndex } from "@/lib/match/sites-server";
import type { CorrectionRow, LeadRow } from "@/lib/match/verify";
import { loadCorrectionRows, loadLeadRows } from "@/lib/match/verify-server";
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

async function loadSandbox(): Promise<{ panel: SandboxPanel | null; error: string | null }> {
  if (!isServiceRoleConfigured()) return { panel: null, error: null };
  const loaded = await loadSandboxPanel(createServiceClient());
  return loaded.ok ? { panel: loaded.value, error: null } : { panel: null, error: loaded.error };
}

export default async function FundDatabasePage() {
  const [{ versions, sites, error }, fixes, sandbox] = await Promise.all([
    loadPage(),
    loadCorrections(),
    loadSandbox(),
  ]);

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
      {sandbox.panel ? (
        <MatchSandbox
          panel={sandbox.panel}
          taxonomy={{
            stages: [...RME.VC_LADDER, ...RME.PE_STAGES],
            verticals: RME.VERTICALS,
            industries: RME.INDUSTRIES,
            countries: RME.COUNTRIES,
          }}
        />
      ) : sandbox.error ? (
        <p role="alert" className="mb-lg rounded-card border border-error/40 bg-surface px-lg py-md text-body-sm text-error">
          {sandbox.error}
        </p>
      ) : null}
      <ContactCorrections corrections={fixes.corrections} leads={fixes.leads} error={fixes.error} />
      <FundDatabaseManager versions={versions} sites={sites} />
    </>
  );
}
