import "server-only";
import RME, { type Level, type MatchProfile, type Tier } from "@/lib/match/engine/index.mjs";
import { intakeToProfile } from "@/lib/match/intake/to-profile.mjs";
import questionBank from "@/lib/match/intake/intake-questions.json";
import { callClaudeTool } from "@/lib/anthropic";
import { loadAgentPrompts } from "@/lib/agents-server";
import { intakeMessageText, type IntakeInterview } from "@/lib/intake";
import {
  BUSINESS_MODELS,
  DEFAULT_SETTINGS,
  FIRM_TYPES,
  MARKETS,
  MATCH_FIELDS,
  SITE_N_OPTIONS,
  US_STATES,
  fieldLabel,
  isListField,
  type MatchAnswers,
  type MatchField,
  type MatchProfileState,
  type MatchSettings,
  type ProfileGap,
} from "@/lib/match/shared";
import { matchTableError } from "@/lib/match/db-server";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { AiClassification } from "@/lib/company-profile/core";
import { CLASSIFICATION_PROPERTY, classificationRules } from "@/lib/company-profile/prompt";
import type { TaxIndex } from "@/lib/taxonomy/core";

type ServiceClient = ReturnType<typeof createServiceClient>;

const TEXT_MAX = 2000;
const LEVELS: Level[] = [-3, -2, -1, 0, 1, 2, 3];

function allowedValues(field: MatchField): string[] | null {
  switch (field.kind) {
    case "stage":
      return [...RME.VC_LADDER, ...RME.PE_STAGES];
    case "model":
      return BUSINESS_MODELS;
    case "lead":
      return ["Yes", "No"];
    case "verticals":
      return RME.VERTICALS;
    case "industries":
      return RME.INDUSTRIES;
    case "country":
      return RME.COUNTRIES;
    case "state":
      return US_STATES;
    case "markets":
      return MARKETS;
    case "investor_types":
      return [...FIRM_TYPES];
    default:
      return null;
  }
}

/** Keeps known fields only, trims text and drops values outside the lists. */
export function cleanAnswers(input: unknown): MatchAnswers {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const answers: MatchAnswers = {};
  for (const field of MATCH_FIELDS) {
    const value = raw[field.id];
    const allowed = allowedValues(field);
    if (isListField(field)) {
      const list = (Array.isArray(value) ? value : [])
        .map((item) => String(item ?? "").trim())
        .filter((item) => (allowed ? allowed.includes(item) : Boolean(item)));
      const unique = Array.from(new Set(list));
      const max = field.kind === "verticals" || field.kind === "industries" ? 3 : 20;
      if (unique.length > 0) answers[field.id] = unique.slice(0, max);
      continue;
    }
    const text = String(value ?? "").trim().slice(0, TEXT_MAX);
    if (!text) continue;
    if (allowed && !allowed.includes(text)) continue;
    answers[field.id] = text;
  }
  return answers;
}

function asLevel(value: unknown): Level {
  const n = Number(value);
  return LEVELS.includes(n as Level) ? (n as Level) : 0;
}

export function cleanSettings(input: unknown): MatchSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const tune = (raw.tune && typeof raw.tune === "object" ? raw.tune : {}) as Record<string, unknown>;
  const filters = (raw.filters && typeof raw.filters === "object" ? raw.filters : {}) as Record<
    string,
    unknown
  >;
  const wave = Math.round(Number(raw.waveSize));
  const minConf = Number(filters.minConf);
  const founded = Math.round(Number(filters.foundedAfter));
  const siteN = Number(raw.siteN);
  return {
    waveSize: wave >= 10 && wave <= 1000 ? wave : DEFAULT_SETTINGS.waveSize,
    tune: {
      bullseye: asLevel(tune.bullseye),
      match: asLevel(tune.match),
      expansion: asLevel(tune.expansion),
    },
    filters: {
      noPlatforms: filters.noPlatforms === true,
      needDecision: filters.needDecision === true,
      needEmail: filters.needEmail === true,
      nearOnly: filters.nearOnly === true,
      minConf: minConf === 0.6 || minConf === 0.99 ? minConf : 0,
      foundedAfter: founded >= 1900 && founded <= 2100 ? founded : 0,
    },
    siteN: SITE_N_OPTIONS.includes(siteN as MatchSettings["siteN"])
      ? (siteN as MatchSettings["siteN"])
      : DEFAULT_SETTINGS.siteN,
    dropDead: raw.dropDead !== false,
  };
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((out, key) => {
        out[key] = stableJson(record[key]);
        return out;
      }, {});
  }
  return value;
}

/** Fingerprint of the profile and settings a match was run against. `last_match` is not a setting. */
export function matchBasis(answers: MatchAnswers, settings: MatchSettings) {
  return JSON.stringify(stableJson({ answers, settings: cleanSettings(settings) }));
}

/** The engine profile: intake answers through the converter, plus settings. */
export function buildProfile(answers: MatchAnswers, settings: MatchSettings) {
  const converted = intakeToProfile(answers);
  const stage = typeof answers.stage === "string" ? answers.stage : "";
  const exactStage = [...RME.VC_LADDER, ...RME.PE_STAGES].includes(stage);
  const profile: MatchProfile = {
    ...converted.profile,
    stage: exactStage ? stage : converted.profile.stage,
    // The converter reads any answer containing "need" as yes; the stored
    // answer is an explicit Yes/No.
    lead: answers.need_lead === "Yes",
    waveSize: settings.waveSize,
    tune: settings.tune as Record<Tier, Level>,
    filters: settings.filters,
    siteN: settings.siteN,
    dropDead: settings.dropDead,
  };
  // Only stage, sector and HQ country block a match. Everything else has a
  // safe default: equity as the instrument, and "none" for existing
  // investors, funds already pitched and competitors.
  const gaps: ProfileGap[] = [];
  const block = (id: string) => gaps.push({ id, label: fieldLabel(id), kind: "missing" });
  if (!profile.stage) block("stage");
  if (profile.verticals.length === 0 && profile.industries.length === 0) block("core_vertical");
  if (!profile.country) block("hq_country");
  return { profile, ready: gaps.length === 0, gaps, warnings: converted.warnings };
}

/** Enough to run a match (the rest only sharpens it). */
export function canRun(profile: MatchProfile) {
  return Boolean(
    profile.stage &&
      (profile.verticals.length > 0 || profile.industries.length > 0) &&
      profile.country,
  );
}

export async function loadProfileState(
  supabase: ServiceClient,
  clientId: string,
): Promise<{ ok: true; value: MatchProfileState | null } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("match_profiles")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return { ok: false, error: matchTableError(error.message, error.code) };
  if (!data) return { ok: true, value: null };
  // Readiness is worked out from the answers each time, so profiles saved
  // under older rules show the current ones.
  const answers = cleanAnswers(data.answers);
  const settings = cleanSettings(data.settings);
  const built = buildProfile(answers, settings);
  return {
    ok: true,
    value: {
      answers,
      settings,
      status: built.ready ? "ready" : "needs_info",
      gaps: built.gaps,
      warnings: built.warnings,
      sourceInterviewAt: data.source_interview_at != null ? String(data.source_interview_at) : null,
      builtAt: data.built_at != null ? String(data.built_at) : null,
      editedAt: data.edited_at != null ? String(data.edited_at) : null,
    },
  };
}

/** Saves answers and settings, with the readiness worked out from them. */
export async function saveProfileState(
  supabase: ServiceClient,
  clientId: string,
  input: {
    answers: MatchAnswers;
    settings: MatchSettings;
    source: "intake" | "edit" | "settings";
    sourceInterviewAt?: string | null;
  },
): Promise<{ ok: true; value: MatchProfileState } | { ok: false; error: string }> {
  const settings = cleanSettings(input.settings);
  const built = buildProfile(input.answers, settings);
  const at = new Date().toISOString();
  const row: Record<string, unknown> = {
    client_id: clientId,
    answers: input.answers,
    settings,
    status: built.ready ? "ready" : "needs_info",
    missing: built.gaps,
    warnings: built.warnings,
    updated_at: at,
  };
  if (input.source === "intake") {
    row.built_at = at;
    row.edited_at = null;
    row.source_interview_at = input.sourceInterviewAt ?? null;
  }
  if (input.source === "edit") row.edited_at = at;

  const { data: existing } = await supabase
    .from("match_profiles")
    .select("settings")
    .eq("client_id", clientId)
    .maybeSingle();
  const previous =
    existing?.settings && typeof existing.settings === "object"
      ? (existing.settings as Record<string, unknown>)
      : {};
  if (previous.last_match) {
    row.settings = { ...(row.settings as object), last_match: previous.last_match };
  }

  const { error } = await supabase.from("match_profiles").upsert(row, { onConflict: "client_id" });
  if (error) return { ok: false, error: matchTableError(error.message, error.code) };
  return loadProfileState(supabase, clientId).then((loaded) =>
    loaded.ok && loaded.value ? { ok: true as const, value: loaded.value } : {
      ok: false as const,
      error: loaded.ok ? "The match profile was not saved." : loaded.error,
    },
  );
}

// ---------------------------------------------------------------------------
// Building the profile from the intake (Claude)

type Question = { id: string; ask?: string; validate?: string };
const QUESTIONS = new Map(
  (questionBank.questions as Question[]).map((question) => [question.id, question]),
);

function propertyFor(field: MatchField) {
  const question = QUESTIONS.get(field.id);
  const description = [field.label, question?.ask, question?.validate]
    .filter(Boolean)
    .join(" · ");
  const allowed = allowedValues(field);
  if (isListField(field)) {
    return {
      type: "array",
      description,
      items: allowed ? { type: "string", enum: allowed } : { type: "string" },
    };
  }
  if (field.kind === "lead") {
    return { type: "string", description, enum: ["Yes", "No", ""] };
  }
  return allowed
    ? { type: "string", description, enum: [...allowed, ""] }
    : { type: "string", description };
}

/** JSON schema properties for every profile field (for Claude tools). */
export const PROFILE_PROPERTIES: Record<string, unknown> = Object.fromEntries(
  MATCH_FIELDS.map((field) => [field.id, propertyFor(field)]),
);

const PROFILE_TOOL = {
  name: "save_profile",
  description: "Save the company profile for investor matching.",
  input_schema: {
    type: "object",
    properties: PROFILE_PROPERTIES,
  },
};

/** The exact labels the profile accepts, for a Claude system prompt. */
export function profileLabelsText() {
  return [
    "## Allowed labels",
    `Stages: ${[...RME.VC_LADDER, ...RME.PE_STAGES].join(", ")}`,
    `Verticals: ${RME.VERTICALS.join(", ")}`,
    `Industries: ${RME.INDUSTRIES.join(", ")}`,
    `Countries: ${RME.COUNTRIES.join(", ")}`,
  ].join("\n\n");
}

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

function knownFacts(client: Record<string, unknown>) {
  const facts: [string, unknown][] = [
    ["Company", client.company_name],
    ["Website", client.company_website],
    ["Description", client.company_description],
    ["Round (from onboarding)", client.raise_stage],
    ["Raise amount (from onboarding)", client.raise_amount],
    ["Sector (from onboarding)", client.vertical ?? client.sector],
    ["Geography (from onboarding)", client.geography],
  ];
  const lines = facts
    .filter(([, value]) => text(value))
    .map(([label, value]) => `${label}: ${text(value)}`);
  return lines.length > 0 ? lines.join("\n") : "Nothing on record.";
}

function interviewText(interview: IntakeInterview) {
  const transcript = interview.messages
    .map((message) => `${message.role === "assistant" ? "Rupert" : "Founder"}: ${intakeMessageText(message)}`)
    .join("\n\n");
  const summary = (interview.summary ?? [])
    .map((item) => `${item.title}: ${item.answer}`)
    .join("\n");
  return [
    summary ? `## Summary the founder confirmed\n${summary}` : "",
    interview.admin_brief ? `## Intake brief\n${interview.admin_brief.summary}` : "",
    transcript ? `## Interview transcript\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Asks Claude to fill the profile fields from the intake. With the taxonomy,
 * it also classifies the company against it, with founder evidence (checked
 * by the caller).
 */
export async function extractAnswers(
  supabase: ServiceClient,
  client: Record<string, unknown>,
  interview: IntakeInterview,
  taxonomy: TaxIndex | null = null,
): Promise<
  { ok: true; answers: MatchAnswers; classification: AiClassification | null } | { ok: false; error: string }
> {
  const prompts = await loadAgentPrompts(supabase);
  const system = [
    prompts.match_profile,
    profileLabelsText(),
    "## What was already known",
    knownFacts(client),
    ...(taxonomy ? [classificationRules(taxonomy)] : []),
  ].join("\n\n");
  const tool = taxonomy
    ? {
        ...PROFILE_TOOL,
        input_schema: {
          type: "object",
          properties: { ...PROFILE_PROPERTIES, classification: CLASSIFICATION_PROPERTY },
        },
      }
    : PROFILE_TOOL;

  const result = await callClaudeTool<Record<string, unknown>>({
    system,
    messages: [
      {
        role: "user",
        content: `${interviewText(interview)}\n\nFill the profile by calling the save_profile tool.`,
      },
    ],
    tool,
    maxTokens: taxonomy ? 6000 : 3000,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const classification = result.input.classification;
  return {
    ok: true,
    answers: cleanAnswers(result.input),
    classification:
      taxonomy && classification && typeof classification === "object"
        ? (classification as AiClassification)
        : null,
  };
}
