// Funds added by Rupert (Step 2D, Try and Add to DB). Pure module: the
// record, choosing contacts from Hunter's people, cleaning the research
// against the taxonomy, and turning an approved fund into a Fund Database
// record. A pending fund is used for the client it was found for only; it
// joins the shared database for every client once an admin approves it.

import type { Contact, Firm } from "../engine/index.mjs";
import { findAlias, type FieldKey, type TaxIndex } from "../../taxonomy/core.ts";
import { cleanUrl } from "../landscape/core.ts";
import { domainOf } from "../landscape/check.ts";

export type AddedStatus = "pending" | "approved" | "rejected";

export type AddedContact = {
  first: string;
  last: string;
  title: string;
  email: string;
  /** Hunter's confidence (0–100), when Hunter found the address. */
  confidence: number | null;
  linkedin: string;
  source: "hunter_domain" | "hunter_finder" | "research";
};

export type AddedFund = {
  id: string;
  /** Its id in the Fund Database once merged ("RUP-…"), apart from provider FirmIDs. */
  firmId: string;
  name: string;
  kind: "fund" | "angel";
  status: AddedStatus;
  website: string;
  description: string;
  hqCity: string;
  hqCountry: string;
  foundedYear: number | null;
  /** Taxonomy labels, from research: each needs review until approved. */
  firmType: string;
  stages: string[];
  geographies: string[];
  industries: string[];
  verticals: string[];
  financing: string[];
  contacts: AddedContact[];
  sources: { url: string; label: string }[];
  notes: string;
  foundForClient: string | null;
  landscapeId: string | null;
  investorId: string | null;
  createdBy: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string;
};

export const MAX_ADDED_CONTACTS = 5;

/** The engine's role ranking: decision makers and deal champions first; operations and advisors never. */
export type RoleOf = (title: string) => string;
const ROLE_ORDER = ["decision", "champion", "scout", "other"];

/** Up to 5 investing people, best first: role, then Hunter's confidence. Non-investing roles are skipped. */
export function pickContacts<T extends { position: string; confidence: number | null; email: string }>(people: T[], roleOf: RoleOf, max = MAX_ADDED_CONTACTS): T[] {
  const seen = new Set<string>();
  return people
    .filter((p) => {
      const key = p.email.toLowerCase();
      if (!p.email || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({ p, rank: ROLE_ORDER.indexOf(roleOf(p.position || "")) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || (b.p.confidence ?? 0) - (a.p.confidence ?? 0))
    .slice(0, max)
    .map((x) => x.p);
}

/** Keeps only labels the taxonomy has (any case), spelled as the taxonomy spells them. */
export function onlyLabels(values: unknown, allowed: string[], max = 20): string[] {
  const map = new Map(allowed.map((l) => [l.toLowerCase(), l]));
  const list = Array.isArray(values) ? values : [];
  return Array.from(new Set(list.map((v) => map.get(String(v).trim().toLowerCase())).filter((v): v is string => !!v))).slice(0, max);
}

/** Splits "Jane van der Berg" into first and last name. */
export function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * An approved fund as a Fund Database record. Each taxonomy label is written
 * as a raw value the taxonomy already maps to it (`rawFor`), so the fund is
 * classified exactly like a provider record.
 */
export function toFirm(fund: AddedFund, rawFor: (field: string, label: string) => string): Firm {
  const raw = (field: string, labels: string[]) => labels.map((l) => rawFor(field, l));
  return {
    id: fund.firmId,
    name: fund.name,
    type: fund.firmType ? rawFor("firm_type", fund.firmType) : "",
    region: "",
    year: fund.foundedYear,
    stages: raw("stage", fund.stages),
    fin: raw("financing", fund.financing.length ? fund.financing : ["Equity"]),
    ind: raw("industry", fund.industries),
    vert: raw("vertical", fund.verticals),
    geo: raw("geography", fund.geographies),
    city: fund.hqCity,
    state: "",
    country: fund.hqCountry ? rawFor("hq_country", fund.hqCountry) : "",
    web: fund.website,
    email: "",
    phone: "",
    nContacts: fund.contacts.length,
    offices: [],
  };
}

export function toContacts(fund: AddedFund): Contact[] {
  return fund.contacts
    .filter((c) => c.email)
    .map((c) => ({
      fid: fund.firmId,
      first: c.first,
      last: c.last,
      prefix: "",
      title: c.title,
      email: c.email,
      phone: "",
      city: fund.hqCity,
      state: "",
      country: fund.hqCountry,
      officeType: "",
      principal: false,
      lead: false,
      matchQ: "added by Rupert",
    }));
}

/**
 * Websites that are never a fund's own: profiles and listings on other
 * platforms. A fund "website" on one of these would send Hunter to the
 * platform's own staff and, once approved, match every investor whose
 * website is any page there.
 */
const NOT_A_FUND_SITE = [
  "linkedin.com",
  "crunchbase.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "angel.co",
  "wellfound.com",
  "pitchbook.com",
  "cbinsights.com",
  "tracxn.com",
  "dealroom.co",
  "medium.com",
  "substack.com",
  "github.com",
  "youtube.com",
  "gmail.com",
  "google.com",
  "wikipedia.org",
  "bloomberg.com",
  "techcrunch.com",
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
  "signal.nfx.com",
  "nfx.com",
  "f6s.com",
  "golden.com",
  "zoominfo.com",
  "apollo.io",
  "rocketreach.co",
];

/** A usable fund website: a real address, not a profile on another platform. */
export function ownSite(url: string): string {
  const clean = cleanUrl(url);
  if (!clean) return "";
  const domain = domainOf(clean);
  return NOT_A_FUND_SITE.some((d) => domain === d || domain.endsWith(`.${d}`)) ? "" : clean;
}

const FIELD_DIMENSION: Record<string, string> = {
  stage: "stage",
  geography: "geography",
  industry: "sector",
  vertical: "sector",
  financing: "financing",
  firm_type: "firm_type",
  hq_country: "geography",
};

const FIELD_KINDS: Record<string, string[] | null> = {
  stage: ["stage"],
  geography: ["region", "subregion", "country", "us_region"],
  industry: ["sector"],
  vertical: ["sector"],
  financing: null,
  firm_type: null,
  hq_country: ["country"],
};

/**
 * A raw value the taxonomy already maps (approved) to exactly this label's
 * category in this field, so an approved fund is classified like a provider
 * record: the label itself when it is such a value, else an alias mapping
 * only to that category, else any approved alias including it; the label
 * when there is none (it then shows as unmapped in the taxonomy).
 */
export function rawForFn(index: TaxIndex) {
  const cache = new Map<string, string>();
  return (field: string, label: string) => {
    const key = `${field}|${label}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const dimension = FIELD_DIMENSION[field];
    const kinds = FIELD_KINDS[field];
    const node = Array.from(index.nodes.values()).find(
      (n) => n.status === "active" && n.dimension === dimension && (!kinds || kinds.includes(n.kind)) && n.label.toLowerCase() === label.toLowerCase(),
    );
    let raw = label;
    if (node) {
      const approved = (a: { state: string; review: string }) => a.state === "mapped" && a.review === "approved";
      const own = findAlias(index, field as FieldKey, label);
      if (own && approved(own) && own.nodeIds.length === 1 && own.nodeIds[0] === node.id) raw = own.rawValue;
      else {
        const aliases = index.taxonomy.aliases.filter((a) => a.field === field && approved(a) && a.nodeIds.includes(node.id));
        raw = (aliases.find((a) => a.nodeIds.length === 1) ?? aliases[0])?.rawValue ?? label;
      }
    }
    cache.set(key, raw);
    return raw;
  };
}

