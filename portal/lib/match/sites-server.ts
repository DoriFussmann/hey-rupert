import "server-only";
import type { Firm, SiteResult } from "@/lib/match/engine/index.mjs";
import { checkSite } from "@/lib/match/site-check/site-check.mjs";
import { loadLiveDb, matchTableError, selectAll } from "@/lib/match/db-server";
import { DAILY_SITE_BATCH } from "@/lib/match/shared";
import type { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Re-check a client's top funds when the stored result is older than this. */
export const SITE_STALE_DAYS = 14;

const CONCURRENCY = 24;
const SITE_TIMEOUT_MS = 10_000;
const ID_CHUNK = 200;

type StoredCheck = { firm_id: string; url: string; result: SiteResult; checked_at: string };

/** Stored results for these funds, ignoring results for an old website. */
export async function loadSites(
  supabase: ServiceClient,
  firms: Firm[],
): Promise<{ ok: true; sites: Record<string, SiteResult>; checkedAt: Record<string, string> } | { ok: false; error: string }> {
  const byId = new Map(firms.map((firm) => [firm.id, firm]));
  const ids = firms.filter((firm) => firm.web).map((firm) => firm.id);
  const sites: Record<string, SiteResult> = {};
  const checkedAt: Record<string, string> = {};
  const today = new Date().toISOString().slice(0, 10);
  for (const firm of firms) {
    if (!firm.web) sites[firm.id] = { st: "none", why: "No website in database", at: today };
  }
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("match_site_checks")
      .select("firm_id, url, result, checked_at")
      .in("firm_id", ids.slice(i, i + ID_CHUNK));
    if (error) return { ok: false, error: matchTableError(error.message, error.code) };
    for (const row of (data ?? []) as StoredCheck[]) {
      const firm = byId.get(row.firm_id);
      if (!firm || row.url !== firm.web) continue;
      sites[row.firm_id] = row.result;
      checkedAt[row.firm_id] = row.checked_at;
    }
  }
  return { ok: true, sites, checkedAt };
}

/**
 * Checks websites in parallel until the time budget runs out, saving as it
 * goes. Unchecked funds are left for the next run.
 */
export async function checkAndStoreSites(
  supabase: ServiceClient,
  firms: Firm[],
  budgetMs: number,
): Promise<{ ok: true; checked: number; summary: Record<string, number> } | { ok: false; error: string }> {
  const deadline = Date.now() + budgetMs;
  const results: { firm_id: string; url: string; result: SiteResult; checked_at: string }[] = [];
  let next = 0;

  async function worker() {
    while (next < firms.length && Date.now() < deadline) {
      const firm = firms[next++];
      let result: SiteResult;
      try {
        result = await checkSite({ id: firm.id, web: firm.web }, { timeoutMs: SITE_TIMEOUT_MS });
      } catch (err) {
        result = {
          st: "broken",
          why: (err instanceof Error ? err.message : String(err)).slice(0, 80),
          at: new Date().toISOString().slice(0, 10),
        };
      }
      results.push({ firm_id: firm.id, url: firm.web, result, checked_at: new Date().toISOString() });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, firms.length) }, worker));

  for (let i = 0; i < results.length; i += ID_CHUNK) {
    const { error } = await supabase
      .from("match_site_checks")
      .upsert(results.slice(i, i + ID_CHUNK), { onConflict: "firm_id" });
    if (error) return { ok: false, error: matchTableError(error.message, error.code) };
  }

  const summary: Record<string, number> = {};
  for (const item of results) summary[item.result.st] = (summary[item.result.st] ?? 0) + 1;
  return { ok: true, checked: results.length, summary };
}

/** When each fund was last checked (and for which website). */
export async function loadCheckIndex(supabase: ServiceClient) {
  return selectAll<{ firm_id: string; url: string; checked_at: string; status: string }>((from, to) =>
    supabase
      .from("match_site_checks")
      .select("firm_id, url, checked_at, status:result->>st")
      .order("firm_id")
      .range(from, to),
  );
}

/** The funds most in need of a check: never checked, new website, then oldest. */
export function oldestFirst(
  firms: Firm[],
  index: { firm_id: string; url: string; checked_at: string }[],
  limit: number,
) {
  const last = new Map(index.map((row) => [row.firm_id, row]));
  return firms
    .filter((firm) => firm.web)
    .map((firm) => {
      const row = last.get(firm.id);
      const at = row && row.url === firm.web ? Date.parse(row.checked_at) : 0;
      return { firm, at };
    })
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map((item) => item.firm);
}

export function isStale(checkedAt: string | undefined) {
  if (!checkedAt) return true;
  return Date.now() - Date.parse(checkedAt) > SITE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/** The daily job: checks the funds most in need of it within the budget. */
export async function runSiteBatch(supabase: ServiceClient, budgetMs: number) {
  const live = await loadLiveDb(supabase);
  if (!live.ok) return live;
  const index = await loadCheckIndex(supabase);
  if (!index.ok) return index;
  const firms = oldestFirst(live.value.db.firms, index.rows, DAILY_SITE_BATCH);
  return checkAndStoreSites(supabase, firms, budgetMs);
}
