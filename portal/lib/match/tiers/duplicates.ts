// Likely duplicate firms in the Fund Database. Read-only: this finds and
// grades candidate groups for review. It never merges, hides or changes a
// record, and nothing it returns is stored.

import type { Firm, FundDb } from "../engine/index.mjs";
import { findAlias, rawKey, type TaxIndex } from "../../taxonomy/core.ts";
import type { DuplicateFlag } from "./core.ts";

export const DUPLICATE_LEVELS = ["same_id", "certain", "likely", "ambiguous"] as const;
export type DuplicateLevel = (typeof DUPLICATE_LEVELS)[number];

export const DUPLICATE_LEVEL_INFO: Record<DuplicateLevel, { label: string; rule: string; proposal: string }> = {
  same_id: {
    label: "Same provider ID",
    rule: "The same FirmID appears more than once in the Fund Database.",
    proposal: "Treat as one firm (certain).",
  },
  certain: {
    label: "Certain",
    rule: "Same normalized name, same website domain and same HQ country.",
    proposal: "Shown once per list after an admin confirms the group.",
  },
  likely: {
    label: "Likely",
    rule: "Same website domain and HQ country, different names (may be sister funds).",
    proposal: "Review: an admin confirms or rejects each group.",
  },
  ambiguous: {
    label: "Ambiguous",
    rule: "Same normalized name, but a different or missing website domain, or a different HQ country.",
    proposal: "Review: an admin confirms or rejects each group.",
  },
};

export type DuplicateMember = {
  id: string;
  name: string;
  website: string;
  domain: string;
  location: string;
  country: string;
  type: string;
  contacts: number;
  /** Contacts with a stored verification result, by status. */
  verified: Record<string, number>;
};

export type DuplicateGroup = {
  key: string;
  level: DuplicateLevel;
  /** What the members share, in plain words. */
  shared: string;
  members: DuplicateMember[];
};

export type DuplicateReport = {
  firms: number;
  groups: DuplicateGroup[];
  counts: Record<DuplicateLevel, { groups: number; firms: number }>;
  /** Groups whose member names mention a watched name (e.g. Willow Growth Partners). */
  watched: { name: string; groups: DuplicateGroup[] }[];
};

const LEGAL_SUFFIXES = new Set([
  "llc", "l.l.c", "lp", "l.p", "llp", "inc", "incorporated", "ltd", "limited", "co", "corp",
  "corporation", "gmbh", "ag", "sa", "sarl", "bv", "plc", "pte", "pty",
]);

/** Name for comparison: rawKey, no punctuation, no trailing legal suffixes. */
export function normalizedName(name: string) {
  const words = rawKey(name)
    .replace(/&/g, " and ")
    .replace(/[!"#$%'()*+,/:;<=>?@[\\\]^_`{|}~-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/\.+$/, ""))
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

export function websiteDomain(website: string) {
  return website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

function countryKey(index: TaxIndex | null, firm: Firm) {
  if (!firm.country) return "";
  const alias = index ? findAlias(index, "hq_country", firm.country) : null;
  return alias && alias.nodeIds.length ? alias.nodeIds.join(",") : rawKey(firm.country);
}

function groupBy(firms: Firm[], keyOf: (firm: Firm) => string) {
  const groups = new Map<string, Firm[]>();
  for (const firm of firms) {
    const key = keyOf(firm);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), firm]);
  }
  return Array.from(groups.entries()).filter(([, list]) => list.length > 1);
}

export function findDuplicates(
  db: FundDb,
  index: TaxIndex | null,
  verifiedByFirm: Map<string, Record<string, number>> = new Map(),
  watchNames: string[] = ["Willow Growth Partners"],
): DuplicateReport {
  const contacts = new Map<string, number>();
  for (const contact of db.contacts) contacts.set(contact.fid, (contacts.get(contact.fid) ?? 0) + 1);
  const member = (firm: Firm): DuplicateMember => ({
    id: firm.id,
    name: firm.name,
    website: firm.web,
    domain: websiteDomain(firm.web),
    location: [firm.city, firm.state, firm.country].filter(Boolean).join(", "),
    country: firm.country,
    type: firm.type,
    contacts: contacts.get(firm.id) ?? 0,
    verified: verifiedByFirm.get(firm.id) ?? {},
  });
  const sortMembers = (list: Firm[]) =>
    list.map(member).sort((a, b) => b.contacts - a.contacts || a.id.localeCompare(b.id));

  const groups: DuplicateGroup[] = [];

  // Same provider ID.
  for (const [id, list] of groupBy(db.firms, (firm) => firm.id)) {
    groups.push({ key: `id:${id}`, level: "same_id", shared: `FirmID ${id}`, members: sortMembers(list) });
  }

  // One row per FirmID from here on.
  const seen = new Set<string>();
  const unique = db.firms.filter((firm) => (seen.has(firm.id) ? false : (seen.add(firm.id), true)));
  const nameOf = new Map(unique.map((firm) => [firm.id, normalizedName(firm.name)]));
  const domainOf = new Map(unique.map((firm) => [firm.id, websiteDomain(firm.web)]));
  const countryOf = new Map(unique.map((firm) => [firm.id, countryKey(index, firm)]));

  // Certain: name + domain + country.
  const certainIds = new Set<string>();
  for (const [key, list] of groupBy(unique, (firm) =>
    nameOf.get(firm.id) && domainOf.get(firm.id) && countryOf.get(firm.id)
      ? `${nameOf.get(firm.id)}|${domainOf.get(firm.id)}|${countryOf.get(firm.id)}`
      : "",
  )) {
    list.forEach((firm) => certainIds.add(firm.id));
    groups.push({
      key: `certain:${key}`,
      level: "certain",
      shared: `Name "${list[0].name}", website ${domainOf.get(list[0].id)}, country ${list[0].country}`,
      members: sortMembers(list),
    });
  }

  // Likely: domain + country, with more than one name.
  for (const [key, list] of groupBy(unique, (firm) =>
    domainOf.get(firm.id) && countryOf.get(firm.id) ? `${domainOf.get(firm.id)}|${countryOf.get(firm.id)}` : "",
  )) {
    const names = new Set(list.map((firm) => nameOf.get(firm.id)));
    if (names.size < 2) continue;
    groups.push({
      key: `likely:${key}`,
      level: "likely",
      shared: `Website ${domainOf.get(list[0].id)}, country ${list[0].country}; ${names.size} different names`,
      members: sortMembers(list),
    });
  }

  // Ambiguous: same name, not all sharing domain and country.
  for (const [key, list] of groupBy(unique, (firm) => nameOf.get(firm.id) ?? "")) {
    const signatures = new Set(list.map((firm) => `${domainOf.get(firm.id)}|${countryOf.get(firm.id)}`));
    const allCertain = list.every((firm) => certainIds.has(firm.id)) && signatures.size === 1;
    if (allCertain) continue;
    if (signatures.size === 1 && domainOf.get(list[0].id) && countryOf.get(list[0].id)) continue;
    const domains = new Set(list.map((firm) => domainOf.get(firm.id) || "(no website)"));
    const countries = new Set(list.map((firm) => firm.country || "(no country)"));
    groups.push({
      key: `ambiguous:${key}`,
      level: "ambiguous",
      shared: `Name "${list[0].name}"; websites: ${Array.from(domains).join(", ")}; countries: ${Array.from(countries).join(", ")}`,
      members: sortMembers(list),
    });
  }

  groups.sort(
    (a, b) =>
      DUPLICATE_LEVELS.indexOf(a.level) - DUPLICATE_LEVELS.indexOf(b.level) ||
      b.members.length - a.members.length ||
      a.key.localeCompare(b.key),
  );

  const counts = Object.fromEntries(
    DUPLICATE_LEVELS.map((level) => {
      const inLevel = groups.filter((group) => group.level === level);
      const firms = new Set(inLevel.flatMap((group) => group.members.map((m) => m.id)));
      return [level, { groups: inLevel.length, firms: firms.size }];
    }),
  ) as DuplicateReport["counts"];

  const watched = watchNames.map((name) => {
    const target = normalizedName(name);
    return {
      name,
      groups: groups.filter((group) => group.members.some((m) => normalizedName(m.name).includes(target))),
    };
  });

  return { firms: db.firms.length, groups, counts, watched };
}

/** Per firm: its strongest duplicate group, to flag in match results (nothing is merged). */
export function duplicateFlags(report: DuplicateReport) {
  const flags = new Map<string, DuplicateFlag>();
  for (const group of report.groups) {
    for (const m of group.members) {
      if (flags.has(m.id)) continue;
      flags.set(m.id, {
        groupKey: group.key,
        level: DUPLICATE_LEVEL_INFO[group.level].label,
        otherIds: group.members.filter((other) => other.id !== m.id).map((other) => other.id),
      });
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Identity proposals and decisions (Sprint 3B)

export type IdentityKind = "duplicate" | "offices";

export type IdentityProposal = {
  key: string;
  level: DuplicateLevel;
  /** "offices": same name and website, different HQ country. Everything else is a possible duplicate. */
  kind: IdentityKind;
  /** Offices apply unless an admin rejects them; duplicates only once an admin confirms them. */
  auto: boolean;
  shared: string;
  members: DuplicateMember[];
};

export type IdentityDecision = {
  groupKey: string;
  kind: IdentityKind;
  status: "confirmed" | "rejected";
  memberIds: string[];
  note: string;
  decidedBy: string | null;
  decidedAt: string | null;
};

export type ResolvedIdentity = IdentityProposal & {
  decision: IdentityDecision | null;
  /** The decision was made for a different set of records: it needs a new decision. */
  stale: boolean;
  applied: boolean;
};

/** Same name, one website, more than one HQ country. */
export function isOfficeGroup(group: DuplicateGroup) {
  if (group.level !== "ambiguous") return false;
  const domains = new Set(group.members.map((m) => m.domain));
  const countries = new Set(group.members.map((m) => m.country));
  return domains.size === 1 && !domains.has("") && countries.size > 1;
}

export function identityProposals(report: DuplicateReport): IdentityProposal[] {
  return report.groups.map((group) => {
    const offices = isOfficeGroup(group);
    return {
      key: group.key,
      level: group.level,
      kind: offices ? "offices" : "duplicate",
      auto: offices,
      shared: group.shared,
      members: group.members,
    };
  });
}

function sameMembers(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

/** Which groups apply to a run, given the admin decisions. */
export function resolveIdentities(proposals: IdentityProposal[], decisions: IdentityDecision[]): ResolvedIdentity[] {
  const byKey = new Map(decisions.map((d) => [d.groupKey, d]));
  return proposals.map((proposal) => {
    const decision = byKey.get(proposal.key) ?? null;
    const stale = !!decision && !sameMembers(decision.memberIds, proposal.members.map((m) => m.id));
    const applied = stale
      ? false
      : decision
        ? decision.status === "confirmed"
        : proposal.auto;
    return { ...proposal, decision, stale, applied };
  });
}

/** The applied groups, as the engine takes them. A record joins at most one group: the first applied. */
export function appliedGroups(resolved: ResolvedIdentity[]) {
  const used = new Set<string>();
  const groups: {
    key: string;
    kind: IdentityKind;
    level: string;
    memberIds: string[];
    status: "confirmed" | "auto";
    decidedBy: string | null;
    decidedAt: string | null;
  }[] = [];
  for (const r of resolved) {
    if (!r.applied) continue;
    const ids = r.members.map((m) => m.id);
    if (ids.some((id) => used.has(id))) continue;
    ids.forEach((id) => used.add(id));
    groups.push({
      key: r.key,
      kind: r.decision?.kind ?? r.kind,
      level: DUPLICATE_LEVEL_INFO[r.level].label,
      memberIds: ids,
      status: r.decision ? "confirmed" : "auto",
      decidedBy: r.decision?.decidedBy ?? null,
      decidedAt: r.decision?.decidedAt ?? null,
    });
  }
  return groups;
}
