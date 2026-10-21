// Types for the Rupert Match engine (rupert-match-engine.cjs, used as-is).

export type Firm = {
  id: string;
  name: string;
  type: string;
  region: string;
  year: number | null;
  stages: string[];
  fin: string[];
  ind: string[];
  vert: string[];
  geo: string[];
  city: string;
  state: string;
  country: string;
  web: string;
  email: string;
  phone: string;
  nContacts: number;
  offices: { city: string; country: string; type: string }[];
};

export type Contact = {
  fid: string;
  first: string;
  last: string;
  prefix: string;
  title: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  officeType: string;
  principal: boolean;
  lead: boolean;
  matchQ: string;
};

export type FundDb = {
  firms: Firm[];
  contacts: Contact[];
  loadedAt?: string;
};

export type SiteStatus =
  | "ok"
  | "moved"
  | "offtopic"
  | "thin"
  | "blocked"
  | "broken"
  | "parked"
  | "inactive"
  | "none";

export type SiteResult = {
  st: SiteStatus;
  at: string;
  why?: string;
  code?: number;
  title?: string;
  desc?: string;
  h1?: string;
  moved?: string;
  stages?: string[];
  sectors?: string[];
  check?: string;
  tls?: string;
};

export type Tier = "bullseye" | "match" | "expansion";
export type Level = -3 | -2 | -1 | 0 | 1 | 2 | 3;
export type Role = "decision" | "champion" | "scout" | "advisor" | "ops" | "other";

export type MatchFilters = {
  noPlatforms?: boolean;
  needDecision?: boolean;
  /** Only funds with an investing contact who has an email. */
  needEmail?: boolean;
  nearOnly?: boolean;
  minConf?: number;
  foundedAfter?: number;
};

export type MatchProfile = {
  name: string;
  web: string;
  oneliner: string;
  model: string;
  stage: string;
  raise: string;
  instruments: string[];
  firmTypes: string[] | null;
  lead: boolean;
  verticals: string[];
  industries: string[];
  country: string;
  usRegion: string;
  city: string;
  markets: string[];
  arr: string;
  growth: string;
  notes: string;
  exclusions: string;
  waveSize: number;
  tune: Record<Tier, Level>;
  filters: MatchFilters;
  siteN: number;
  dropDead: boolean;
};

export type Flag = { sev: "high" | "med" | "low"; text: string };

export type RankedContact = Contact & {
  role: Role;
  roleLabel: string;
  score: number;
  why: string[];
  seq?: "Primary" | "Backup";
};

export type MatchResult = {
  f: Firm;
  tier: Tier;
  score: number;
  fit: { total: number; parts: Record<string, number> };
  st: { s: number; how: string; adj?: string[] };
  se: {
    s: number;
    how: string;
    vMatch: string[];
    iMatch: string[];
    vAdj: string[];
    generalist: boolean;
    focus: number;
    primaryHit: boolean;
  };
  ge: { s: number; how: string; explicit?: boolean };
  A: {
    conf: number;
    confLabel: "High" | "Medium" | "Low";
    checks: { ok: boolean; text: string }[];
    flags: Flag[];
    generalist: boolean;
  };
  pros: string[];
  cons: string[];
  verify: string[];
  why: string;
  seq: RankedContact[];
  ranked: RankedContact[];
  nearPeople: number;
  localPeople: number;
  loc: string;
  rejected: string | null;
  overflow?: boolean;
  site?: SiteResult | { st: "unscanned" };
  dead?: boolean;
};

export type Funnel = {
  total: number;
  type: number;
  instrument: number;
  stage: number;
  sector: number;
  geo: number;
  excluded: number;
  suppressed: number;
  rejected: number;
  filtered: number;
  deadSite: number;
};

export type RunOptions = {
  sites?: Record<string, SiteResult>;
  suppressed?: Record<string, string>;
  rejected?: Record<string, string>;
};

export type RunOutput = {
  results: MatchResult[];
  counts: Record<Tier, number>;
  funnel: Funnel;
  types: string[];
  inst: string[];
  people: number;
  qualifiedBullseye: number;
  wave: number;
  tune: Record<Tier, Level>;
  siteStats: Record<Tier, Record<string, number>>;
  deadRemoved: MatchResult[];
  siteN: number;
};

type Engine = {
  normalize(
    firmRows: Record<string, unknown>[],
    contactRows: Record<string, unknown>[],
    officeRows?: Record<string, unknown>[],
  ): FundDb;
  run(db: FundDb, profile: MatchProfile, opts?: RunOptions): RunOutput;
  preview(
    db: FundDb,
    profile: MatchProfile,
    tier: Tier,
    level: Level,
    opts?: RunOptions,
  ): Record<Tier, number>;
  rulesText(tier: Tier, level: Level, profile: MatchProfile): string[];
  /** The firm's contacts, best first (shared with the four-tier engine). */
  rankContacts(firm: Firm, contacts: Contact[], profile: MatchProfile): RankedContact[];
  /** Primary and backup contact from ranked contacts. */
  pickSequence(ranked: RankedContact[]): RankedContact[];
  /** Data confidence and red flags. */
  assess(firm: Firm, contacts: Contact[], sequence: RankedContact[], nameDuplicate: boolean): MatchResult["A"];
  /** Applies a website check to a result: flags and pros. */
  applySite(result: { site: SiteResult | { st: "unscanned" }; A: { flags: Flag[] }; pros: string[] }, profile: MatchProfile): void;
  /** A contact near the company (same city, US region, or country). */
  isNear(contact: Contact, profile: MatchProfile): boolean;
  /** The exclusion terms the engine compares, from the profile's exclusion text. */
  parseExclusions(text: string): string[];
  /** A website's bare domain. */
  domainOf(website: string): string;
  roleOf(title: string): Role;
  defaultTypes(stage: string): string[];
  bucketsFor(country: string): string[];
  SITE_LABEL: Record<string, string>;
  ROLE_LABEL: Record<Role, string>;
  VC_LADDER: string[];
  PE_STAGES: string[];
  INDUSTRIES: string[];
  VERTICALS: string[];
  V2I: Record<string, string[]>;
  US_REGIONS: string[];
  COUNTRIES: string[];
  STATE_REGION: Record<string, string>;
  LEVELS: Level[];
  TUNE: Record<Tier, Record<string, Record<string, unknown>>>;
};

declare const RME: Engine;
export default RME;
