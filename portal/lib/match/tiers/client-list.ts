// The investor list a four-tier run sends to the founder. Pure module.
//
// A list never runs the engine: it is built from the stored rows of one
// saved run's confirmed campaign plan, and records the run's id and rules
// version, so every list sent traces back to the exact results and rules
// behind it. Funds in the four tiers go out, and generalists only when the
// plan approved them (marked `broad`, never as a tier of their own). Unresolved
// and excluded funds, near misses, funds rejected for the client and records
// shown through another record never do.

import type { Firm } from "../engine/index.mjs";
import { firmTypeLabel, stageRange } from "../shared.ts";
import { websiteHref, type FitTier, type InvestorListPayload, type InvestorListSummary, type InvestorRow } from "../../setup.ts";
import { TIER_KEYS, type PersonRecord, type SectorLink, type TierKey } from "./core.ts";
import type { StoredResult } from "./stored.ts";
import { rowKey } from "./record.ts";

/** The investor-list tier of each four-tier tier (1 = best fit). */
export const FOUR_TIER_FIT: Record<TierKey, FitTier> = { core: 1, sphere: 2, tier3: 3, tier4: 4 };

export const CLIENT_LIST_MAX = 3000;

/** Rows in a tier, not rejected for the client, not shown through another record. */
export function listable(row: StoredResult) {
  return row.status === "tiered" && TIER_KEYS.includes(row.tier as TierKey) && !row.detail.representedBy && !row.detail.rejected;
}

/** Rows a list can include: listable ones, and generalists (a plan includes them only when approved). */
export function pushable(row: StoredResult) {
  return listable(row) || (row.status === "generalist" && !row.detail.representedBy && !row.detail.rejected);
}

const emailKey = (email: string) => email.trim().toLowerCase();

/** Investing contacts with an email, once per address (the provider can list one person twice). */
export function reachablePeople(row: StoredResult): PersonRecord[] {
  const seen = new Set<string>();
  const people: PersonRecord[] = [];
  for (const person of (row.detail.people ?? []) as PersonRecord[]) {
    const key = emailKey(person.email ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    people.push(person);
  }
  return people;
}

const HONORIFIC = /^(mr|mrs|ms|miss|mx|dr|prof)\.?\s+/i;

/**
 * Contacts once each, for display: the provider sometimes lists one person
 * twice ("Mr John Smith" and "John Smith"). Same email, or with no email the
 * same name (without an honorific) and title, is the same person.
 */
export function distinctPeople(people: PersonRecord[]): PersonRecord[] {
  const seen = new Set<string>();
  return people.filter((person) => {
    const email = emailKey(person.email ?? "");
    const key = email || `${person.name.replace(HONORIFIC, "").trim().toLowerCase()}|${person.title.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Each Fund Database record by the key its run row is stored under ("id", or "id#2" for a repeat). */
export function firmsByRowKey(firms: Firm[]) {
  const counts = new Map<string, number>();
  const out = new Map<string, Firm>();
  for (const firm of firms) {
    const n = (counts.get(firm.id) ?? 0) + 1;
    counts.set(firm.id, n);
    out.set(rowKey(firm.id, n), firm);
  }
  return out;
}

function hqOf(firm: Firm) {
  return [firm.city, firm.country === "United States" ? firm.state : firm.country].filter(Boolean).join(", ");
}

/** "Invests across United States (…)" or "Invests in Europe, which contains …" → "United States", "Europe". */
function coverage(detail: string) {
  const match = detail.match(/^Invests (?:across|in) (.+?)(?:, which contains .+?)? \("/);
  return match ? match[1] : "";
}

/** Up to 3 chips naming what matched: stage, sector, geography. */
export function reasonsOf(row: StoredResult, firm: Firm, stageLabel: string) {
  const chips: string[] = [];
  const stage = stageRange(firm.stages) || stageLabel;
  if (stage) chips.push(`Stage: ${stage}`);
  const sector = row.detail.sector as SectorLink | undefined;
  if (sector?.firmSectorLabel) chips.push(`Sector: ${sector.firmSectorLabel}`);
  const checks = (row.detail.checks ?? {}) as Record<string, { result: string; detail: string }>;
  const geo = checks.geography?.result === "pass" ? coverage(checks.geography.detail) : "";
  if (geo) chips.push(`Geo: ${geo}`);
  return chips;
}

export type ListRun = { id: string; rulesVersion: string; ranAt: string };

export type ListResult = { ok: true; value: InvestorListPayload } | { ok: false; error: string };

/**
 * The founder's list from the rows of a saved four-tier run (the push passes
 * the plan's rows only): funds, tiers, websites and contact counts, never people. `firms` is the Fund Database version the run
 * used; `checkSizes` the stated check size per FirmID, when a website check found one.
 */
export function fourTierClientList(
  run: ListRun,
  rows: StoredResult[],
  firms: Map<string, Firm>,
  stageLabel: string,
  checkSizes: Record<string, string> = {},
): ListResult {
  const kept = rows.filter(pushable);
  if (kept.length === 0) return { ok: false, error: "No funds in the four tiers to send." };
  if (kept.length > CLIENT_LIST_MAX) {
    return { ok: false, error: `${kept.length.toLocaleString("en-US")} funds is more than the investor list holds (${CLIENT_LIST_MAX.toLocaleString("en-US")}).` };
  }
  const missing = kept.filter((row) => !firms.has(row.firmId));
  if (missing.length > 0) {
    return { ok: false, error: `${missing.length} funds of this run are not in the Fund Database it used. Run the match again.` };
  }

  const listed = kept.map((row) => {
    const firm = firms.get(row.firmId)!;
    const people = reachablePeople(row).length;
    const location = hqOf(firm);
    const reasons = reasonsOf(row, firm, stageLabel);
    const checkSize = (checkSizes[firm.id] ?? "").trim();
    const stages = firm.stages.filter(Boolean).slice(0, 4).join(", ");
    const sectors = Array.from(new Set([...firm.vert, ...firm.ind].filter(Boolean))).slice(0, 4).join(", ");
    const geography = firm.geo.filter(Boolean).slice(0, 4).join(", ");
    const item: InvestorRow = {
      id: row.firmId.trim().slice(0, 200),
      fund_name: firm.name,
      contact: people > 0 ? `${people} investing contact${people === 1 ? "" : "s"} identified` : "Contacts being confirmed",
      contact_count: people,
      details: [firmTypeLabel(firm.type), location, firm.year ? `Founded ${firm.year}` : ""].filter(Boolean).join(" · "),
      fund_type: firmTypeLabel(firm.type),
      location: location || undefined,
      check_size: checkSize || undefined,
      stage_focus: stages || undefined,
      sector_focus: sectors || undefined,
      geography_focus: geography || undefined,
      website: websiteHref(firm.web) || undefined,
      // Generalists use Tier 4's email copy; marked broad, they are counted apart from every tier.
      tier: row.status === "generalist" ? FOUR_TIER_FIT.tier4 : FOUR_TIER_FIT[row.tier as TierKey],
      broad: row.status === "generalist" ? true : undefined,
      why: "",
      reasons: reasons.length > 0 ? reasons : undefined,
      comments: "",
    };
    return item;
  });

  const summary: InvestorListSummary = {
    generated_at: new Date().toISOString(),
    tiers: TIER_KEYS.map((key) => {
      const tier = FOUR_TIER_FIT[key];
      const inTier = listed.filter((item) => item.tier === tier && !item.broad);
      const types = new Map<string, { funds: number; contacts: number }>();
      for (const item of inTier) {
        const label = item.fund_type || "Other";
        const entry = types.get(label) ?? { funds: 0, contacts: 0 };
        entry.funds += 1;
        entry.contacts += item.contact_count ?? 0;
        types.set(label, entry);
      }
      return {
        tier,
        funds: inTier.length,
        contacts: inTier.reduce((sum, item) => sum + (item.contact_count ?? 0), 0),
        by_type: Array.from(types.entries())
          .map(([label, value]) => ({ label, ...value }))
          .sort((a, b) => b.funds - a.funds),
      };
    }),
  };

  return {
    ok: true,
    value: {
      rows: listed,
      source_file: `Rupert Match · four-tier · ${run.ranAt.slice(0, 10)}`,
      summary,
      tier_scheme: "four",
      run_id: run.id,
      rules_version: run.rulesVersion,
    },
  };
}
