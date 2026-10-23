// Rupert Match: types, labels and defaults shared by the server and the
// admin UI. Pure module (no engine import, no server code).

import type { Flag, Level, SiteResult, Tier } from "@/lib/match/engine/index.mjs";
import type { ReappliedContacts } from "@/lib/match/contact-import";

export type { Flag, Level, SiteResult, Tier };

/** Private storage bucket for the fund database (server access only). */
export const FUND_DB_BUCKET = "fund-database";
export const FUND_DB_MAX_BYTES = 50 * 1024 * 1024;
/** Workbook upload piece size: under the hosting request limit (4.5 MB). */
export const FUND_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
/** Funds the daily website job checks (the whole database refreshes about monthly). */
export const DAILY_SITE_BATCH = 250;

/** The Matching page for a client; `tab` opens one of its tabs. */
export function matchPath(clientId: string, tab?: MatchTab) {
  return `/admin/matching?client=${encodeURIComponent(clientId)}${tab && tab !== "plan" ? `&tab=${tab}` : ""}`;
}

/** The Verify Emails tab with only one tier filled in. */
export function verifyTierPath(clientId: string, tier: string) {
  return `${matchPath(clientId, "verify")}&tier=${encodeURIComponent(tier)}`;
}

export const MATCH_TABS = ["plan", "tiers", "verify", "outside", "near", "history"] as const;
export type MatchTab = (typeof MATCH_TABS)[number];

export const MATCH_TAB_LABEL: Record<MatchTab, string> = {
  plan: "Plan",
  tiers: "Tiers",
  verify: "Verify Emails",
  outside: "Outside the tiers",
  near: "Near misses",
  history: "History",
};

/** The tab asked for; the Plan tab when none (or an unknown one). "capacity" is the Plan tab's old name. */
export function asMatchTab(value: unknown): MatchTab {
  if (value === "capacity") return "plan";
  return (MATCH_TABS as readonly string[]).includes(String(value)) ? (value as MatchTab) : "plan";
}

const VC_LADDER = [
  "Pre-Seed",
  "Seed",
  "Series A",
  "Series B",
  "Series C and Beyond",
  "Growth Equity",
];

/** The stages a fund lists, as "Seed" or "Seed–Series A" when they sit next to each other. */
export function stageRange(stages: string[]) {
  const listed = stages.map((stage) => stage.trim()).filter(Boolean);
  const ordered = VC_LADDER.filter((stage) => listed.includes(stage));
  const extra = listed.filter((stage) => !VC_LADDER.includes(stage));
  if (ordered.length >= 2 && extra.length === 0) {
    const indexes = ordered.map((stage) => VC_LADDER.indexOf(stage));
    const contiguous = indexes.every((index, i) => i === 0 || index === indexes[i - 1] + 1);
    if (contiguous) return `${ordered[0]}–${ordered[ordered.length - 1]}`;
  }
  const names = [...ordered, ...extra];
  return names.slice(0, 4).join(", ");
}

export const FIRM_TYPES = [
  "Venture Capital Investment Firm",
  "Family Investment Office",
  "Angel Investor Group",
  "Private Equity Investment Firm",
] as const;

const FIRM_TYPE_SHORT: Record<string, string> = {
  "Venture Capital Investment Firm": "VC",
  "Family Investment Office": "Family office",
  "Angel Investor Group": "Angel group",
  "Private Equity Investment Firm": "PE",
};

export function firmTypeLabel(type: string) {
  return FIRM_TYPE_SHORT[type] ?? (type || "Other");
}

/** Markets the intake converter recognises (same list as to-profile.mjs). */
export const MARKETS = [
  "United States",
  "Canada",
  "United Kingdom",
  "Europe",
  "Germany",
  "France",
  "Israel",
  "India",
  "Singapore",
  "Asia",
  "Latin America",
  "Middle East",
  "Africa",
  "Australia",
  "Japan",
  "Brazil",
  "Mexico",
];

export const BUSINESS_MODELS = ["B2B", "B2C", "B2B2C", "Marketplace", "Hardware"];

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

// ---------------------------------------------------------------------------
// Company profile fields (intake answers). Ids match the question bank
// (lib/match/intake/intake-questions.json) and to-profile.mjs.

export type FieldKind =
  | "text"
  | "textarea"
  | "stage"
  | "model"
  | "lead"
  | "verticals"
  | "industries"
  | "country"
  | "state"
  | "markets"
  | "investor_types";

export type MatchField = {
  id: string;
  label: string;
  section: string;
  kind: FieldKind;
  hint?: string;
};

export const MATCH_FIELDS: MatchField[] = [
  { id: "company_name", label: "Company name", section: "Company", kind: "text" },
  { id: "website", label: "Website", section: "Company", kind: "text" },
  { id: "one_liner", label: "One-liner", section: "Company", kind: "text" },
  { id: "business_model", label: "Business model", section: "Company", kind: "model" },
  { id: "stage", label: "Stage of this round", section: "Round", kind: "stage" },
  { id: "raise_amount", label: "Raising", section: "Round", kind: "text", hint: "e.g. $3M" },
  {
    id: "instrument",
    label: "Instrument",
    section: "Round",
    kind: "text",
    hint: "Empty means equity (SAFE, note or priced round). Set it only for debt or royalties.",
  },
  { id: "need_lead", label: "Needs a lead investor", section: "Round", kind: "lead" },
  { id: "committed_so_far", label: "Committed so far", section: "Round", kind: "text" },
  { id: "valuation", label: "Valuation or cap", section: "Round", kind: "text" },
  { id: "close_timeline", label: "Target close", section: "Round", kind: "text" },
  { id: "previous_rounds", label: "Previous rounds", section: "Round", kind: "text" },
  {
    id: "core_vertical",
    label: "Verticals (first = core)",
    section: "Sector",
    kind: "verticals",
  },
  {
    id: "core_industry",
    label: "Industries (first = core)",
    section: "Sector",
    kind: "industries",
    hint: "Left empty, they are derived from the verticals.",
  },
  { id: "hq_country", label: "HQ country", section: "Geography", kind: "country" },
  { id: "hq_state", label: "HQ state (US)", section: "Geography", kind: "state" },
  { id: "hq_city", label: "HQ city", section: "Geography", kind: "text" },
  { id: "markets", label: "Also selling into", section: "Geography", kind: "markets" },
  {
    id: "entity",
    label: "Legal entity",
    section: "Geography",
    kind: "text",
    hint: "e.g. Delaware C-corp",
  },
  {
    id: "revenue",
    label: "Revenue",
    section: "Traction",
    kind: "text",
    hint: "e.g. $45k MRR, or pre-revenue",
  },
  { id: "growth", label: "Growth", section: "Traction", kind: "text" },
  { id: "traction_proof", label: "Proof points", section: "Traction", kind: "textarea" },
  { id: "founders", label: "Founders' background", section: "Team", kind: "textarea" },
  { id: "team_size", label: "Team size", section: "Team", kind: "text" },
  {
    id: "existing_investors",
    label: "Existing investors",
    section: "Investors & conflicts",
    kind: "textarea",
    hint: "One per line, or “none”.",
  },
  {
    id: "already_pitched",
    label: "Funds pitched in the last 12 months",
    section: "Investors & conflicts",
    kind: "textarea",
    hint: "One per line, or “none”.",
  },
  {
    id: "competitors",
    label: "Direct competitors",
    section: "Investors & conflicts",
    kind: "textarea",
    hint: "One per line, or “none”.",
  },
  {
    id: "no_go",
    label: "Funds to avoid",
    section: "Investors & conflicts",
    kind: "textarea",
    hint: "Enter fund names or website domains, one per line. Sentences are not applied.",
  },
  {
    id: "investor_types",
    label: "Investor types",
    section: "Preferences",
    kind: "investor_types",
    hint: "None ticked: set from the stage.",
  },
  { id: "warm_connections", label: "Warm connections", section: "Preferences", kind: "textarea" },
];

export const MATCH_SECTIONS = Array.from(
  new Set(MATCH_FIELDS.map((field) => field.section)),
);

const LIST_KINDS = new Set<FieldKind>([
  "verticals",
  "industries",
  "markets",
  "investor_types",
]);

export function isListField(field: MatchField) {
  return LIST_KINDS.has(field.kind);
}

export function fieldLabel(id: string) {
  return MATCH_FIELDS.find((field) => field.id === id)?.label ?? id;
}

export type MatchAnswers = Record<string, string | string[]>;

/** What an empty field means, so a blank never reads as "missing". */
export const EMPTY_FIELD_MEANS: Record<string, string> = {
  instrument: "Equity (default)",
  core_industry: "Derived from the verticals",
  investor_types: "Set from the stage",
};

/** A field's saved answer as display text, or null when it is empty. */
export function fieldDisplay(field: MatchField, value: string | string[] | undefined) {
  if (Array.isArray(value) && value.length > 0) {
    return field.kind === "investor_types" ? value.map(firmTypeLabel).join(", ") : value.join(", ");
  }
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

/** The fields of one profile section; the US state only for a US company. */
export function sectionFields(section: string, answers: MatchAnswers) {
  const isUs = answers.hq_country === "United States";
  return MATCH_FIELDS.filter((field) => field.section === section).filter(
    (field) => field.kind !== "state" || isUs,
  );
}

/**
 * The company profile as plain text, by topic, for an AI prompt. Empty
 * answers are left out, except the ones where empty means "none".
 */
export function profileText(raw: unknown) {
  const answers = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lines: string[] = [];
  for (const section of MATCH_SECTIONS) {
    const rows = MATCH_FIELDS.filter((field) => field.section === section)
      .map((field) => {
        const value = answers[field.id];
        const text = Array.isArray(value)
          ? value.map(String).join(", ")
          : value != null
            ? String(value).trim()
            : "";
        if (text) return `- ${field.label}: ${text}`;
        return NONE_OK_FIELDS.has(field.id) ? `- ${field.label}: none` : null;
      })
      .filter(Boolean);
    if (rows.length > 0) lines.push(`### ${section}`, ...(rows as string[]));
  }
  return lines.length > 0 ? lines.join("\n") : "No company profile yet.";
}

// ---------------------------------------------------------------------------
// Operator settings (set in the tool, not by the founder)

export type MatchSettings = {
  waveSize: number;
  tune: Record<Tier, Level>;
  filters: {
    noPlatforms: boolean;
    needDecision: boolean;
    /** Only funds with an investing contact who has an email. */
    needEmail: boolean;
    nearOnly: boolean;
    minConf: 0 | 0.6 | 0.99;
    foundedAfter: number;
  };
  /** Websites checked per tier (0 = off). */
  siteN: 0 | 50 | 100 | 200;
  dropDead: boolean;
};

export const SITE_N_OPTIONS: MatchSettings["siteN"][] = [0, 50, 100, 200];

export const DEFAULT_SETTINGS: MatchSettings = {
  waveSize: 100,
  tune: { bullseye: 0, match: 0, expansion: 0 },
  filters: {
    noPlatforms: false,
    needDecision: false,
    needEmail: false,
    nearOnly: false,
    minConf: 0,
    foundedAfter: 0,
  },
  siteN: 50,
  dropDead: true,
};

export type ProfileGap = { id: string; label: string; kind: "missing" | "unasked" };

export type MatchProfileStatus = "ready" | "needs_info";

export type MatchProfileState = {
  answers: MatchAnswers;
  settings: MatchSettings;
  status: MatchProfileStatus;
  gaps: ProfileGap[];
  warnings: string[];
  sourceInterviewAt: string | null;
  builtAt: string | null;
  editedAt: string | null;
};

// ---------------------------------------------------------------------------
// Reviews

export const REJECT_REASONS = [
  "Not active / no recent deals",
  "Check size mismatch",
  "Thesis mismatch",
  "Portfolio conflict",
  "Wrong or stale contact",
  "Already in touch",
  "Client veto",
  "Other",
];

export type Review = { status: "ok" | "no"; reason: string; note: string };

// ---------------------------------------------------------------------------
// What the Match page receives

export type SiteState = SiteResult["st"] | "unscanned";

export const SITE_LABEL: Record<SiteState, string> = {
  ok: "Website OK",
  moved: "Redirects",
  offtopic: "Off-topic site",
  thin: "Unreadable site",
  blocked: "Site blocks checks",
  broken: "Dead website",
  parked: "Parked domain",
  inactive: "Not investing",
  none: "No website",
  unscanned: "Not checked yet",
};

/** "150 Website OK · 12 Dead website …" from status counts, biggest first. */
export function siteSummaryText(summary: Record<string, number>) {
  return Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${count.toLocaleString("en-US")} ${SITE_LABEL[status as SiteState] ?? status}`)
    .join(" · ");
}

const SECTOR_FOCUS_LINE = /^Your sectors are \d+% of its focus\.?$/i;

/** True for the generated line "Your sectors are 100% of its focus". */
export function isSectorFocusLine(text: string) {
  return SECTOR_FOCUS_LINE.test(text.trim());
}

/** Drops that generated line from a why-it-works blurb. */
export function dropSectorFocus(text: string) {
  return text
    .split("\n")
    .filter((line) => !isSectorFocusLine(line))
    .join("\n")
    .trim();
}

/** Fields where "none" is a real answer. */
export const NONE_OK_FIELDS = new Set(["existing_investors", "already_pitched", "competitors"]);

// ---------------------------------------------------------------------------
// Fund database versions

export type FundDbDiff = {
  previous: { firms: number; contacts: number } | null;
  added: number;
  removed: number;
  changed: number;
  addedSample: string[];
  removedSample: string[];
  reviewsOnRemoved: number;
  warnings: string[];
  /** CSV import: contacts it added. */
  contactsAdded?: number;
  /** Workbook: contacts added by CSV earlier, put back on top of it. */
  reapplied?: ReappliedContacts;
  /** Workbook: values the investor taxonomy has not seen (null: taxonomy not set up). */
  taxonomy?: { newValues: number; sample: string[] } | null;
};

export type FundDbVersion = {
  id: string;
  fileName: string;
  status: "staged" | "live" | "archived";
  /** A provider workbook, or contacts added by CSV. */
  source: "workbook" | "csv";
  firms: number;
  contacts: number;
  offices: number;
  diff: FundDbDiff | null;
  createdBy: string | null;
  createdAt: string;
  appliedAt: string | null;
};
