// Outreach copy v3: investor email copy by source. Pure module, safe on the
// server and in the browser.
//
// Why a fund is on the confirmed Plan decides its email:
// - competitor: it backed one of the company's direct competitors (Step 2),
// - lookalike: it backed a company investors see as the same bet (Step 3),
// - market: neither; it fits the company's market (Dry Match, named, added).
// A fund in more than one goes to the first. Each group gets one template of
// two emails (a first email and one follow-up), short by design: the founder
// says they'll be brief, gives the narrative's three selling points as three
// bullets, states the round and asks one easy question.
// The only personal details are data the matching already holds: the backed
// company ({{backed_company}}) or the fund's matching sector ({{focus}}).
// Tier sets the outreach order, not the copy; fund type is a hint in the prompt.

import type { CopyEmail } from "../setup.ts";
import { emailIssues, mergeFieldsIn, optOutFor, renderEmail, type CopyIssue } from "./copy.ts";

export const SOURCE_COPY_VERSION = 3;

export const SOURCE_BUCKETS = ["competitor", "lookalike", "market"] as const;
export type SourceBucket = (typeof SOURCE_BUCKETS)[number];

export const BUCKET_LABEL: Record<SourceBucket, string> = {
  competitor: "Competitor Investors",
  lookalike: "Look-alike Investors",
  market: "Market Fit",
};

/** One line each. */
export const BUCKET_DETAIL: Record<SourceBucket, string> = {
  competitor: "Backed a direct competitor; we lead with what's different.",
  lookalike: "Backed a company like this one; we lead with that link.",
  market: "Invests in this market; we lead with the fit.",
};

/** A first email and one follow-up, in the same thread. */
export const SOURCE_SEQUENCE_LABELS = ["First email", "Follow-up"] as const;
export const SOURCE_SEQUENCE_LENGTH = SOURCE_SEQUENCE_LABELS.length;

/** Word cap for the first email's body; the follow-up gets three quarters of it. */
export const SOURCE_MAX_WORDS = 90;

/** The personal detail each group's opening line is built on. */
export const HOOK_FIELD: Record<SourceBucket, "backed_company" | "focus"> = {
  competitor: "backed_company",
  lookalike: "backed_company",
  market: "focus",
};

export const SOURCE_FIELDS: Record<SourceBucket, string[]> = {
  competitor: ["first_name", "fund_name", "backed_company"],
  lookalike: ["first_name", "fund_name", "backed_company"],
  market: ["first_name", "fund_name", "focus"],
};

export const SOURCE_FIELD_HELP: Record<string, string> = {
  first_name: "The investor's first name",
  fund_name: "The fund's name",
  backed_company: "The company this fund backed: the competitor, or the company like this one",
  focus: "The fund's sector that matches the company",
};

/** Note key for one group, used by the client's per-group notes. */
export function sourceGroupKey(bucket: SourceBucket) {
  return `source:${bucket}`;
}

export function asSourceBucket(value: unknown): SourceBucket | null {
  return (SOURCE_BUCKETS as readonly string[]).includes(String(value)) ? (value as SourceBucket) : null;
}

// ---------------------------------------------------------------------------
// Which funds, and why

/** What the copy needs from a Plan fund (lib/match/plan/core.ts PlanFund). */
export type PlanFundLike = {
  firmId: string;
  name: string;
  tier: string;
  type?: string;
  backed?: string[];
  sameStage?: string[];
  comparables?: string[];
  /** The sub-sector labels that placed it in its tier. */
  hit?: string[];
};

/** What the copy needs from a Plan's planned entry. */
export type PlannedLike = { firmId: string; tier: string; rank: number; slots: number };

export type OutreachFund = {
  firmId: string;
  name: string;
  tier: string;
  type: string;
  bucket: SourceBucket;
  /** Contacts the Plan gives it. */
  contacts: number;
  /** The value for the group's hook field; empty when the data has none. */
  hook: string;
};

const clean = (list: string[] | undefined) => (list ?? []).map((item) => String(item ?? "").trim()).filter(Boolean);

export function bucketOf(fund: Pick<PlanFundLike, "backed" | "comparables">): SourceBucket {
  if (clean(fund.backed).length) return "competitor";
  if (clean(fund.comparables).length) return "lookalike";
  return "market";
}

/** The hook value: the competitor it backed (at the client's stage first), the company like this one, or the sector that placed it. */
export function hookOf(fund: PlanFundLike, bucket: SourceBucket = bucketOf(fund)): string {
  if (bucket === "competitor") return clean(fund.sameStage)[0] ?? clean(fund.backed)[0] ?? "";
  if (bucket === "lookalike") return clean(fund.comparables)[0] ?? "";
  return clean(fund.hit)[0] ?? "";
}

/** The funds the Plan reaches, in Plan order, each with its group and hook. */
export function outreachFunds(plan: { funds: PlanFundLike[]; planned: PlannedLike[] }): OutreachFund[] {
  const byId = new Map(plan.funds.map((fund) => [fund.firmId, fund]));
  const out: OutreachFund[] = [];
  for (const entry of plan.planned) {
    const fund = byId.get(entry.firmId);
    if (!fund || entry.slots <= 0) continue;
    const bucket = bucketOf(fund);
    out.push({
      firmId: fund.firmId,
      name: fund.name,
      tier: entry.tier,
      type: String(fund.type ?? "").trim() || "Other",
      bucket,
      contacts: entry.slots,
      hook: hookOf(fund, bucket),
    });
  }
  return out;
}

export type SourceGroup = {
  bucket: SourceBucket;
  funds: number;
  contacts: number;
  /** Funds per fund type. */
  types: Record<string, number>;
  /** Funds per Plan tier (core, sphere, tier3, tier4). */
  tiers: Record<string, number>;
  /** Up to five hook values, most common first, so the template reads with any of them. */
  examples: string[];
  /** Funds with no hook value in the data. */
  missingHook: number;
};

export function sourceGroups(funds: OutreachFund[]): SourceGroup[] {
  return SOURCE_BUCKETS.flatMap((bucket) => {
    const inBucket = funds.filter((fund) => fund.bucket === bucket);
    if (!inBucket.length) return [];
    const types: Record<string, number> = {};
    const tiers: Record<string, number> = {};
    const hooks = new Map<string, number>();
    for (const fund of inBucket) {
      types[fund.type] = (types[fund.type] ?? 0) + 1;
      tiers[fund.tier] = (tiers[fund.tier] ?? 0) + 1;
      if (fund.hook) hooks.set(fund.hook, (hooks.get(fund.hook) ?? 0) + 1);
    }
    const examples = Array.from(hooks.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([hook]) => hook);
    return [
      {
        bucket,
        funds: inBucket.length,
        contacts: inBucket.reduce((sum, fund) => sum + fund.contacts, 0),
        types,
        tiers,
        examples,
        missingHook: inBucket.filter((fund) => !fund.hook).length,
      },
    ];
  });
}

/** Merge values for one fund; the investor's first name is added per contact. */
export function sourceValues(fund: Pick<OutreachFund, "name" | "bucket" | "hook">, firstName?: string): Record<string, string> {
  const values: Record<string, string> = { fund_name: fund.name };
  if (fund.hook) values[HOOK_FIELD[fund.bucket]] = fund.hook;
  if (firstName) values.first_name = firstName;
  return values;
}

// ---------------------------------------------------------------------------
// The copy

export type SourceGroupCopy = Omit<SourceGroup, "examples" | "missingHook"> & {
  examples?: string[];
  missingHook?: number;
  emails: CopyEmail[];
};

export type SourceCopy = {
  groups: SourceGroupCopy[];
  opt_out_line: string;
  /** The confirmed Plan the copy was written for. */
  plan_id?: string;
};

function emptySequence(): CopyEmail[] {
  return Array.from({ length: SOURCE_SEQUENCE_LENGTH }, () => ({ subject: "", body: "" }));
}

export function emptySourceCopy(groups: SourceGroup[], optOutLine: string, planId?: string): SourceCopy {
  return {
    groups: groups.map((group) => ({ ...group, emails: emptySequence() })),
    opt_out_line: optOutLine,
    ...(planId ? { plan_id: planId } : {}),
  };
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value : "").slice(0, max);
const count = (value: unknown) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(100000, Math.max(0, n)) : 0;
};
function counts(value: unknown) {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(raw).slice(0, 20)) {
    const k = key.slice(0, 40);
    if (count(n)) out[k] = count(n);
  }
  return out;
}

function asEmail(value: unknown): CopyEmail {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { subject: text(raw.subject, 300), body: text(raw.body, 10000) };
}

export function asSourceCopy(value: unknown): SourceCopy {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const seen = new Set<SourceBucket>();
  const groups: SourceGroupCopy[] = [];
  for (const item of Array.isArray(raw.groups) ? raw.groups : []) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    const bucket = asSourceBucket(g.bucket);
    if (!bucket || seen.has(bucket)) continue;
    seen.add(bucket);
    const list = Array.isArray(g.emails) ? g.emails : [];
    const examples = Array.isArray(g.examples) ? g.examples.map((e) => text(e, 120).trim()).filter(Boolean).slice(0, 5) : [];
    groups.push({
      bucket,
      funds: count(g.funds),
      contacts: count(g.contacts),
      types: counts(g.types),
      tiers: counts(g.tiers),
      ...(examples.length ? { examples } : {}),
      ...(count(g.missingHook) ? { missingHook: count(g.missingHook) } : {}),
      emails: Array.from({ length: SOURCE_SEQUENCE_LENGTH }, (_, index) => asEmail(list[index])),
    });
  }
  groups.sort((a, b) => SOURCE_BUCKETS.indexOf(a.bucket) - SOURCE_BUCKETS.indexOf(b.bucket));
  const planId = text(raw.plan_id, 100).trim();
  return { groups, opt_out_line: text(raw.opt_out_line, 300).trim(), ...(planId ? { plan_id: planId } : {}) };
}

export function sourceHasContent(copy: SourceCopy) {
  return copy.groups.some((group) => group.emails.some((email) => email.subject.trim() || email.body.trim()));
}

// ---------------------------------------------------------------------------
// Checks

/** "You backed", "you invested": the reader may not be the person who did. */
const PERSONAL_YOU = /\byou(?:'ve| have)? (?:backed|invested|led|funded|wrote a check|bet on)\b/i;

/** Problems in one email of a group. */
export function sourceEmailIssues(email: CopyEmail, index: number, bucket: SourceBucket, where = ""): CopyIssue[] {
  const issues = emailIssues(email, index, "others", SOURCE_MAX_WORDS, where, SOURCE_FIELDS[bucket], SOURCE_SEQUENCE_LABELS);
  const at = `${where}, ${SOURCE_SEQUENCE_LABELS[index] ?? `Email ${index + 1}`}`;
  if (!email.body.trim()) return issues;
  const hook = HOOK_FIELD[bucket];
  if (index === 0 && !mergeFieldsIn(email.body).includes(hook)) {
    issues.push({
      level: bucket === "market" ? "warning" : "error",
      where: at,
      text: `doesn't use {{${hook}}}, so the opening line can't say why this fund.`,
    });
  }
  if (PERSONAL_YOU.test(`${email.subject}\n${email.body}`)) {
    issues.push({ level: "warning", where: at, text: "says \"you\" about the investments; write \"your fund\": the reader may not be the person who invested." });
  }
  if (index > 0 && email.subject.trim()) {
    issues.push({ level: "warning", where: at, text: "has a subject, so it starts a new thread; leave it blank to reply in the same thread." });
  }
  if (/\bI know (?:you're|you are|how) busy\b|\byour time is (?:valuable|precious)\b/i.test(email.body)) {
    issues.push({ level: "warning", where: at, text: "says \"I know you're busy\" or similar; the three points already show it. Use the hook instead (\"…so you know this market\")." });
  }
  if (/\b(?:Q[1-4]|[1-4](?:st|nd|rd|th) quarter)\b/i.test(email.body)) {
    issues.push({ level: "warning", where: at, text: "gives the close as a quarter; write a month or \"by year-end\"." });
  }
  if (/\$\d+(?:\.\d+)?[mk]\b/.test(email.body)) {
    issues.push({ level: "warning", where: at, text: "writes an amount in lower case (\"$2m\"); write \"$2M\"." });
  }
  if (/https?:\/\/|www\./i.test(email.body)) {
    issues.push({ level: "warning", where: at, text: "has a link; plain emails without links land better." });
  }
  return issues;
}

/** Every problem in the copy. Errors stop the push; warnings are shown. */
export function sourceCopyIssues(copy: SourceCopy): CopyIssue[] {
  const issues: CopyIssue[] = [];
  if (copy.groups.length === 0) {
    issues.push({ level: "error", where: "Email copy", text: "has no groups. Draft it from the confirmed plan." });
  }
  for (const group of copy.groups) {
    const where = BUCKET_LABEL[group.bucket];
    group.emails.forEach((email, index) => issues.push(...sourceEmailIssues(email, index, group.bucket, where)));
    if (group.missingHook) {
      issues.push({
        level: "warning",
        where,
        text: `${group.missingHook} fund${group.missingHook === 1 ? " has" : "s have"} no {{${HOOK_FIELD[group.bucket]}}} in the matching data; check their opening line before sending.`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Rendering

/** One email of a group for one fund; fields without a value stay as {{field}}. The opt-out line goes under the first email only. */
export function renderSourceEmail(group: Pick<SourceGroupCopy, "emails">, index: number, values: Record<string, string>, optOutLine: string): CopyEmail {
  const email = group.emails[index] ?? { subject: "", body: "" };
  return renderEmail(email, values, optOutFor(index, optOutLine));
}

// ---------------------------------------------------------------------------
// Facts for the email that tells the founder the copy is ready

/** Exact numbers for the "your emails are ready" email; the AI only words them. */
export function sourceFactsText(copy: SourceCopy) {
  const funds = copy.groups.reduce((sum, group) => sum + group.funds, 0);
  const contacts = copy.groups.reduce((sum, group) => sum + group.contacts, 0);
  return [
    `Funds the emails go to: ${funds}.`,
    `Investors who will receive the emails: ${contacts}.`,
    `By why the fund is on the list: ${copy.groups.map((group) => `${BUCKET_LABEL[group.bucket]} ${group.funds} funds, ${group.contacts} investors`).join("; ")}.`,
    `The copy is written by why each fund is on the list: one short template per group, a first email and one follow-up in the same thread. Each email names what links that fund to the company (the company it backed, or the sector it invests in); the investor's name and fund are filled in for every recipient.`,
  ].join("\n");
}
