// The stored rows of a saved four-tier run, and their labels. Pure module.

import { NOTE_LABEL, REASONS, type NoteCode, type ReasonCode } from "./core.ts";

export type StoredResult = {
  firmId: string;
  firmName: string;
  status: "tiered" | "excluded" | "unresolved" | "generalist";
  tier: string | null;
  reasonCodes: string[];
  detail: Record<string, unknown>;
  score: number | null;
  position: number;
};

export function reasonLabel(code: string) {
  return (REASONS as Record<string, { label: string }>)[code]?.label ?? code;
}

export function noteLabel(code: string) {
  return NOTE_LABEL[code as NoteCode] ?? code;
}

export type { ReasonCode };
