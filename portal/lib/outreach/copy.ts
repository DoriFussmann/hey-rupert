// Outreach copy v2: investor email copy by fund type. Pure module, safe on the
// server and in the browser.
//
// Core funds get a per-fund-type approach and a template with a personalized
// slot ({{quick_fact}}); the per-contact Core emails are written from it later.
// Sphere, Tier 3 and Tier 4 share one sequence per fund type, with one "why
// you" line per tier inserted as {{tier_line}}.
// How each group is written is set by admin style presets (section × type).
// See claude/rupert-outreach-spec.md in the project.

import type { CopyEmail, InvestorListPayload, InvestorRow } from "../setup.ts";

export const SEQUENCE_LENGTH = 3;

// ---------------------------------------------------------------------------
// Fund types

export const FUND_TYPES = ["VC", "Family office", "Angel group", "PE", "Other"] as const;
export type FundTypeKey = (typeof FUND_TYPES)[number];

/** A type with fewer funds than this in a section is written as part of Other. */
export const MIN_TYPE_FUNDS = 3;

/** The list row's short fund type (firmTypeLabel) as a copy group. */
export function fundTypeKey(value: string | null | undefined): FundTypeKey {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return "Other";
  if (v === "vc" || v.includes("venture")) return "VC";
  if (v.includes("family")) return "Family office";
  if (v.includes("angel")) return "Angel group";
  if (v === "pe" || v.includes("private equity")) return "PE";
  return "Other";
}

export function asFundTypeKey(value: unknown): FundTypeKey | null {
  return (FUND_TYPES as readonly string[]).includes(String(value)) ? (value as FundTypeKey) : null;
}

// ---------------------------------------------------------------------------
// Sections and tiers

export type CopySection = "core" | "others";
export const COPY_SECTIONS: CopySection[] = ["core", "others"];
export const SECTION_LABEL: Record<CopySection, string> = {
  core: "Core",
  others: "Sphere, Tier 3 and Tier 4",
};

export type OtherTier = 2 | 3 | 4;
export const OTHER_TIERS: OtherTier[] = [2, 3, 4];
export const OTHER_TIER_LABEL: Record<OtherTier, string> = { 2: "Sphere", 3: "Tier 3", 4: "Tier 4" };

/** Copy tier of a four-tier list row. Approved generalists go with Tier 4. */
export function copyTierOf(row: Pick<InvestorRow, "tier" | "broad">): 1 | OtherTier {
  if (row.broad) return 4;
  return row.tier === 1 || row.tier === 2 || row.tier === 3 ? row.tier : 4;
}

/** Note key and label for one group, used by the client's per-group notes. */
export function groupKey(section: CopySection, type: FundTypeKey) {
  return `${section}:${type}`;
}

export function groupLabel(section: CopySection, type: FundTypeKey) {
  return `${SECTION_LABEL[section]} · ${type}`;
}

// ---------------------------------------------------------------------------
// Which funds are in the outreach

/**
 * Rows that go into automated outreach. Funds the client excluded never do.
 * Funds the client marked "I know them" are left out (the client approaches
 * them directly) unless Rupert put them back (`overrides`, by row id).
 */
export function outreachRows(list: Pick<InvestorListPayload, "rows" | "client_flags">, overrides: ReadonlySet<string> = new Set()) {
  const flags = list.client_flags ?? {};
  const rows: InvestorRow[] = [];
  const knownLeftOut: InvestorRow[] = [];
  for (const row of list.rows) {
    if (row.hidden_duplicate) continue;
    const flag = flags[row.id];
    if (flag?.excluded) continue;
    if (flag?.known && !overrides.has(row.id)) {
      knownLeftOut.push(row);
      continue;
    }
    rows.push(row);
  }
  return { rows, knownLeftOut };
}

export type TypeGroup = {
  section: CopySection;
  type: FundTypeKey;
  funds: number;
  /** Funds per copy tier (Core: tier 1 only). */
  tiers: Partial<Record<1 | OtherTier, number>>;
  /** Types written as part of Other because they were too small. */
  merged: FundTypeKey[];
};

/** The copy groups for a set of rows: per section, per fund type, small types merged into Other. */
export function typeGroups(rows: InvestorRow[]): Record<CopySection, TypeGroup[]> {
  const result: Record<CopySection, TypeGroup[]> = { core: [], others: [] };
  for (const section of COPY_SECTIONS) {
    const counts = new Map<FundTypeKey, Partial<Record<1 | OtherTier, number>>>();
    for (const row of rows) {
      const tier = copyTierOf(row);
      if ((section === "core") !== (tier === 1)) continue;
      const type = fundTypeKey(row.fund_type);
      const tiers = counts.get(type) ?? {};
      tiers[tier] = (tiers[tier] ?? 0) + 1;
      counts.set(type, tiers);
    }
    const total = (tiers: Partial<Record<number, number>>) =>
      Object.values(tiers).reduce<number>((sum, n) => sum + (n ?? 0), 0);

    const other: TypeGroup = { section, type: "Other", funds: 0, tiers: {}, merged: [] };
    const kept: TypeGroup[] = [];
    for (const type of FUND_TYPES) {
      const tiers = counts.get(type);
      if (!tiers) continue;
      const funds = total(tiers);
      if (type === "Other" || funds < MIN_TYPE_FUNDS) {
        other.funds += funds;
        for (const [tier, n] of Object.entries(tiers)) {
          const key = Number(tier) as 1 | OtherTier;
          other.tiers[key] = (other.tiers[key] ?? 0) + (n ?? 0);
        }
        if (type !== "Other") other.merged.push(type);
      } else {
        kept.push({ section, type, funds, tiers, merged: [] });
      }
    }
    // A lone small type stays itself: merging it into an empty Other only renames it.
    if (other.funds > 0 && kept.length === 0 && other.merged.length === 1 && !counts.has("Other")) {
      kept.push({ ...other, type: other.merged[0], merged: [] });
    } else if (other.funds > 0) {
      kept.push(other);
    }
    result[section] = kept;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Style presets (admin-controlled)

export type CtaKind = "question" | "short_call" | "reply";
export const CTA_LABEL: Record<CtaKind, string> = {
  question: "One direct question",
  short_call: "Ask for a short call",
  reply: "Ask for a reply",
};

export type StylePreset = {
  id: string;
  label: string;
  /** How emails in this style are written. Given to the AI as instructions. */
  rules: string;
  /** Cap for the first email's body. Follow-ups: three quarters of it. */
  max_words: number;
  /** Proof points per email. */
  proof_points: number;
  cta: CtaKind;
  /** A model email. The AI copies its shape, never its facts. */
  example: string;
};

export type OutreachStyles = {
  presets: StylePreset[];
  /** Preset id per `section:type`; `section:*` is the section default. */
  matrix: Record<string, string>;
  /** Added under the first email of every sequence. Human, one line. */
  opt_out_line: string;
};

export const DEFAULT_PRESET_ID = "direct";

export const DEFAULT_OPT_OUT_LINE = "If this isn't relevant, tell me and I won't follow up.";

export const DEFAULT_PRESETS: StylePreset[] = [
  {
    id: "direct",
    label: "Direct",
    rules: [
      "Open with the founder's name and company in the first line.",
      "One short line that respects their time and promises brevity, then keep the promise.",
      "Then three short factual lines, one fact each, no adjectives: what the company does, the strongest proof, the round.",
      "End with one clear ask, phrased as a question.",
      "Sign off with the founder's first name only. No pleasantries, no hype, no exclamation marks.",
    ].join("\n"),
    max_words: 80,
    proof_points: 2,
    cta: "question",
    example: [
      "Hi {{first_name}},",
      "",
      "I'm Dana, founder of Ledgerline. Your time is short, so three lines:",
      "",
      "We automate month-end close for 40-person finance teams.",
      "$38k MRR, up 3x since January.",
      "Raising a $2M seed.",
      "",
      "Is this a fit for {{fund_name}}?",
      "",
      "Dana",
    ].join("\n"),
  },
  {
    id: "brief_personal",
    label: "Brief and personal",
    rules: [
      "Two short paragraphs. Open with why this investor, in one sentence.",
      "Then what the company does and one proof point.",
      "Ask for a 20-minute call. Sign off with the founder's first name. No hype, no exclamation marks.",
    ].join("\n"),
    max_words: 110,
    proof_points: 1,
    cta: "short_call",
    example: [
      "Hi {{first_name}},",
      "",
      "{{fund_name}} backs early fintech infrastructure, which is why I'm writing. I'm Dana, founder of Ledgerline: we automate month-end close for mid-size finance teams, and we're at $38k MRR, up 3x since January.",
      "",
      "We're raising a $2M seed. Would a 20-minute call next week work?",
      "",
      "Dana",
    ].join("\n"),
  },
  {
    id: "thesis_led",
    label: "Thesis-led",
    rules: [
      "Open with the link between the investor's stated focus and the company, in one sentence.",
      "Then one sentence on what the company does and two proof points as short lines.",
      "Close with a direct question about fit. Sign off with the founder's first name. No hype, no exclamation marks.",
    ].join("\n"),
    max_words: 110,
    proof_points: 2,
    cta: "question",
    example: [
      "Hi {{first_name}},",
      "",
      "{{quick_fact}}, and that's the problem we solve. I'm Dana, founder of Ledgerline: month-end close, automated, for mid-size finance teams.",
      "",
      "$38k MRR, up 3x since January.",
      "12 customers, none lost.",
      "",
      "We're raising a $2M seed. Worth a conversation?",
      "",
      "Dana",
    ].join("\n"),
  },
];

/** A style as instructions for the AI writers. */
export function styleInstructions(preset: StylePreset) {
  return [
    `Style: ${preset.label}`,
    `Rules:\n${preset.rules || "Short, plain, factual."}`,
    `Word cap: first email ${preset.max_words} words; each follow-up ${Math.round(preset.max_words * 0.75)}.`,
    `Proof points per email: ${preset.proof_points}.`,
    `Call to action: ${CTA_LABEL[preset.cta]}.`,
    preset.example ? `Example (copy its shape, never its facts):\n${preset.example}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function defaultOutreachStyles(): OutreachStyles {
  return {
    presets: DEFAULT_PRESETS.map((preset) => ({ ...preset })),
    matrix: { "core:*": DEFAULT_PRESET_ID, "others:*": DEFAULT_PRESET_ID },
    opt_out_line: DEFAULT_OPT_OUT_LINE,
  };
}

export function matrixKey(section: CopySection, type: FundTypeKey | "*") {
  return `${section}:${type}`;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value : "").slice(0, max);
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const asCta = (value: unknown): CtaKind =>
  value === "short_call" || value === "reply" || value === "question" ? value : "question";

export const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function asStylePreset(value: unknown): StylePreset | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 40).trim();
  const label = text(raw.label, 60).trim();
  if (!PRESET_ID_PATTERN.test(id) || !label) return null;
  return {
    id,
    label,
    rules: text(raw.rules, 4000).trim(),
    max_words: clampInt(raw.max_words, 30, 400, 100),
    proof_points: clampInt(raw.proof_points, 0, 5, 1),
    cta: asCta(raw.cta),
    example: text(raw.example, 4000).trim(),
  };
}

/** Stored styles, cleaned. Always has at least one preset and valid matrix entries. */
export function asOutreachStyles(value: unknown): OutreachStyles {
  const defaults = defaultOutreachStyles();
  if (!value || typeof value !== "object") return defaults;
  const raw = value as Record<string, unknown>;
  const seen = new Set<string>();
  const presets: StylePreset[] = [];
  for (const item of Array.isArray(raw.presets) ? raw.presets : []) {
    const preset = asStylePreset(item);
    if (preset && !seen.has(preset.id)) {
      seen.add(preset.id);
      presets.push(preset);
    }
  }
  const finalPresets = presets.length > 0 ? presets : defaults.presets;
  const ids = new Set(finalPresets.map((preset) => preset.id));
  const fallback = ids.has(DEFAULT_PRESET_ID) ? DEFAULT_PRESET_ID : finalPresets[0].id;
  const matrix: Record<string, string> = {};
  const rawMatrix = raw.matrix && typeof raw.matrix === "object" ? (raw.matrix as Record<string, unknown>) : {};
  for (const section of COPY_SECTIONS) {
    for (const type of ["*", ...FUND_TYPES] as const) {
      const key = matrixKey(section, type);
      const id = String(rawMatrix[key] ?? "");
      if (ids.has(id)) matrix[key] = id;
    }
    matrix[matrixKey(section, "*")] ??= fallback;
  }
  const optOut = text(raw.opt_out_line, 300).trim();
  return { presets: finalPresets, matrix, opt_out_line: optOut || (raw.opt_out_line === "" ? "" : DEFAULT_OPT_OUT_LINE) };
}

/** The preset that writes one group: its own setting, else the section default. */
export function presetFor(styles: OutreachStyles, section: CopySection, type: FundTypeKey): StylePreset {
  const id = styles.matrix[matrixKey(section, type)] ?? styles.matrix[matrixKey(section, "*")];
  return styles.presets.find((preset) => preset.id === id) ?? styles.presets[0];
}

// ---------------------------------------------------------------------------
// The copy

export type StyleSnapshot = { id: string; label: string; max_words: number };

export type TypedGroupCopy = {
  type: FundTypeKey;
  funds: number;
  /** Types written as part of Other. */
  merged?: FundTypeKey[];
  /** Funds per tier, for the tier lines and the client's counts. */
  tiers?: Partial<Record<"1" | "2" | "3" | "4", number>>;
  /** The preset used, frozen with the copy. */
  style: StyleSnapshot;
  /** Core: what this kind of investor cares about and how the emails lead. */
  approach: string;
  emails: CopyEmail[];
  /** Sphere, Tier 3, Tier 4: the "why you" sentence, inserted as {{tier_line}}. */
  tier_lines?: Partial<Record<"2" | "3" | "4", string>>;
};

export type TypedCopy = {
  core: TypedGroupCopy[];
  others: TypedGroupCopy[];
  opt_out_line: string;
  /** The saved match run the investor list came from. */
  run_id?: string;
};

export const MERGE_FIELDS: Record<CopySection, string[]> = {
  core: ["first_name", "fund_name", "quick_fact"],
  others: ["first_name", "fund_name", "tier_line"],
};

export const MERGE_FIELD_HELP: Record<string, string> = {
  first_name: "The investor's first name",
  fund_name: "The fund's name",
  quick_fact: "One researched fact about this fund or person (Core, written per contact)",
  tier_line: "Why this investor, one sentence for their tier (Sphere, Tier 3, Tier 4)",
};

function emptySequence(): CopyEmail[] {
  return Array.from({ length: SEQUENCE_LENGTH }, () => ({ subject: "", body: "" }));
}

function snapshot(preset: StylePreset): StyleSnapshot {
  return { id: preset.id, label: preset.label, max_words: preset.max_words };
}

function tierCounts(group: TypeGroup): TypedGroupCopy["tiers"] {
  const out: TypedGroupCopy["tiers"] = {};
  for (const [tier, n] of Object.entries(group.tiers)) {
    if (n) out[tier as "1"] = n;
  }
  return out;
}

/** Empty copy for the given groups, each with the style that will write it. */
export function emptyTypedCopy(groups: Record<CopySection, TypeGroup[]>, styles: OutreachStyles, runId?: string): TypedCopy {
  const build = (section: CopySection) =>
    groups[section].map((group) => ({
      type: group.type,
      funds: group.funds,
      ...(group.merged.length ? { merged: group.merged } : {}),
      tiers: tierCounts(group),
      style: snapshot(presetFor(styles, section, group.type)),
      approach: "",
      emails: emptySequence(),
      ...(section === "others" ? { tier_lines: {} } : {}),
    }));
  return { core: build("core"), others: build("others"), opt_out_line: styles.opt_out_line, ...(runId ? { run_id: runId } : {}) };
}

function asEmail(value: unknown): CopyEmail {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { subject: text(raw.subject, 300), body: text(raw.body, 10000) };
}

function asGroup(value: unknown, section: CopySection): TypedGroupCopy | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const type = asFundTypeKey(raw.type);
  if (!type) return null;
  const styleRaw = (raw.style && typeof raw.style === "object" ? raw.style : {}) as Record<string, unknown>;
  const list = Array.isArray(raw.emails) ? raw.emails : [];
  const merged = Array.isArray(raw.merged)
    ? raw.merged.map(asFundTypeKey).filter((item): item is FundTypeKey => Boolean(item))
    : [];
  const tiersRaw = (raw.tiers && typeof raw.tiers === "object" ? raw.tiers : {}) as Record<string, unknown>;
  const tiers: TypedGroupCopy["tiers"] = {};
  for (const key of ["1", "2", "3", "4"] as const) {
    const n = clampInt(tiersRaw[key], 0, 100000, 0);
    if (n) tiers[key] = n;
  }
  const group: TypedGroupCopy = {
    type,
    funds: clampInt(raw.funds, 0, 100000, 0),
    ...(merged.length ? { merged } : {}),
    tiers,
    style: {
      id: text(styleRaw.id, 40) || DEFAULT_PRESET_ID,
      label: text(styleRaw.label, 60) || "Direct",
      max_words: clampInt(styleRaw.max_words, 30, 400, 100),
    },
    approach: text(raw.approach, 4000),
    emails: Array.from({ length: SEQUENCE_LENGTH }, (_, index) => asEmail(list[index])),
  };
  if (section === "others") {
    const linesRaw = (raw.tier_lines && typeof raw.tier_lines === "object" ? raw.tier_lines : {}) as Record<string, unknown>;
    const lines: NonNullable<TypedGroupCopy["tier_lines"]> = {};
    for (const key of ["2", "3", "4"] as const) {
      const line = text(linesRaw[key], 600);
      if (line) lines[key] = line;
    }
    group.tier_lines = lines;
  }
  return group;
}

export function asTypedCopy(value: unknown): TypedCopy {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const groups = (section: CopySection) => {
    const seen = new Set<FundTypeKey>();
    const out: TypedGroupCopy[] = [];
    for (const item of Array.isArray(raw[section]) ? (raw[section] as unknown[]) : []) {
      const group = asGroup(item, section);
      if (group && !seen.has(group.type)) {
        seen.add(group.type);
        out.push(group);
      }
    }
    return out;
  };
  const runId = text(raw.run_id, 100).trim();
  return {
    core: groups("core"),
    others: groups("others"),
    opt_out_line: text(raw.opt_out_line, 300).trim(),
    ...(runId ? { run_id: runId } : {}),
  };
}

export function typedHasContent(copy: TypedCopy) {
  return [...copy.core, ...copy.others].some(
    (group) => group.approach.trim() || group.emails.some((email) => email.subject.trim() || email.body.trim()),
  );
}

// ---------------------------------------------------------------------------
// Checks

export const HYPE_WORDS = [
  "revolutionary",
  "revolutionize",
  "game-changing",
  "game changer",
  "game-changer",
  "excited",
  "thrilled",
  "unique",
  "disruptive",
  "groundbreaking",
  "cutting-edge",
  "world-class",
  "best-in-class",
  "synergy",
  "unicorn",
];

export const SEQUENCE_LABELS = ["First email", "Follow-up 1", "Follow-up 2"];

export type CopyIssue = { level: "error" | "warning"; where: string; text: string };

export function wordCount(body: string) {
  return body.trim() ? body.trim().split(/\s+/).length : 0;
}

/** Merge fields used in a text: {{name}}. */
export function mergeFieldsIn(value: string) {
  return Array.from(value.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g), (match) => match[1]);
}

/** Problems in one email of a group. */
export function emailIssues(
  email: CopyEmail,
  index: number,
  section: CopySection,
  maxWords: number,
  where: string,
  /** Merge fields allowed; defaults to the section's. A fully written email allows none. */
  allowedFields?: string[],
): CopyIssue[] {
  const issues: CopyIssue[] = [];
  const at = `${where}, ${SEQUENCE_LABELS[index] ?? `Email ${index + 1}`}`;
  const all = `${email.subject}\n${email.body}`;
  if (index === 0 && !email.subject.trim()) issues.push({ level: "error", where: at, text: "needs a subject." });
  if (!email.body.trim()) {
    issues.push({ level: "error", where: at, text: "has no body." });
    return issues;
  }
  if (/^\s*(re|fwd?|fw)\s*:/i.test(email.subject)) {
    issues.push({ level: "error", where: at, text: "the subject pretends to be a reply or forward." });
  }
  const allowed = allowedFields ?? MERGE_FIELDS[section];
  for (const field of mergeFieldsIn(all)) {
    if (!allowed.includes(field)) {
      issues.push({
        level: "error",
        where: at,
        text: allowed.length
          ? `uses {{${field}}}, which isn't available here (${allowed.map((f) => `{{${f}}}`).join(", ")}).`
          : `still has {{${field}}}; this email is written for one person, so fill it in.`,
      });
    }
  }
  if (/\[[A-Z][^\]\n]{0,40}\]/.test(all)) {
    issues.push({ level: "error", where: at, text: "has a leftover [placeholder]." });
  }
  if (all.includes("!")) issues.push({ level: "error", where: at, text: "has an exclamation mark." });
  const lower = all.toLowerCase();
  const hype = HYPE_WORDS.filter((word) => new RegExp(`\\b${word.replace(/[-\s]/g, "[-\\s]")}\\b`).test(lower));
  if (hype.length) issues.push({ level: "error", where: at, text: `uses hype words: ${hype.join(", ")}.` });
  if (/hope (this|the) (email|message) finds you/i.test(all)) {
    issues.push({ level: "error", where: at, text: "uses \"hope this email finds you well\"." });
  }
  const cap = index === 0 ? maxWords : Math.round(maxWords * 0.75);
  const words = wordCount(email.body);
  if (words > cap) issues.push({ level: "warning", where: at, text: `is ${words} words; the style allows ${cap}.` });
  return issues;
}

/** Every problem in the copy. Errors stop the push; warnings are shown. */
export function typedCopyIssues(copy: TypedCopy): CopyIssue[] {
  const issues: CopyIssue[] = [];
  if (copy.core.length + copy.others.length === 0) {
    issues.push({ level: "error", where: "Email copy", text: "has no fund groups. Draft it from the confirmed list." });
  }
  for (const section of COPY_SECTIONS) {
    for (const group of copy[section]) {
      const where = groupLabel(section, group.type);
      if (section === "core" && !group.approach.trim()) {
        issues.push({ level: "error", where, text: "needs an approach." });
      }
      group.emails.forEach((email, index) => {
        issues.push(...emailIssues(email, index, section, group.style.max_words, where));
      });
      if (section === "others") {
        const usesLine = group.emails.some((email) => mergeFieldsIn(email.body).includes("tier_line"));
        for (const tier of OTHER_TIERS) {
          if (!group.tiers?.[`${tier}`]) continue;
          const line = group.tier_lines?.[`${tier}`]?.trim() ?? "";
          if (!line && usesLine) {
            issues.push({ level: "error", where, text: `needs a ${OTHER_TIER_LABEL[tier]} line ({{tier_line}}).` });
          }
          if (line) {
            for (const field of mergeFieldsIn(line)) {
              if (field !== "fund_name") {
                issues.push({ level: "error", where, text: `the ${OTHER_TIER_LABEL[tier]} line uses {{${field}}}; only {{fund_name}} is allowed there.` });
              }
            }
            if (line.includes("!")) issues.push({ level: "error", where, text: `the ${OTHER_TIER_LABEL[tier]} line has an exclamation mark.` });
          }
        }
        if (!usesLine && Object.keys(group.tiers ?? {}).length > 1) {
          issues.push({ level: "warning", where, text: "doesn't use {{tier_line}}, so every tier reads the same." });
        }
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Rendering

/** Fills merge fields that have a value; others stay as {{field}}. Adds the opt-out line. */
export function renderEmail(email: CopyEmail, values: Record<string, string>, optOutLine: string): CopyEmail {
  const fill = (value: string) =>
    value.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (match, field: string) => {
      const filled = values[field];
      return filled == null ? match : filled;
    });
  const body = fill(email.body).trimEnd();
  const optOut = optOutLine.trim();
  return { subject: fill(email.subject), body: optOut ? `${body}\n\n${optOut}` : body };
}

/** The opt-out line goes under the first email only; the follow-ups sit in the same thread. */
export function optOutFor(index: number, optOutLine: string) {
  return index === 0 ? optOutLine : "";
}

/** One group's email for one tier: {{tier_line}} filled for Sphere, Tier 3 and Tier 4. */
export function renderForTier(group: TypedGroupCopy, index: number, tier: OtherTier | null, values: Record<string, string>, optOutLine: string) {
  const email = group.emails[index] ?? { subject: "", body: "" };
  const tierLine = tier ? group.tier_lines?.[`${tier}`] : undefined;
  const merged = tierLine != null ? { ...values, tier_line: renderEmail({ subject: "", body: tierLine }, values, "").body } : values;
  return renderEmail(email, merged, optOutFor(index, optOutLine));
}
