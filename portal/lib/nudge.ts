// Nudge: what is waiting on each client (and on Rupert), and the nudges and
// reminders a client already received for it. Pure module: shared by the
// server loader and the admin screens.

import type { ReminderTurnKey } from "@/lib/email-templates";

/** A step waiting on the client: the only kind of item that can be nudged. */
export type NudgeTurn = {
  key: ReminderTurnKey;
  /** The step's name, e.g. "Outreach Narrative". */
  label: string;
  /** What the client is asked to do, e.g. "review and confirm the outreach narrative". */
  task: string;
  /** Portal path the step lives at. */
  path: string;
  /** When it became the client's turn. */
  since: string;
  days: number;
  /** Short facts for Rupert and the AI draft, e.g. "Version 2 · not opened yet". */
  facts: string[];
};

/** Something Rupert owes the client. */
export type NudgeOurItem = {
  action: string;
  since: string | null;
  days: number | null;
};

export type NudgeHistoryEntry = {
  id: string;
  /** "nudge": sent by Rupert from the Nudge page. "reminder": the automatic reminder. */
  kind: "nudge" | "reminder";
  subject: string;
  body: string;
  status: "sent" | "failed";
  created_at: string;
  /** Sent since the step last became the client's turn. */
  thisRound: boolean;
};

export type NudgeClientSummary = {
  id: string;
  name: string;
  company: string;
  stageLabel: string;
  clientTurns: NudgeTurn[];
  ourItems: NudgeOurItem[];
};

export type NudgeDetail = NudgeClientSummary & {
  email: string;
  firstName: string;
  paused: boolean;
  /** Earlier nudges and reminders per waiting step, newest first. */
  history: Record<string, NudgeHistoryEntry[]>;
  /** Why the history could not be loaded, if it could not. */
  historyError: string | null;
};

/** The email-log key a nudge for this step is recorded under. */
export function nudgeTemplateKey(key: ReminderTurnKey) {
  return `nudge:${key}`;
}

const DAY = 24 * 60 * 60 * 1000;

/** Whole days since a timestamp (0 on the day itself), or null when unknown. */
export function daysSince(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY));
}

export function daysLabel(days: number | null) {
  if (days == null) return "";
  if (days === 0) return "under a day";
  return days === 1 ? "1 day" : `${days} days`;
}
