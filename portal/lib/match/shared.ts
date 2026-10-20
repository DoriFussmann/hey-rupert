// Rupert Match: types, labels and defaults shared by the server and the
// admin UI. Pure module (no engine import, no server code).

import type { Flag, Level, SiteResult, Tier } from "@/lib/match/engine/index.mjs";
import type { VerifyState } from "@/lib/match/verify";

export type { Flag, Level, SiteResult, Tier };

/** Private storage bucket for the fund database (server access only). */
export const FUND_DB_BUCKET = "fund-database";
export const FUND_DB_MAX_BYTES = 50 * 1024 * 1024;
/** Workbook upload piece size: under the hosting request limit (4.5 MB). */
export const FUND_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
/** Funds the daily website job checks (the whole database refreshes about monthly). */
export const DAILY_SITE_BATCH = 250;

export const TIERS: { key: Tier; label: string; description: string }[] = [
  {
    key: "bullseye",
    label: "Bullseye",
    description: "Right stage, core sector, your geography, focused thesis.",
  },
  {
    key: "match",
    label: "Match",
    description: "Fits on all three with a broader or one-step-off link.",
  },
  {
    key: "expansion",
    label: "Expansion",
    description: "One dimension stretched. Send after the core tiers.",
  },
];

export const LEVEL_LABEL: Record<Level, string> = {
  [-3]: "Widest",
  [-2]: "Broadest",
  [-1]: "Broader",
  0: "Default",
  1: "Tighter",
  2: "Tightest",
  3: "Strictest",
};

/** Tuning steps per tier, widest to strictest. */
export const LEVEL_MIN: Level = -3;
export const LEVEL_MAX: Level = 3;

/** Investor-list fit tier for each match tier (1 = best fit). */
export const TIER_TO_FIT: Record<Tier, 1 | 2 | 3> = {
  bullseye: 1,
  match: 2,
  expansion: 3,
};

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
    hint: "One per line.",
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

export type ContactBrief = { name: string; title: string; role: string; verify: VerifyState };

export type FirmRow = {
  id: string;
  name: string;
  type: string;
  hq: string;
  loc: string;
  year: number | null;
  /** Website as a full http(s) link, or "". */
  web: string;
  /** Investing contacts with an email at this fund. */
  people: number;
  tier: Tier;
  overflow: boolean;
  score: number;
  stage: number;
  sector: number;
  geo: number;
  conf: "High" | "Medium" | "Low";
  confValue: number;
  pros: string[];
  con: string | null;
  highFlags: string[];
  flagCount: number;
  site: SiteState | null;
  near: number;
  primary: ContactBrief | null;
  backup: ContactBrief | null;
  rejected: boolean;
  review: Review | null;
};

export type Count = { label: string; count: number };

export type TierSummary = {
  key: Tier;
  count: number;
  level: Level;
  rules: string[];
  byType: Count[];
  byHq: Count[];
  fitBands: Count[];
  confBands: Count[];
  siteStats: Count[];
  deadRemoved: { id: string; name: string; why: string }[];
  audit: { total: number; approved: number; rejected: number };
};

export type MatchView = {
  ranAt: string;
  database: { label: string; firms: number; contacts: number };
  header: string;
  people: number;
  counts: Record<Tier, number>;
  qualifiedBullseye: number;
  wave: number;
  funnel: Count[];
  funnelNotes: string[];
  tiers: Record<Tier, TierSummary>;
  rows: FirmRow[];
  reply: string;
  fewBullseye: boolean;
  hidden: { id: string; name: string; reason: string }[];
  siteN: number;
};

export type FirmContact = {
  /** FirmID + original email key (see lib/match/verify). */
  id: string;
  name: string;
  title: string;
  role: string;
  email: string;
  phone: string;
  location: string;
  seq: "Primary" | "Backup" | null;
  why: string[];
  verify: VerifyState;
};

export type FirmDetail = {
  row: FirmRow;
  why: string;
  pros: string[];
  cons: string[];
  verify: string[];
  flags: Flag[];
  fitParts: { label: string; value: number; max: number }[];
  checks: { ok: boolean; text: string }[];
  site: (SiteResult & { url: string }) | null;
  siteState: SiteState | null;
  firm: {
    website: string;
    email: string;
    phone: string;
    stages: string[];
    verticals: string[];
    industries: string[];
    geography: string[];
    offices: string[];
  };
  contacts: FirmContact[];
};

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
};

export type FundDbVersion = {
  id: string;
  fileName: string;
  status: "staged" | "live" | "archived";
  firms: number;
  contacts: number;
  offices: number;
  diff: FundDbDiff | null;
  createdBy: string | null;
  createdAt: string;
  appliedAt: string | null;
};
