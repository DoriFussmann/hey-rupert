// Funds added by Rupert (Step 2D, Try and Add to DB). Pure module: the
// record, choosing contacts from Hunter's people, cleaning the research
// against the taxonomy, and turning an approved fund into a Fund Database
// record. A pending fund is used for the client it was found for only; it
// joins the shared database for every client once an admin approves it.

import type { Contact, Firm } from "../engine/index.mjs";

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
