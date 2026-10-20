// Match Sandbox: the fields and types shared by the server and the Fund
// Database page. Pure module (no server code).

import { MATCH_FIELDS, type MatchAnswers, type MatchField } from "@/lib/match/shared";

export const SANDBOX_COMPANY_NAME = "Test Pilot (sandbox)";

export const SANDBOX_MIGRATION_MISSING =
  "The Match Sandbox is not set up in the database yet. Run portal/supabase/match_sandbox.sql in Supabase.";

/** The profile fields the sandbox form shows, in order. Nothing else is matched on. */
export const SANDBOX_FIELD_IDS = [
  "stage",
  "core_vertical",
  "core_industry",
  "hq_country",
  "hq_state",
  "hq_city",
  "markets",
  "investor_types",
  "no_go",
] as const;

export const SANDBOX_FIELDS: MatchField[] = SANDBOX_FIELD_IDS.map((id) => {
  const field = MATCH_FIELDS.find((item) => item.id === id)!;
  return id === "no_go"
    ? { ...field, label: "Funds to exclude", hint: "One fund name or website per line." }
    : field;
});

/** Only the sandbox fields, with "none" for the conflict questions it doesn't ask. */
export function sandboxAnswers(raw: MatchAnswers): MatchAnswers {
  const answers: MatchAnswers = {
    company_name: SANDBOX_COMPANY_NAME,
    existing_investors: "none",
    already_pitched: "none",
    competitors: "none",
  };
  for (const id of SANDBOX_FIELD_IDS) {
    const value = raw[id];
    if (Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim()) {
      answers[id] = value;
    }
  }
  return answers;
}

export type SandboxCompany = {
  id: string;
  name: string;
  /** Stage, sector and HQ country are set: the match can run. */
  ready: boolean;
  missing: string[];
  archived: boolean;
};

export type SandboxPanel = {
  /** The sandbox company, once it exists. */
  sandboxId: string | null;
  /** The sandbox's current answers (its last run). */
  answers: MatchAnswers;
  companies: SandboxCompany[];
};
