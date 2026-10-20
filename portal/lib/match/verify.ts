// Email Verification: types, labels and status rules shared by the server
// and the admin UI. Pure module (no server code).

import type { Contact } from "@/lib/match/engine/index.mjs";
import type { Tier } from "@/lib/match/shared";

/** Contacts checked per batch. */
export const VERIFY_BATCH_SIZE = 5;
/** A finished check is reused this long while the email is unchanged. */
export const VERIFY_FRESH_DAYS = 90;

// Cost estimate. Claude Sonnet 5.5 list prices (platform.claude.com pricing,
// October 2026) and web search at $10 per 1,000 searches. Update if
// ANTHROPIC_MODEL points at another model.
export const CLAUDE_USD_PER_MTOK_IN = 2;
export const CLAUDE_USD_PER_MTOK_OUT = 10;
export const USD_PER_SEARCH = 0.01;
/** Used until real checks have been measured. */
export const DEFAULT_USD_PER_CONTACT = 0.15;
export const DEFAULT_MS_PER_BATCH = 100_000;

export type VerifyStatus =
  | "clean"
  | "unknown"
  | "email_bad"
  | "role_changed"
  | "not_found"
  | "left_firm";

export type VerifyState = VerifyStatus | "unverified";

export const VERIFY_STATUSES: VerifyStatus[] = [
  "clean",
  "unknown",
  "email_bad",
  "role_changed",
  "not_found",
  "left_firm",
];

export const VERIFY_LABEL: Record<VerifyState, string> = {
  clean: "Clean",
  unknown: "Unknown",
  email_bad: "Email bad",
  role_changed: "Role changed",
  not_found: "Not found",
  left_firm: "Left firm",
  unverified: "Not verified",
};

export const VERIFY_HINT: Record<VerifyStatus, string> = {
  clean: "Found at the firm in an investing role, and the email is confirmed.",
  unknown: "The checks could not confirm or rule out the email.",
  email_bad: "The mailbox does not accept mail.",
  role_changed: "At the firm, but not in an investing role.",
  not_found: "No reliable public source shows this person at the firm.",
  left_firm: "A public source shows this person has left the firm.",
};

/** Text colour per state, for badges. */
export const VERIFY_TONE: Record<VerifyState, string> = {
  clean: "text-success",
  unknown: "text-warning",
  email_bad: "text-error",
  role_changed: "text-warning",
  not_found: "text-warning",
  left_firm: "text-error",
  unverified: "text-muted",
};

export type VerifyScope = "all" | "sequence" | "wave1";

export const VERIFY_SCOPES: { key: VerifyScope; label: string; description: string }[] = [
  { key: "all", label: "All investing contacts", description: "Everyone with an email at every fund in the tiers." },
  { key: "sequence", label: "Primary + Backup only", description: "The two people outreach goes to, at every fund." },
  { key: "wave1", label: "Wave 1 only", description: "Primary + Backup of the first-wave Bullseye funds." },
];

// ---------------------------------------------------------------------------
// Contact identity: FirmID + the original work email, lowercased.

export function emailKey(email: string) {
  return email.trim().toLowerCase();
}

export function contactId(firmId: string, key: string) {
  return `${firmId}|${key}`;
}

/** The original email key a corrected contact carries (see applyCorrections). */
export type KeyedContact = Contact & { key?: string };

export function contactKeyOf(contact: KeyedContact) {
  return contact.key ?? emailKey(contact.email);
}

export function personNameOf(contact: Pick<Contact, "prefix" | "first" | "last">) {
  return [contact.prefix, contact.first, contact.last].filter(Boolean).join(" ").trim() || "(no name)";
}

/** One contact as it was when the run started. */
export type VerifyContact = {
  id: string;
  firmId: string;
  key: string;
  firmName: string;
  firmWebsite: string;
  firmCity: string;
  name: string;
  first: string;
  last: string;
  title: string;
  email: string;
  seq: "Primary" | "Backup" | null;
  tier: Tier;
};

// ---------------------------------------------------------------------------
// Steps

export type Evidence = { url: string; note: string };

export type RoleResult = "confirmed" | "role_changed" | "left_firm" | "not_found" | "error";

export type RoleStep = {
  result: RoleResult;
  currentTitle: string;
  newFirm: string;
  newFirmWebsite: string;
  newTitle: string;
  summary: string;
  evidence: Evidence[];
};

export type PublicStep = {
  result: "found" | "not_found" | "error";
  summary: string;
  evidence: Evidence[];
};

export type MailboxResult =
  | "valid"
  | "invalid"
  | "accept_all"
  | "webmail"
  | "disposable"
  | "unknown"
  | "error";

export type MailboxStep = {
  result: MailboxResult;
  score: number | null;
  summary: string;
  /** Hunter's most likely address, looked up when the mailbox is bad. */
  suggestedEmail: string;
};

export type CheckSteps = { role?: RoleStep; public?: PublicStep; mailbox?: MailboxStep };

export type StepNumber = 1 | 2 | 3;

export const STEP_LABEL: Record<StepNumber, string> = {
  1: "At the firm?",
  2: "Email public?",
  3: "Mailbox check",
};

/** Whether this step still has to run for a contact. */
export function needsStep(steps: CheckSteps, step: StepNumber) {
  if (step === 1) return !steps.role;
  if (!steps.role || steps.role.result === "left_firm") return false;
  if (step === 2) return !steps.public;
  return Boolean(steps.public) && steps.public!.result !== "found" && !steps.mailbox;
}

/** A step that could not run (API error, missing key). */
export function failedStep(steps: CheckSteps) {
  return [steps.role, steps.public, steps.mailbox].find((step) => step?.result === "error") ?? null;
}

/** True when no step is left to run. */
export function stepsComplete(steps: CheckSteps) {
  return !needsStep(steps, 1) && !needsStep(steps, 2) && !needsStep(steps, 3);
}

/** Step 2 or 3 confirmed the address. */
function emailConfirmed(steps: CheckSteps) {
  return steps.public?.result === "found" || steps.mailbox?.result === "valid";
}

function emailBad(steps: CheckSteps) {
  if (steps.public?.result === "found") return false;
  return steps.mailbox?.result === "invalid" || steps.mailbox?.result === "disposable";
}

/** The status the steps add up to. */
export function finalStatus(steps: CheckSteps): VerifyStatus {
  const role = steps.role?.result;
  if (role === "left_firm") return "left_firm";
  if (emailBad(steps)) return "email_bad";
  if (role === "role_changed") return "role_changed";
  if (role === "not_found") return "not_found";
  if (role === "confirmed" && emailConfirmed(steps)) return "clean";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Actions

export type VerifyAction = "keep" | "remove" | "update_email" | "update_name" | "update_firm";

export const ACTION_LABEL: Record<VerifyAction, string> = {
  keep: "Keep",
  remove: "Remove",
  update_email: "Update email",
  update_name: "Update name",
  update_firm: "Update firm",
};

export type Suggestion = {
  action: VerifyAction;
  why: string;
  email?: string;
  title?: string;
  newFirm?: string;
  newFirmWebsite?: string;
};

/** The suggested action for a finished check. Null for Clean. */
export function suggestFor(status: VerifyStatus, steps: CheckSteps): Suggestion | null {
  const role = steps.role;
  switch (status) {
    case "clean":
      return null;
    case "left_firm":
      return role?.newFirm
        ? {
            action: "update_firm",
            why: `Now at ${role.newFirm}${role.newTitle ? ` as ${role.newTitle}` : ""}.`,
            newFirm: role.newFirm,
            newFirmWebsite: role.newFirmWebsite,
            title: role.newTitle,
          }
        : { action: "remove", why: "Left the firm; the new firm is not known." };
    case "email_bad":
      return steps.mailbox?.suggestedEmail
        ? {
            action: "update_email",
            why: "Hunter suggests a different address.",
            email: steps.mailbox.suggestedEmail,
          }
        : { action: "remove", why: "The mailbox does not accept mail and no other address was found." };
    case "role_changed":
      return {
        action: "remove",
        why: role?.currentTitle ? `Now ${role.currentTitle}, not an investing role.` : "Not in an investing role.",
      };
    case "not_found":
      return emailConfirmed(steps)
        ? { action: "keep", why: "Not found publicly, but the email is confirmed." }
        : { action: "remove", why: "Not found at the firm and the email is not confirmed." };
    case "unknown": {
      const failed = failedStep(steps);
      return failed
        ? { action: "keep", why: `A check failed (${failed.summary || "error"}). It runs again next time.` }
        : { action: "keep", why: "Nothing proves it wrong." };
    }
  }
}

// ---------------------------------------------------------------------------
// What the verification page receives

export type CheckCost = {
  usd: number;
  searches: number;
  inputTokens: number;
  outputTokens: number;
  hunter: number;
};

export const ZERO_COST: CheckCost = { usd: 0, searches: 0, inputTokens: 0, outputTokens: 0, hunter: 0 };

export function addCost(a: CheckCost, b: Partial<CheckCost>): CheckCost {
  return {
    usd: Math.round((a.usd + (b.usd ?? 0)) * 10_000) / 10_000,
    searches: a.searches + (b.searches ?? 0),
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    hunter: a.hunter + (b.hunter ?? 0),
  };
}

export type ContactResult = {
  contact: VerifyContact;
  /** Null while the check is in progress. */
  status: VerifyStatus | null;
  steps: CheckSteps;
  suggestion: Suggestion | null;
  checkedAt: string | null;
  /** From an earlier check (this run did not search). */
  reused: boolean;
  decision: "keep" | "remove" | null;
  /** Set when a fix for this contact is already saved for every client. */
  corrected: boolean;
};

export type RunStats = { usd: number; searches: number; hunter: number; ms: number };

export type RunState = {
  id: string;
  scope: VerifyScope;
  batchSize: number;
  batches: number;
  nextBatch: number;
  status: "active" | "done" | "cancelled";
  createdAt: string;
  finishedAt: string | null;
  stats: RunStats;
  /** Contacts this run checks, in batch order. */
  contacts: VerifyContact[];
  /** Results for checked batches and reused contacts. */
  results: ContactResult[];
};

/** What closing a batch returns. */
export type BatchDone = {
  nextBatch: number;
  status: RunState["status"];
  stats: RunStats;
  /** Final results for the contacts of the closed batch. */
  results: ContactResult[];
};

export type ScopeCount = {
  /** Contacts with an email in this scope. */
  total: number;
  /**
   * One letter per contact, in outreach order: "c" to check, "r" reused
   * (checked recently), "f" removed before (decide first). A limit keeps the
   * first N.
   */
  order: string;
  /** Investing contacts without an email (left out). */
  noEmail: number;
};

/** Counts for the first `limit` contacts of a scope (0 = all). */
export function countScope(count: ScopeCount, limit: number) {
  const order = limit > 0 ? count.order.slice(0, limit) : count.order;
  const of = (letter: string) => order.split(letter).length - 1;
  return { contacts: order.length, toCheck: of("c"), reused: of("r"), flagged: of("f") };
}

/** How many contacts a run checks at most. 0 means all. */
export const VERIFY_LIMITS = [0, 10, 25, 50, 100, 250] as const;

export type FlaggedContact = {
  contact: VerifyContact;
  reason: string;
  flaggedAt: string;
  /** Position in each scope's outreach order (0-based), where it appears. */
  positions: Partial<Record<VerifyScope, number>>;
};

export type VerifyOverview = {
  scopes: Record<VerifyScope, ScopeCount>;
  flagged: FlaggedContact[];
  estimate: { msPerBatch: number; usdPerContact: number; measured: boolean };
  claudeReady: boolean;
  hunterReady: boolean;
  /** An unfinished run that can be resumed. */
  activeRun: RunState | null;
  /** The most recent finished run, for its summary and actions. */
  lastRun: RunState | null;
};

export type FlaggedChoice = "remove" | "keep" | "check";

export type ActionInput = {
  id: string;
  action: VerifyAction;
  email?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  newFirm?: string;
  newFirmWebsite?: string;
};

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only http(s) links are shown as evidence. */
export function safeUrl(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\/[^\s]+$/i.test(text) || text.length > 500) return "";
  return text;
}

export function formatUsd(value: number) {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

export function formatDuration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// ---------------------------------------------------------------------------
// Fund Database page: corrections, flags and leads

export type CorrectionRow = {
  firmId: string;
  key: string;
  firmName: string;
  personName: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  flag: "removed" | "left_firm" | null;
  flagReason: string | null;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string;
  /** The contact is still in the live Fund Database. */
  inDatabase: boolean;
};

export type LeadRow = {
  id: string;
  personName: string;
  title: string;
  email: string | null;
  newFirm: string;
  newFirmWebsite: string | null;
  fromFirmName: string;
  oldEmail: string;
  evidence: Evidence[];
  note: string | null;
  status: "new" | "added" | "dismissed";
  createdAt: string;
};
