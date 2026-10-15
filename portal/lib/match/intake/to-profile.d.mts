// Types for the intake converter (to-profile.mjs, used as-is).
import type { MatchProfile } from "../engine/index.mjs";

export type IntakeAnswers = Record<string, string | string[] | undefined>;

export type ConvertedProfile = MatchProfile & {
  intake: {
    competitors: string[];
    entity: string;
    valuation: string;
    timeline: string;
    warm: string[];
    deck: string;
  };
};

export function intakeToProfile(answers?: IntakeAnswers): {
  profile: ConvertedProfile;
  /** Falsy (false or 0) when something blocking is missing. */
  ready: boolean | number;
  missing: string[];
  unasked: string[];
  warnings: string[];
};

export function parseMoney(value: unknown): number | null;
export function normStage(value: unknown): { stage: string; note?: string };
export function normInstrument(value: unknown): string[];
