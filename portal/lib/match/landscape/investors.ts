// Step 2B: the investors behind the confirmed competitors. Pure module: the
// investor record, merging one competitor's findings into the list, and
// cleaning what the AI or the admin sends.

import { cleanUrl } from "./core.ts";

export const INVESTOR_KINDS = ["fund", "angel", "corporate", "accelerator", "other"] as const;
export type InvestorKind = (typeof INVESTOR_KINDS)[number];

export const KIND_LABEL: Record<InvestorKind, string> = {
  fund: "Fund",
  angel: "Angel",
  corporate: "Corporate",
  accelerator: "Accelerator",
  other: "Other",
};

/** One competitor this investor backed, and how we know. */
export type Backing = {
  competitorId: string;
  competitor: string;
  round: string;
  lead: boolean;
  sourceUrl: string;
};

export type Investor = {
  id: string;
  name: string;
  website: string;
  kind: InvestorKind;
  backed: Backing[];
  /** "research": found by the per-competitor search. "step2a": named in the competitor's funding article. "admin": added by hand. */
  source: "research" | "step2a" | "admin";
};

/** Per competitor: whether its investors have been researched. */
export type ResearchState = { status: "done" | "failed"; at: string; found: number; error?: string };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const SUFFIXES = /\b(ventures?|capital|partners|vc|fund|funds|management|group|holdings|investments?|llc|inc|lp|ltd|co)\b/g;

/** Key for "the same investor": lowercase, no punctuation, common suffixes dropped (Insight Partners = Insight). */
export function investorKey(name: string) {
  const base = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ");
  const stripped = base.replace(SUFFIXES, " ").replace(/\s+/g, "");
  return stripped || base.replace(/\s+/g, "");
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanBacking(value: unknown): Backing | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const competitorId = text(v.competitorId, 64);
  const competitor = text(v.competitor, 120);
  if (!competitorId || !competitor) return null;
  return { competitorId, competitor, round: text(v.round, 80), lead: v.lead === true, sourceUrl: cleanUrl(v.sourceUrl) };
}

export function cleanInvestor(value: unknown, fallbackId: string): Investor | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const name = text(v.name, 120);
  if (!name) return null;
  const kind = INVESTOR_KINDS.includes(v.kind as InvestorKind) ? (v.kind as InvestorKind) : "fund";
  const backed = Array.isArray(v.backed) ? v.backed.map(cleanBacking).filter((b): b is Backing => !!b) : [];
  return {
    id: text(v.id, 64) || fallbackId,
    name,
    website: cleanUrl(v.website),
    kind,
    backed,
    source: v.source === "research" || v.source === "admin" ? v.source : "step2a",
  };
}

function sameInvestor(a: Investor, b: Investor) {
  if (investorKey(a.name) === investorKey(b.name)) return true;
  const da = domainOf(a.website);
  return !!da && da === domainOf(b.website);
}

/** Adds one investor to the list: merged into an existing one (same name or website), or appended. */
export function mergeInvestor(list: Investor[], incoming: Investor): Investor[] {
  const at = list.findIndex((x) => sameInvestor(x, incoming));
  if (at < 0) return [...list, incoming];
  const current = list[at];
  const backed = [...current.backed];
  for (const b of incoming.backed) {
    const i = backed.findIndex((x) => x.competitorId === b.competitorId && (x.round === b.round || !x.round || !b.round));
    if (i < 0) backed.push(b);
    else
      backed[i] = {
        ...backed[i],
        round: backed[i].round || b.round,
        lead: backed[i].lead || b.lead,
        sourceUrl: backed[i].sourceUrl || b.sourceUrl,
      };
  }
  const merged: Investor = {
    ...current,
    // The longer name is usually the full one ("Insight Partners" over "Insight").
    name: incoming.name.length > current.name.length ? incoming.name : current.name,
    website: current.website || incoming.website,
    kind: current.kind === "fund" ? current.kind : incoming.kind,
    backed,
    source: current.source === "research" || incoming.source === "research" ? "research" : current.source,
  };
  return list.map((x, i) => (i === at ? merged : x));
}

/** Order: most competitors backed first, then leads, then by name. */
export function orderInvestors(list: Investor[]): Investor[] {
  const competitors = (x: Investor) => new Set(x.backed.map((b) => b.competitorId)).size;
  const leads = (x: Investor) => x.backed.filter((b) => b.lead).length;
  return [...list].sort((a, b) => competitors(b) - competitors(a) || leads(b) - leads(a) || a.name.localeCompare(b.name));
}

/** Cleans a whole list (from storage or the admin) and merges duplicates. */
export function cleanInvestorList(items: unknown[], makeId: (i: number) => string): Investor[] {
  let list: Investor[] = [];
  items.forEach((item, i) => {
    const inv = cleanInvestor(item, makeId(i));
    if (inv) list = mergeInvestor(list, inv);
  });
  return orderInvestors(list);
}
