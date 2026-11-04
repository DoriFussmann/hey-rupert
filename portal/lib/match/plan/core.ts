// Step 4: The Plan. Pure module: tiers the confirmed Final Roster by the
// client's sub-sectors, ranks each tier, works out how many contacts the
// campaign can reach, and fills that budget tier by tier (the waterfall).
// Runs in the browser while the inputs change, and on the server on Confirm.
//
// Words: Sector = the taxonomy's group (Financial services). Sub-sector =
// every sector node under it, broad (Financial Services) or specific (Fintech).

import type { TaxIndex } from "../../taxonomy/core.ts";
import { groupOf } from "../dry/core.ts";
import { lookAlikeScore, type ProfileEntry } from "../landscape/lookalike.ts";
import { campaignDays, inputProblems as scheduleProblems, schedule, type CapacityInputs } from "../capacity/schedule.ts";

export const PLAN_TIERS = ["core", "sphere", "tier3", "tier4"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];
/** outside: same sector, other sub-sectors only. none: nothing the tiers look at (e.g. no sub-sector listed). */
export type Placement = PlanTier | "outside" | "none";

export const TIER_LABEL: Record<Placement, string> = {
  core: "Core",
  sphere: "Sphere",
  tier3: "Tier 3",
  tier4: "Tier 4",
  outside: "Same sector, other sub-sectors",
  none: "Not placed",
};

export const TIER_RULE: Record<PlanTier, string> = {
  core: "Lists the primary sub-sector.",
  sphere: "Not Core; lists Secondary sub-sector 1.",
  tier3: "Not Core or Sphere; lists Secondary sub-sector 2.",
  tier4: "Lists only a broader level above the primary sub-sector.",
};

// ---------------------------------------------------------------------------
// The client's sub-sectors and what each one covers

const isBroad = (index: TaxIndex, id: string) => index.nodes.get(id)?.attrs.granularity === "broad";

/** Sector-node ancestors through parentId (groups excluded). */
function parentsOf(index: TaxIndex, id: string): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  let node = index.nodes.get(id);
  while (node?.parentId && !seen.has(node.parentId)) {
    const parent = index.nodes.get(node.parentId);
    if (!parent || parent.kind === "group") break;
    out.push(parent.id);
    seen.add(parent.id);
    node = parent;
  }
  return out;
}

/**
 * The broad sub-sectors directly above a specific one, in the same sector:
 * a "broad" relationship (not rejected) from a specific to a broad node, e.g.
 * Fintech → Financial Services. Fintech → Software is another sector, so not above it.
 */
function broadAbove(index: TaxIndex, id: string): string[] {
  if (isBroad(index, id)) return [];
  const group = groupOf(index, id);
  return (index.edgesByNode.get(id) ?? [])
    .filter((e) => e.relation === "broad")
    .map((e) => (e.fromId === id ? e.toId : e.fromId))
    .filter((other) => isBroad(index, other) && groupOf(index, other) === group && index.nodes.get(other)?.status === "active");
}

/** Everything above a sub-sector in its sector: parents, and the broad sub-sectors above it. */
export function above(index: TaxIndex, id: string): Set<string> {
  const out = new Set<string>();
  for (const x of [id, ...parentsOf(index, id)]) {
    if (x !== id) out.add(x);
    broadAbove(index, x).forEach((b) => {
      out.add(b);
      parentsOf(index, b).forEach((p) => out.add(p));
    });
  }
  out.delete(id);
  return out;
}

/** A sub-sector and every one under it (a match on it counts them all). */
export function covered(index: TaxIndex, id: string): Set<string> {
  const out = new Set([id]);
  for (const node of Array.from(index.nodes.values())) {
    if (node.dimension !== "sector" || node.status !== "active" || node.kind === "group") continue;
    if (above(index, node.id).has(id)) out.add(node.id);
  }
  return out;
}

export type ClientSubSectors = {
  primary: string | null;
  secondary1: string | null;
  secondary2: string | null;
};

export type TierKeys = {
  core: Set<string>;
  sphere: Set<string>;
  tier3: Set<string>;
  tier4: Set<string>;
  /** The primary's sector (group). */
  group: string | null;
};

export function tierKeys(index: TaxIndex, client: ClientSubSectors): TierKeys {
  const cover = (id: string | null) => (id && index.nodes.has(id) ? covered(index, id) : new Set<string>());
  const core = cover(client.primary);
  const tier4 = client.primary && index.nodes.has(client.primary) ? above(index, client.primary) : new Set<string>();
  core.forEach((id) => tier4.delete(id));
  return {
    core,
    sphere: cover(client.secondary1),
    tier3: cover(client.secondary2),
    tier4,
    group: client.primary ? groupOf(index, client.primary) : null,
  };
}

/** Where one fund goes, by the sub-sectors it lists. */
export function placeFund(index: TaxIndex, keys: TierKeys, sectors: string[]): { tier: Placement; hit: string[] } {
  const hits = (set: Set<string>) => sectors.filter((s) => set.has(s));
  for (const tier of PLAN_TIERS) {
    const hit = hits(keys[tier]);
    if (hit.length) return { tier, hit };
  }
  if (keys.group && sectors.some((s) => groupOf(index, s) === keys.group)) return { tier: "outside", hit: [] };
  return { tier: "none", hit: [] };
}

// ---------------------------------------------------------------------------
// Ranking inside each tier

const EARLY_STAGES = ["pre-seed", "seed"];

/** Two stage names are the same stage (Pre-Seed and Seed are one). Empty never matches. */
export function sameStage(a: string, b: string) {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || (EARLY_STAGES.includes(x) && EARLY_STAGES.includes(y));
}

/** Fewer same-stage backers than this in the database: the look-alike profile uses every backer instead. */
export const SAME_STAGE_SEEDS_MIN = 3;

export type PlanFund = {
  firmId: string;
  name: string;
  website: string;
  /** Step 3's source. */
  source: string;
  tier: Placement;
  /** The sub-sector labels that placed it. */
  hit: string[];
  /** Competitors it backed (2B). */
  backed: string[];
  /** Of those, the ones it backed at the client's stage (Pre-Seed and Seed count as one). */
  sameStage: string[];
  /** Cosine similarity to the competitors' investors' sector profile, 0–1. */
  lookAlike: number;
  /** Sub-sectors listed: fewer ranks higher. */
  focus: number;
  /** Usable contacts (email on file, not ops or advisor), before the cap. */
  contacts: number;
  /** Position inside its tier, from 1. 0: not ranked (no contact, or outside the tiers). */
  rank: number;
};

export type RankInput = {
  firmId: string;
  name: string;
  website: string;
  source: string;
  backed: string[];
  sameStage: string[];
  /** Sector node ids. */
  sectors: string[];
  contacts: number;
};

/**
 * The 4B order: backed a competitor at the client's stage, then backed one at
 * another stage, then look-alike, focus, contacts (2 before 1), then name.
 */
export function compareFunds(a: PlanFund, b: PlanFund, cap: number) {
  const reach = (f: PlanFund) => Math.min(f.contacts, cap);
  return (
    Number(b.sameStage.length > 0) - Number(a.sameStage.length > 0) ||
    Number(b.backed.length > 0) - Number(a.backed.length > 0) ||
    b.lookAlike - a.lookAlike ||
    a.focus - b.focus ||
    reach(b) - reach(a) ||
    a.name.localeCompare(b.name)
  );
}

/** Tiers and ranks the Roster. Contacts are counted, not capped: the cap is an input. */
export function tierRoster(index: TaxIndex, client: ClientSubSectors, funds: RankInput[], profile: ProfileEntry[], cap = 2): PlanFund[] {
  const keys = tierKeys(index, client);
  const label = (id: string) => index.nodes.get(id)?.label ?? id;
  const out = funds.map((f): PlanFund => {
    const placed = placeFund(index, keys, f.sectors);
    const labels = f.sectors.map(label);
    return {
      firmId: f.firmId,
      name: f.name,
      website: f.website,
      source: f.source,
      tier: placed.tier,
      hit: placed.hit.map(label),
      backed: f.backed,
      sameStage: f.sameStage,
      lookAlike: lookAlikeScore(labels, profile).score,
      focus: new Set(f.sectors).size,
      contacts: f.contacts,
      rank: 0,
    };
  });
  return rankFunds(out, cap);
}

/** Sorts by tier then the 4B order, and numbers each tier's reachable funds. */
export function rankFunds(funds: PlanFund[], cap: number): PlanFund[] {
  const order: Record<Placement, number> = { core: 0, sphere: 1, tier3: 2, tier4: 3, outside: 4, none: 5 };
  const sorted = [...funds].sort(
    (a, b) => order[a.tier] - order[b.tier] || Number(b.contacts > 0) - Number(a.contacts > 0) || compareFunds(a, b, cap),
  );
  const next: Record<string, number> = {};
  return sorted.map((f) => {
    const ranked = (PLAN_TIERS as readonly string[]).includes(f.tier) && f.contacts > 0;
    if (!ranked) return { ...f, rank: 0 };
    next[f.tier] = (next[f.tier] ?? 0) + 1;
    return { ...f, rank: next[f.tier] };
  });
}

// ---------------------------------------------------------------------------
// Capacity (4C)

export type PlanInputs = {
  inboxes: number;
  emailsPerInboxPerDay: number;
  sendingDaysPerWeek: number;
  warmupWeeks: number;
  /** One percentage for the whole warm-up period. */
  warmupPercent: number;
  /** Follow-ups per contact (1 = two emails). */
  followUps: number;
  /** Calendar days between one email and the next. */
  followUpDelayDays: number;
  /** Contacts emailed per fund, at most. */
  contactsPerFund: number;
  months: number;
};

export const PLAN_DEFAULTS: PlanInputs = {
  inboxes: 1,
  emailsPerInboxPerDay: 30,
  sendingDaysPerWeek: 5,
  warmupWeeks: 2,
  warmupPercent: 50,
  followUps: 1,
  followUpDelayDays: 7,
  contactsPerFund: 2,
  months: 2,
};

export const PLAN_LIMITS: Record<keyof PlanInputs, { min: number; max: number; label: string; hint?: string }> = {
  inboxes: { min: 1, max: 100, label: "Inboxes" },
  emailsPerInboxPerDay: { min: 1, max: 30, label: "Emails per inbox per day", hint: "Follow-ups included. At most 30." },
  sendingDaysPerWeek: { min: 1, max: 7, label: "Sending days per week", hint: "5 = Monday to Friday." },
  warmupWeeks: { min: 0, max: 12, label: "Warm-up weeks" },
  warmupPercent: { min: 0, max: 100, label: "Warm-up capacity (%)", hint: "One percentage for the whole warm-up." },
  followUps: { min: 0, max: 5, label: "Follow-ups per contact", hint: "1 = two emails." },
  followUpDelayDays: { min: 1, max: 30, label: "Days between email and follow-up", hint: "Calendar days. 7 = 5 working days." },
  contactsPerFund: { min: 1, max: 5, label: "Contacts per fund (cap)" },
  months: { min: 1, max: 12, label: "Campaign length (months)" },
};

export const PLAN_INPUT_KEYS = Object.keys(PLAN_LIMITS) as (keyof PlanInputs)[];

/** The schedule's inputs: every contact is its own sequence. */
function asSchedule(inputs: PlanInputs): CapacityInputs {
  return {
    inboxes: inputs.inboxes,
    emailsPerInboxPerDay: inputs.emailsPerInboxPerDay,
    warmupWeeks: inputs.warmupWeeks,
    warmupPercent: inputs.warmupPercent,
    sendingDaysPerWeek: inputs.sendingDaysPerWeek,
    months: inputs.months,
    contactsPerFirm: 1,
    followUps: inputs.followUps,
    followUpDelayDays: inputs.followUpDelayDays,
  };
}

export function planInputProblems(inputs: PlanInputs): string[] {
  const problems: string[] = [];
  for (const key of PLAN_INPUT_KEYS) {
    const { min, max, label } = PLAN_LIMITS[key];
    const v = inputs[key];
    if (typeof v !== "number" || !Number.isFinite(v)) problems.push(`${label}: enter a number.`);
    else if (!Number.isInteger(v)) problems.push(`${label}: a whole number.`);
    else if (v < min || v > max) problems.push(`${label}: between ${min} and ${max}.`);
  }
  if (problems.length) return problems;
  return scheduleProblems(asSchedule(inputs));
}

export type PlanCapacity = {
  /** The contacts the campaign can reach: every one gets its full sequence. */
  contacts: number;
  emailsPerContact: number;
  /** Every email the inboxes can send. */
  sends: number;
  scheduled: number;
  dailyNormal: number;
  dailyWarmup: number;
  days: number;
  notes: string[];
};

export function planCapacity(inputs: PlanInputs): PlanCapacity {
  const problems = planInputProblems(inputs);
  if (problems.length) throw new Error(problems.join(" "));
  const r = schedule(asSchedule(inputs), Number.POSITIVE_INFINITY, { flatWarmup: true });
  return {
    contacts: r.contactsReached,
    emailsPerContact: 1 + inputs.followUps,
    sends: r.capacity,
    scheduled: r.scheduled,
    dailyNormal: r.dailyNormal,
    dailyWarmup: r.dailyWarmup,
    days: campaignDays(inputs.months),
    notes: r.bottlenecks.filter((b) => !b.startsWith("Dividing capacity")).map((b) => b.replace(/firms/g, "contacts").replace(/firm/g, "contact")),
  };
}

// ---------------------------------------------------------------------------
// The waterfall: Core in full, then Sphere, Tier 3, Tier 4, in rank order

export type Planned = { firmId: string; tier: PlanTier; rank: number; slots: number };

export type TierRow = {
  tier: PlanTier;
  /** Ranked funds in the tier (with a contact). */
  funds: number;
  /** Their contacts, capped. */
  contacts: number;
  plannedFunds: number;
  plannedContacts: number;
  /** Funds in the tier with no contact (not used). */
  noContact: number;
};

export type Waterfall = {
  budget: number;
  planned: Planned[];
  rows: TierRow[];
  plannedFunds: number;
  plannedContacts: number;
  /** Budget the Roster can't use (every tier filled). */
  unused: number;
  /** The last fund taken got fewer contacts than it has, to fit the budget. */
  partial: string | null;
};

export function waterfall(funds: PlanFund[], budget: number, cap: number): Waterfall {
  let left = Math.max(0, budget);
  const planned: Planned[] = [];
  let partial: string | null = null;
  const rows: TierRow[] = PLAN_TIERS.map((tier) => {
    const inTier = funds.filter((f) => f.tier === tier);
    const ranked = inTier.filter((f) => f.rank > 0).sort((a, b) => a.rank - b.rank);
    const row: TierRow = {
      tier,
      funds: ranked.length,
      contacts: ranked.reduce((sum, f) => sum + Math.min(f.contacts, cap), 0),
      plannedFunds: 0,
      plannedContacts: 0,
      noContact: inTier.filter((f) => f.contacts === 0).length,
    };
    for (const f of ranked) {
      if (left <= 0) break;
      const want = Math.min(f.contacts, cap);
      const slots = Math.min(want, left);
      if (slots < want) partial = f.firmId;
      planned.push({ firmId: f.firmId, tier, rank: f.rank, slots });
      left -= slots;
      row.plannedFunds += 1;
      row.plannedContacts += slots;
    }
    return row;
  });
  const plannedContacts = planned.reduce((sum, p) => sum + p.slots, 0);
  return { budget, planned, rows, plannedFunds: planned.length, plannedContacts, unused: Math.max(0, budget - plannedContacts), partial };
}

export type PlanCounts = {
  roster: number;
  byTier: Record<Placement, number>;
  noContact: number;
  budget: number;
  plannedFunds: number;
  plannedContacts: number;
};

export function planCounts(funds: PlanFund[], w: Waterfall): PlanCounts {
  const byTier = { core: 0, sphere: 0, tier3: 0, tier4: 0, outside: 0, none: 0 } as Record<Placement, number>;
  funds.forEach((f) => (byTier[f.tier] += 1));
  return {
    roster: funds.length,
    byTier,
    noContact: funds.filter((f) => (PLAN_TIERS as readonly string[]).includes(f.tier) && f.contacts === 0).length,
    budget: w.budget,
    plannedFunds: w.plannedFunds,
    plannedContacts: w.plannedContacts,
  };
}
