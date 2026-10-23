// Canonical company profile: the company's sector, stage and geography as
// Phase 1 taxonomy categories, with where each classification came from, the
// founder's own words that support it, and what still needs confirming.
// Pure module: no server code, so it runs in tests and in the UI.
//
// Three kinds of source are kept apart:
//   founder: the founder stated it, and a quote from their own messages proves it
//   ai:      an AI interpretation of what the founder said, with its reasoning
//   admin:   an admin's decision
//   legacy:  converted from a profile saved before Phase 2; no evidence recorded
// "Confirmed with founder" is a status on top of the source, set by an admin.

import { GENERALIST_KIND, findAlias, type FieldKey, type TaxIndex } from "../taxonomy/core.ts";

export const PROFILE_SCHEMA = 1;

export type ClassSource = "founder" | "ai" | "admin" | "legacy";
export type ClassStatus = "accepted" | "needs_confirmation" | "confirmed_founder";
export type Confidence = "high" | "medium" | "low";

export const SOURCE_LABEL: Record<ClassSource, string> = {
  founder: "Founder-stated",
  ai: "AI interpretation",
  admin: "Admin decision",
  legacy: "Legacy (no evidence recorded)",
};

export const STATUS_LABEL: Record<ClassStatus, string> = {
  accepted: "Accepted",
  needs_confirmation: "Needs confirmation",
  confirmed_founder: "Confirmed with founder",
};

/** A quote offered as evidence, and whether it was found in the founder's own messages. */
export type Evidence = { quote: string; verified: boolean };

export type Classification = {
  nodeId: string;
  label: string;
  source: ClassSource;
  /** Founder quotes. Only verified quotes count as evidence. */
  evidence: Evidence[];
  /** Why the evidence supports this category. */
  rationale: string;
  confidence: Confidence | null;
  status: ClassStatus;
  decidedBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
};

export type SectorRole = "primary" | "secondary";
export type SectorClass = Classification & { role: SectorRole };

/** A plain-language fact about the business, with the quotes behind it. */
export type TextFact = { text: string; source: ClassSource; evidence: Evidence[] };

export type IssueSeverity = "blocking" | "limited" | "info";

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  blocking: "Blocks matching",
  limited: "Limited match",
  info: "Info",
};

export type ProfileIssue = { field: string; severity: IssueSeverity; message: string };

export type Readiness = "blocked" | "limited" | "ready";

export const READINESS_LABEL: Record<Readiness, string> = {
  blocked: "Blocked",
  limited: "Limited match",
  ready: "Ready",
};

export type VersionSource = "intake_ai" | "admin_edit" | "admin_confirm" | "legacy";

export const VERSION_SOURCE_LABEL: Record<VersionSource, string> = {
  intake_ai: "Built from the intake",
  admin_edit: "Admin edit",
  admin_confirm: "Confirmed with founder",
  legacy: "Legacy profile",
};

export type CompanyProfile = {
  schema: typeof PROFILE_SCHEMA;
  identity: { name: string; website: string; oneLiner: string };
  /** What the company does, kept apart from who it sells to. */
  business: {
    product: TextFact | null;
    businessModel: string;
    customers: TextFact | null;
    /** Industries the founder mentioned that are not the company's own (customers', suppliers', channels'). */
    notCompanySectors: { label: string; reason: string }[];
  };
  sectors: SectorClass[];
  stage: Classification | null;
  hq: { country: Classification | null; state: Classification | null; city: string };
  markets: Classification[];
  financing: Classification[];
  /** Investor types the company wants. Empty: set from the stage. */
  firmTypes: Classification[];
  raise: { amount: string };
  exclusions: { existingInvestors: string[]; alreadyPitched: string[]; noGo: string[]; competitors: string[] };
  /** Points to clarify with the founder, raised by the AI. */
  ambiguities: { topic: string; question: string }[];
  /** Checks from the existing converter (stage vs raise, entity and the like). */
  converterWarnings: string[];
  provenance: {
    /** Fingerprint of the saved answers this profile matches. */
    basis: string;
    interviewAt: string | null;
    taxonomyRevision: number;
  };
};

export const MAX_SECONDARY = 2;
const RATIONALE_MIN = 20;
const QUOTE_MIN = 12;

// ---------------------------------------------------------------------------
// Evidence

/** Comparable form for quote checks: case, quotes, dashes and spacing don't matter. */
export function quoteKey(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What the founder said and shared: their own messages, plus what Rupert
 * read in the files they shared in the intake. Rupert's turns and the
 * summaries never count. Materials the founder uploaded count as their word.
 */
export function founderTranscript(
  messages: { role: string; content: string; attachments?: { facts: string }[] }[],
) {
  return quoteKey(
    messages
      .filter((message) => message.role === "user")
      .flatMap((message) => [
        ...(message.attachments ?? []).map((file) => file.facts),
        message.content,
      ])
      .filter((text) => text.trim())
      .join("\n"),
  );
}

/** Whether a category's name appears as a whole phrase in the founder's words or files. */
function namedIn(label: string, transcript: string) {
  const name = quoteKey(label);
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(transcript);
}

/**
 * An unconfirmed place with no evidence (for example the HQ state, which is
 * read from the profile fields) is accepted when the founder named it in
 * their messages or their files.
 */
function acceptIfNamed<T extends Classification>(c: T | null, transcript: string): T | null {
  if (!c || c.status !== "needs_confirmation" || verifiedCount(c) > 0) return c;
  if (!namedIn(c.label, transcript)) return c;
  return {
    ...c,
    source: "founder",
    status: "accepted",
    evidence: [{ quote: c.label, verified: true }],
    rationale: "Named in the founder's messages or the files they shared.",
  };
}

/**
 * Whether a quote appears in the founder's messages. Surrounding quote marks
 * and trailing punctuation are ignored; "…" may join parts that each appear,
 * in order. Too-short quotes never count.
 */
export function verifyQuote(quote: string, transcript: string) {
  const parts = quoteKey(quote)
    .replace(/^["'\s]+|["'\s.,;:!?]+$/g, "")
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((part) => part.replace(/^["'\s]+|["'\s.,;:!?]+$/g, ""))
    .filter(Boolean);
  if (parts.length === 0 || parts.join(" ").length < QUOTE_MIN) return false;
  let from = 0;
  for (const part of parts) {
    const at = transcript.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

function cleanQuotes(value: unknown, transcript: string): Evidence[] {
  if (!Array.isArray(value)) return [];
  const out: Evidence[] = [];
  for (const item of value.slice(0, 5)) {
    const quote = String(item ?? "").trim().slice(0, 400);
    if (!quote || out.some((existing) => existing.quote === quote)) continue;
    out.push({ quote, verified: verifyQuote(quote, transcript) });
  }
  return out;
}

const verifiedCount = (c: { evidence: Evidence[] }) => c.evidence.filter((e) => e.verified).length;

// ---------------------------------------------------------------------------
// Taxonomy lookups

type Dim = "sector" | "stage" | "geography" | "financing" | "firm_type";

/** The active category behind a provider-vocabulary value in a field, if mapped. */
function nodeForValue(index: TaxIndex, field: FieldKey, value: string) {
  const alias = value ? findAlias(index, field, value) : null;
  if (!alias || alias.state !== "mapped") return null;
  const node = alias.nodeIds.map((id) => index.nodes.get(id)).find((n) => n && n.status === "active");
  return node ?? null;
}

/** Categories an AI or admin may choose for a dimension. */
export function choosable(index: TaxIndex, dimension: Dim, kinds?: string[]) {
  return index.taxonomy.nodes.filter(
    (node) =>
      node.dimension === dimension &&
      node.status === "active" &&
      node.kind !== "group" &&
      node.kind !== GENERALIST_KIND &&
      (!kinds || kinds.includes(node.kind)),
  );
}

export const SECTOR_KINDS = ["sector", "thesis"];
export const STAGE_KINDS = ["stage"];
export const COUNTRY_KINDS = ["country"];

function isChoosable(index: TaxIndex, nodeId: string, dimension: Dim, kinds: string[]) {
  const node = index.nodes.get(nodeId);
  return Boolean(
    node && node.dimension === dimension && node.status === "active" && kinds.includes(node.kind),
  );
}

/** The provider-vocabulary value the current engine knows a category by, and in which field. */
export function engineValue(index: TaxIndex, nodeId: string, fields: FieldKey[]) {
  for (const field of fields) {
    const alias = index.taxonomy.aliases.find(
      (a) => a.field === field && a.state === "mapped" && a.nodeIds.length === 1 && a.nodeIds[0] === nodeId,
    );
    if (alias) return { field, value: alias.rawValue };
  }
  return null;
}

function blank(nodeId: string, label: string, source: ClassSource, extra: Partial<Classification> = {}): Classification {
  return {
    nodeId,
    label,
    source,
    evidence: [],
    rationale: "",
    confidence: null,
    status: source === "admin" ? "accepted" : "needs_confirmation",
    decidedBy: null,
    confirmedBy: null,
    confirmedAt: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// From the engine profile (what matching runs on today)

/** The fields of the current engine profile this module reads. */
export type EngineProfileView = {
  name: string;
  web: string;
  oneliner: string;
  model: string;
  stage: string;
  raise: string;
  instruments: string[];
  firmTypes: string[] | null;
  verticals: string[];
  industries: string[];
  country: string;
  city: string;
  markets: string[];
  exclusions: string;
  intake?: { competitors?: string[] };
};

export type AnswerLists = {
  existingInvestors: string[];
  alreadyPitched: string[];
  noGo: string[];
  competitors: string[];
  /** Industries the admin or AI set explicitly (not derived from verticals). */
  explicitIndustries: boolean;
  hqState: string;
};

/**
 * The canonical profile behind saved answers, with no evidence: for profiles
 * saved before Phase 2 and for anything changed outside the classification.
 */
export function fromEngineProfile(
  engine: EngineProfileView,
  lists: AnswerLists,
  index: TaxIndex,
  meta: { basis: string; interviewAt: string | null; source: ClassSource; converterWarnings: string[] },
): CompanyProfile {
  const source = meta.source;
  const make = (field: FieldKey, value: string) => {
    const node = nodeForValue(index, field, value);
    return node ? blank(node.id, node.label, source) : null;
  };

  const sectorIds: { id: string; label: string }[] = [];
  const push = (field: FieldKey, value: string) => {
    const node = nodeForValue(index, field, value);
    // "Diversified" marks a generalist investor; it is never a company's sector.
    if (node && node.kind !== GENERALIST_KIND && !sectorIds.some((s) => s.id === node.id)) {
      sectorIds.push({ id: node.id, label: node.label });
    }
  };
  engine.verticals.forEach((value) => push("vertical", value));
  if (lists.explicitIndustries || engine.verticals.length === 0) engine.industries.forEach((value) => push("industry", value));

  const sectors: SectorClass[] = sectorIds
    .slice(0, 1 + MAX_SECONDARY)
    .map((s, i) => ({ ...blank(s.id, s.label, source), role: i === 0 ? "primary" : "secondary" }));

  return {
    schema: PROFILE_SCHEMA,
    identity: { name: engine.name, website: engine.web, oneLiner: engine.oneliner },
    business: { product: null, businessModel: engine.model, customers: null, notCompanySectors: [] },
    sectors,
    stage: make("stage", engine.stage),
    hq: {
      country: make("hq_country", engine.country),
      state: engine.country === "United States" && lists.hqState ? make("hq_state", lists.hqState) : null,
      city: engine.city,
    },
    markets: dedupe(engine.markets.map((m) => make("geography", m))),
    financing: dedupe(engine.instruments.map((i) => make("financing", i))),
    firmTypes: dedupe((engine.firmTypes ?? []).map((t) => make("firm_type", t))),
    raise: { amount: engine.raise },
    exclusions: {
      existingInvestors: lists.existingInvestors,
      alreadyPitched: lists.alreadyPitched,
      noGo: lists.noGo,
      competitors: lists.competitors,
    },
    ambiguities: [],
    converterWarnings: meta.converterWarnings,
    provenance: { basis: meta.basis, interviewAt: meta.interviewAt, taxonomyRevision: index.taxonomy.revision },
  };
}

function dedupe(list: (Classification | null)[]) {
  const out: Classification[] = [];
  for (const item of list) if (item && !out.some((c) => c.nodeId === item.nodeId)) out.push(item);
  return out;
}

/**
 * Carries decisions and evidence over from the previous version wherever the
 * category is unchanged; anything new or changed becomes an admin decision.
 */
export function reconcile(previous: CompanyProfile | null, next: CompanyProfile, actor: string | null): CompanyProfile {
  if (!previous) return next;
  const carry = (prev: Classification | null | undefined, cur: Classification | null) => {
    if (!cur) return null;
    if (prev && prev.nodeId === cur.nodeId) return prev;
    return { ...cur, source: "admin" as const, status: "accepted" as const, decidedBy: actor, rationale: "Set in the profile editor." };
  };
  const carryList = (prev: Classification[], cur: Classification[]) =>
    cur.map((c) => carry(prev.find((p) => p.nodeId === c.nodeId), c)!);
  return {
    ...next,
    business: previous.business,
    ambiguities: previous.ambiguities,
    sectors: next.sectors.map((s) => {
      const prev = previous.sectors.find((p) => p.nodeId === s.nodeId);
      const kept = carry(prev, s)!;
      return { ...kept, role: s.role };
    }),
    stage: carry(previous.stage, next.stage),
    hq: {
      country: carry(previous.hq.country, next.hq.country),
      state: carry(previous.hq.state, next.hq.state),
      city: next.hq.city,
    },
    markets: carryList(previous.markets, next.markets),
    financing: carryList(previous.financing, next.financing),
    firmTypes: carryList(previous.firmTypes, next.firmTypes),
  };
}

// ---------------------------------------------------------------------------
// From the AI classification

export type AiClassInput = {
  node_id?: unknown;
  founder_stated?: unknown;
  evidence?: unknown;
  rationale?: unknown;
  confidence?: unknown;
};

export type AiClassification = {
  product?: unknown;
  product_evidence?: unknown;
  business_model?: unknown;
  customers?: unknown;
  customers_evidence?: unknown;
  not_company_sectors?: unknown;
  primary_sector?: AiClassInput;
  secondary_sectors?: unknown;
  stage?: AiClassInput;
  hq_country?: AiClassInput;
  ambiguities?: unknown;
};

const CONFIDENCE: Confidence[] = ["high", "medium", "low"];

/** One AI classification, checked: the category must be choosable and every quote is verified. */
export function readAiClass(
  raw: AiClassInput | undefined,
  index: TaxIndex,
  dimension: Dim,
  kinds: string[],
  transcript: string,
  problems: ProfileIssue[],
  field: string,
): Classification | null {
  if (!raw || typeof raw !== "object") return null;
  const nodeId = String(raw.node_id ?? "").trim();
  if (!nodeId) return null;
  if (!isChoosable(index, nodeId, dimension, kinds)) {
    problems.push({ field, severity: "blocking", message: `The AI chose "${nodeId}", which is not a valid ${dimension.replace("_", " ")} category.` });
    return null;
  }
  const evidence = cleanQuotes(raw.evidence, transcript);
  const rationale = String(raw.rationale ?? "").trim().slice(0, 800);
  const confidence = CONFIDENCE.includes(raw.confidence as Confidence) ? (raw.confidence as Confidence) : null;
  const claimsFounder = raw.founder_stated === true;
  const verified = evidence.some((e) => e.verified);
  if (claimsFounder && !verified) {
    problems.push({ field, severity: "limited", message: "Marked as stated by the founder, but no supplied quote was found in the founder's messages or files. Treated as an AI interpretation." });
  }
  const source: ClassSource = claimsFounder && verified ? "founder" : "ai";
  const solid = verified && rationale.length >= RATIONALE_MIN && confidence !== "low";
  return {
    nodeId,
    label: index.nodes.get(nodeId)!.label,
    source,
    evidence,
    rationale,
    confidence,
    status: solid ? "accepted" : "needs_confirmation",
    decidedBy: null,
    confirmedBy: null,
    confirmedAt: null,
  };
}

function textFact(text: unknown, evidence: unknown, transcript: string): TextFact | null {
  const value = String(text ?? "").trim().slice(0, 600);
  if (!value) return null;
  return { text: value, source: "ai", evidence: cleanQuotes(evidence, transcript) };
}

/**
 * Applies the AI's classification to a profile built from the same intake:
 * sectors, stage and HQ country come from the AI (checked); everything else
 * stays as derived from the answers.
 */
export function applyAiClassification(
  base: CompanyProfile,
  raw: AiClassification,
  index: TaxIndex,
  transcript: string,
): { profile: CompanyProfile; problems: ProfileIssue[] } {
  const problems: ProfileIssue[] = [];
  const primary = readAiClass(raw.primary_sector, index, "sector", SECTOR_KINDS, transcript, problems, "Primary sector");
  const secondaryRaw = Array.isArray(raw.secondary_sectors) ? (raw.secondary_sectors as AiClassInput[]) : [];
  if (secondaryRaw.length > MAX_SECONDARY) {
    problems.push({ field: "Secondary sectors", severity: "info", message: `The AI proposed ${secondaryRaw.length} secondary sectors; only the first ${MAX_SECONDARY} are kept.` });
  }
  const secondaries: SectorClass[] = [];
  for (const item of secondaryRaw.slice(0, MAX_SECONDARY)) {
    const c = readAiClass(item, index, "sector", SECTOR_KINDS, transcript, problems, "Secondary sector");
    if (c && c.nodeId !== primary?.nodeId && !secondaries.some((s) => s.nodeId === c.nodeId)) {
      secondaries.push({ ...c, role: "secondary" });
    }
  }
  const stage = readAiClass(raw.stage, index, "stage", STAGE_KINDS, transcript, problems, "Stage");
  const country = readAiClass(raw.hq_country, index, "geography", COUNTRY_KINDS, transcript, problems, "HQ country");

  // Where the AI gave nothing usable but the profile fields have a value, keep
  // that value, unconfirmed, instead of blocking.
  const fallback = (field: string, has: boolean) => {
    if (!has) return;
    for (const p of problems) {
      if (p.field === field && p.severity === "blocking") {
        p.severity = "limited";
        p.message += " Kept the value from the profile fields; confirm it.";
      }
    }
  };
  fallback("Primary sector", !primary && base.sectors.length > 0);
  fallback("Stage", !stage && Boolean(base.stage));
  fallback("HQ country", !country && Boolean(base.hq.country));
  const unconfirmed = <T extends Classification>(c: T): T => ({ ...c, status: c.status === "confirmed_founder" ? c.status : "needs_confirmation" });

  const notCompany = Array.isArray(raw.not_company_sectors)
    ? (raw.not_company_sectors as Record<string, unknown>[])
        .map((item) => ({ label: String(item?.label ?? "").trim().slice(0, 80), reason: String(item?.reason ?? "").trim().slice(0, 300) }))
        .filter((item) => item.label)
        .slice(0, 8)
    : [];
  const ambiguities = Array.isArray(raw.ambiguities)
    ? (raw.ambiguities as Record<string, unknown>[])
        .map((item) => ({ topic: String(item?.topic ?? "other").slice(0, 30), question: String(item?.question ?? "").trim().slice(0, 300) }))
        .filter((item) => item.question)
        .slice(0, 8)
    : [];

  return {
    profile: {
      ...base,
      business: {
        product: textFact(raw.product, raw.product_evidence, transcript),
        businessModel: base.business.businessModel || String(raw.business_model ?? "").trim().slice(0, 40),
        customers: textFact(raw.customers, raw.customers_evidence, transcript),
        notCompanySectors: notCompany,
      },
      sectors: primary ? [{ ...primary, role: "primary" as const }, ...secondaries] : base.sectors.map(unconfirmed),
      stage: stage ?? (base.stage ? unconfirmed(base.stage) : null),
      hq: {
        ...base.hq,
        country: acceptIfNamed(country ?? (base.hq.country ? unconfirmed(base.hq.country) : null), transcript),
        state: acceptIfNamed(base.hq.state, transcript),
      },
      ambiguities,
    },
    problems,
  };
}

/** The engine's sector answers for the profile's sectors, primary first. Categories the engine can't use are reported. */
export function sectorAnswers(profile: CompanyProfile, index: TaxIndex) {
  const verticals: string[] = [];
  const industries: string[] = [];
  const unusable: string[] = [];
  for (const sector of profile.sectors) {
    const known = engineValue(index, sector.nodeId, ["vertical", "industry"]);
    if (!known) unusable.push(sector.label);
    else if (known.field === "vertical") verticals.push(known.value);
    else industries.push(known.value);
  }
  return { verticals, industries, unusable };
}

// ---------------------------------------------------------------------------
// Validation and readiness

/**
 * Issues and readiness. Blocking: matching would be wrong without a fix.
 * Limited: a match can run but something material is unconfirmed or missing.
 * This is displayed only; the current engine's own gate is unchanged.
 */
export function validateProfile(profile: CompanyProfile, index: TaxIndex, extra: ProfileIssue[] = []) {
  const issues: ProfileIssue[] = [...extra];
  const add = (field: string, severity: IssueSeverity, message: string) => issues.push({ field, severity, message });

  const checkNode = (c: Classification | null, field: string, dimension: Dim, kinds: string[]) => {
    if (c && !isChoosable(index, c.nodeId, dimension, kinds)) {
      add(field, "blocking", `"${c.label}" is not a valid, active ${dimension.replace("_", " ")} category.`);
      return false;
    }
    return true;
  };
  const needsConfirming = (c: Classification, field: string) => {
    if (c.status === "needs_confirmation") {
      const why = c.source === "legacy"
        ? "saved before evidence was recorded"
        : verifiedCount(c) === 0
          ? "nothing the founder said or shared supports it"
          : c.rationale.length < RATIONALE_MIN
            ? "the reasoning is missing"
            : "the AI's confidence is low";
      add(field, "limited", `${c.label}: needs confirmation (${why}).`);
    }
  };

  const primaries = profile.sectors.filter((s) => s.role === "primary");
  const secondaries = profile.sectors.filter((s) => s.role === "secondary");
  if (primaries.length === 0) add("Primary sector", "blocking", "No primary sector.");
  if (primaries.length > 1) add("Primary sector", "blocking", "More than one primary sector.");
  if (secondaries.length > MAX_SECONDARY) add("Secondary sectors", "blocking", `More than ${MAX_SECONDARY} secondary sectors.`);
  for (const sector of profile.sectors) {
    const field = sector.role === "primary" ? "Primary sector" : "Secondary sector";
    if (!checkNode(sector, field, "sector", SECTOR_KINDS)) continue;
    if (sector.role === "primary") needsConfirming(sector, field);
    if (sector.role === "secondary" && sector.source !== "legacy" && sector.status !== "confirmed_founder" && sector.source !== "admin") {
      if (verifiedCount(sector) === 0 || sector.rationale.length < RATIONALE_MIN) {
        add(field, "limited", `${sector.label}: a secondary sector needs its own founder evidence and justification.`);
      }
    }
    if (sector.role === "primary" && index.nodes.get(sector.nodeId)?.attrs.granularity === "broad") {
      add(field, "info", `${sector.label} is a broad industry. Use a more specific sector if the business evidence supports one.`);
    }
  }

  if (!profile.stage) add("Stage", "blocking", "No stage.");
  else if (checkNode(profile.stage, "Stage", "stage", STAGE_KINDS)) needsConfirming(profile.stage, "Stage");
  if (!profile.hq.country) add("HQ country", "blocking", "No HQ country.");
  else if (checkNode(profile.hq.country, "HQ country", "geography", COUNTRY_KINDS) && profile.hq.country.source !== "legacy") {
    needsConfirming(profile.hq.country, "HQ country");
  }
  if (profile.hq.country?.nodeId === "geo.us" && !profile.hq.state) add("HQ state", "limited", "US company without a state: regional US investors can't be checked.");
  if (profile.hq.state && profile.hq.state.source !== "legacy") needsConfirming(profile.hq.state, "HQ state");

  // A quote that couldn't be found matters only while the sector is undecided.
  for (const sector of profile.sectors) {
    if (sector.status === "confirmed_founder" || sector.source === "admin") continue;
    for (const e of sector.evidence) {
      if (!e.verified) add(sector.role === "primary" ? "Primary sector" : "Secondary sector", "limited", `Quote not found in the founder's messages or files: "${e.quote.slice(0, 80)}".`);
    }
  }
  for (const a of profile.ambiguities) add("To clarify", "limited", a.question);
  for (const w of profile.converterWarnings) add("Consistency", "limited", w);

  if (profile.sectors.some((s) => s.source === "legacy")) add("Profile", "info", "Legacy profile: no evidence was recorded. Rebuild from the intake to collect it.");

  const readiness: Readiness = issues.some((i) => i.severity === "blocking")
    ? "blocked"
    : issues.some((i) => i.severity === "limited")
      ? "limited"
      : "ready";
  return { issues, readiness };
}

/**
 * Problems recorded when the profile was built stay open only while the
 * classification they are about is still undecided: an admin decision or a
 * founder confirmation settles them.
 */
export function openBuildProblems(profile: CompanyProfile, problems: ProfileIssue[]) {
  const settled = (c: Classification | null | undefined) => Boolean(c && (c.source === "admin" || c.status === "confirmed_founder"));
  const primary = profile.sectors.find((s) => s.role === "primary");
  const secondaries = profile.sectors.filter((s) => s.role === "secondary");
  return problems.filter((p) => {
    if (p.field === "Primary sector") return !settled(primary);
    if (p.field === "Secondary sector" || p.field === "Secondary sectors") return !secondaries.every(settled);
    if (p.field === "Stage") return !settled(profile.stage);
    if (p.field === "HQ country") return !settled(profile.hq.country);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Admin changes

/** Marks one classification as confirmed with the founder. Path: "sector:<nodeId>", "stage", "hq_country", "hq_state". */
export function confirmWithFounder(profile: CompanyProfile, path: string, actor: string | null, at: string): CompanyProfile | null {
  const stamp = (c: Classification): Classification => ({ ...c, status: "confirmed_founder", confirmedBy: actor, confirmedAt: at });
  if (path.startsWith("sector:")) {
    const id = path.slice("sector:".length);
    if (!profile.sectors.some((s) => s.nodeId === id)) return null;
    return { ...profile, sectors: profile.sectors.map((s) => (s.nodeId === id ? { ...stamp(s), role: s.role } : s)) };
  }
  if (path === "stage" && profile.stage) return { ...profile, stage: stamp(profile.stage) };
  if (path === "hq_country" && profile.hq.country) return { ...profile, hq: { ...profile.hq, country: stamp(profile.hq.country) } };
  if (path === "hq_state" && profile.hq.state) return { ...profile, hq: { ...profile.hq, state: stamp(profile.hq.state) } };
  return null;
}

/**
 * Sets the sectors by an admin: primary plus up to two secondary. Unchanged
 * categories keep their evidence; new ones are admin decisions with the
 * admin's reason.
 */
export function setSectors(
  profile: CompanyProfile,
  index: TaxIndex,
  input: { primary: string; secondary: string[]; rationale: string },
  actor: string | null,
): { ok: true; profile: CompanyProfile } | { ok: false; error: string } {
  const ids = [input.primary, ...input.secondary.filter((id) => id && id !== input.primary)];
  if (!input.primary) return { ok: false, error: "Pick a primary sector." };
  if (ids.length - 1 > MAX_SECONDARY) return { ok: false, error: `At most ${MAX_SECONDARY} secondary sectors.` };
  if (new Set(ids).size !== ids.length) return { ok: false, error: "A sector is listed twice." };
  for (const id of ids) {
    if (!isChoosable(index, id, "sector", SECTOR_KINDS)) return { ok: false, error: `"${id}" is not a sector you can choose.` };
  }
  const rationale = input.rationale.trim().slice(0, 800);
  const changed = ids.join("|") !== profile.sectors.map((s) => s.nodeId).join("|");
  if (changed && rationale.length < RATIONALE_MIN) return { ok: false, error: `Explain the change (at least ${RATIONALE_MIN} characters).` };
  const sectors: SectorClass[] = ids.map((id, i) => {
    const role: SectorRole = i === 0 ? "primary" : "secondary";
    const prev = profile.sectors.find((s) => s.nodeId === id);
    if (prev) return { ...prev, role };
    return { ...blank(id, index.nodes.get(id)!.label, "admin", { rationale, decidedBy: actor }), role };
  });
  return { ok: true, profile: { ...profile, sectors } };
}

// ---------------------------------------------------------------------------
// The interface for matching (Phase 3)

export type MatchingProfile = {
  primarySector: string | null;
  secondarySectors: string[];
  stage: string | null;
  hqCountry: string | null;
  hqState: string | null;
  markets: string[];
  financing: string[];
  firmTypes: string[];
  exclusions: CompanyProfile["exclusions"];
  readiness: Readiness;
  issues: ProfileIssue[];
  /** Classifications not yet confirmed, by category id. Phase 3 decides how to treat them. */
  unconfirmed: string[];
};

export function matchingProfile(profile: CompanyProfile, index: TaxIndex): MatchingProfile {
  const { issues, readiness } = validateProfile(profile, index);
  const all = [...profile.sectors, profile.stage, profile.hq.country, profile.hq.state].filter(
    (c): c is Classification => Boolean(c),
  );
  return {
    primarySector: profile.sectors.find((s) => s.role === "primary")?.nodeId ?? null,
    secondarySectors: profile.sectors.filter((s) => s.role === "secondary").map((s) => s.nodeId),
    stage: profile.stage?.nodeId ?? null,
    hqCountry: profile.hq.country?.nodeId ?? null,
    hqState: profile.hq.state?.nodeId ?? null,
    markets: profile.markets.map((m) => m.nodeId),
    financing: profile.financing.map((f) => f.nodeId),
    firmTypes: profile.firmTypes.map((f) => f.nodeId),
    exclusions: profile.exclusions,
    readiness,
    issues,
    unconfirmed: all.filter((c) => c.status === "needs_confirmation").map((c) => c.nodeId),
  };
}

/** Lists from the saved answers (one per line; "none" is an empty list). */
export function answerList(value: unknown) {
  const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  if (/^\s*(none|no|n\/a|na|nothing|not yet|nobody|-)\s*$/i.test(text)) return [];
  return text
    .split(/[\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** A stable fingerprint of saved answers, to spot changes made outside the classification. */
export function answersBasis(answers: Record<string, unknown>) {
  const keys = Object.keys(answers).sort();
  return JSON.stringify(keys.map((key) => [key, answers[key]]));
}
