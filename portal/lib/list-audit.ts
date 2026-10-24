// Investor list audit: before the list goes to the founder, an AI reads it
// the way the founder will (the top funds in each tier, their websites) and
// says what they would question. Pure module: shapes, the sample and the
// checks the admin page and the tests share.

import type { FitTier, InvestorRow } from "./setup.ts";

/** Funds checked per tier, the way a founder skims: the first ones in each. */
export const AUDIT_PER_TIER = 10;
/** Funds the AI reads in one request (each one's website is opened). */
export const AUDIT_BATCH = 5;

export type AuditVerdict = "ok" | "flag" | "remove";
export type AuditDecision = "keep" | "remove";
export type WebsiteSeen = "opened" | "problem" | "not_opened";

export type AuditSampleFund = { id: string; fund_name: string; tier: FitTier; broad: boolean };

export type AuditFund = AuditSampleFund & {
  verdict: AuditVerdict;
  /** One sentence grounded in what the AI saw. */
  reason: string;
  /** What the founder would ask about this fund; empty when nothing. */
  founder_question: string;
  website: WebsiteSeen;
  decision: AuditDecision | null;
  decided_at: string | null;
};

export type AuditQuestion = { question: string; why: string; answer: string };

export type AuditSummary = {
  /** The founder's overall read, a few sentences. */
  overview: string;
  /** What the founder will ask, with the answer Rupert should be ready to give. */
  questions: AuditQuestion[];
  /** What would bother the founder. */
  concerns: string[];
};

export type ListAudit = {
  id: string;
  client_id: string;
  list_fingerprint: string;
  run_id: string | null;
  status: "running" | "complete";
  sample: AuditSampleFund[];
  funds: AuditFund[];
  summary: AuditSummary | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** The funds the founder sees (hidden duplicates are admin only). */
export function visibleRows(rows: InvestorRow[]) {
  return rows.filter((row) => !row.hidden_duplicate);
}

/**
 * A short fingerprint of the list as the founder will see it: which funds,
 * in which tier, in which order. It changes whenever the draft changes.
 */
export function listFingerprint(rows: InvestorRow[]) {
  const text = visibleRows(rows)
    .map((row) => `${row.id}:${row.tier}:${row.broad ? 1 : 0}`)
    .join("|");
  // FNV-1a, 32 bits: enough to tell two drafts of one list apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${visibleRows(rows).length}-${hash.toString(16).padStart(8, "0")}`;
}

/** The first funds of each tier (and of the broad investors), in list order. */
export function auditSample(rows: InvestorRow[], perTier = AUDIT_PER_TIER): AuditSampleFund[] {
  const taken = new Map<string, number>();
  const sample: AuditSampleFund[] = [];
  for (const row of visibleRows(rows)) {
    const group = row.broad ? "broad" : String(row.tier);
    const count = taken.get(group) ?? 0;
    if (count >= perTier) continue;
    taken.set(group, count + 1);
    sample.push({ id: row.id, fund_name: row.fund_name, tier: row.tier, broad: Boolean(row.broad) });
  }
  return sample;
}

/** The sample funds not reviewed yet, in sample order. */
export function remainingFunds(audit: Pick<ListAudit, "sample" | "funds">) {
  const done = new Set(audit.funds.map((fund) => fund.id));
  return audit.sample.filter((fund) => !done.has(fund.id));
}

export type AuditProgress = {
  reviewed: number;
  total: number;
  flagged: number;
  /** Flags and removal suggestions without the admin's decision. */
  undecided: number;
  /** The draft changed since this audit. */
  stale: boolean;
};

export function auditProgress(audit: ListAudit, fingerprint: string): AuditProgress {
  const flagged = audit.funds.filter((fund) => fund.verdict !== "ok");
  return {
    reviewed: audit.funds.length,
    total: audit.sample.length,
    flagged: flagged.length,
    undecided: flagged.filter((fund) => !fund.decision).length,
    stale: audit.list_fingerprint !== fingerprint,
  };
}

/** The warning above Send: null when the audit is complete, current and decided. */
export function auditSendWarning(audit: ListAudit | null, fingerprint: string): string | null {
  if (!audit) return "No audit has run on this list. Run the audit before sending.";
  const progress = auditProgress(audit, fingerprint);
  if (progress.stale) return "The list changed since the last audit. Run the audit again before sending.";
  if (audit.status !== "complete") return "The audit has not finished.";
  if (progress.undecided > 0) {
    return `${progress.undecided} audit flag${progress.undecided === 1 ? " has" : "s have"} no decision yet.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading stored and AI values

function text(value: unknown, max: number) {
  return value != null ? String(value).trim().slice(0, max) : "";
}

const VERDICTS: AuditVerdict[] = ["ok", "flag", "remove"];
const WEBSITE: WebsiteSeen[] = ["opened", "problem", "not_opened"];

function asTier(value: unknown): FitTier {
  const number = Number(value);
  return number === 1 || number === 2 || number === 3 || number === 4 ? number : 4;
}

function asSampleFund(value: unknown): AuditSampleFund | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const id = text(entry.id, 200);
  if (!id) return null;
  return { id, fund_name: text(entry.fund_name, 300), tier: asTier(entry.tier), broad: entry.broad === true };
}

export function asAuditFund(value: unknown): AuditFund | null {
  const base = asSampleFund(value);
  if (!base) return null;
  const entry = value as Record<string, unknown>;
  const verdict = VERDICTS.includes(entry.verdict as AuditVerdict) ? (entry.verdict as AuditVerdict) : "flag";
  return {
    ...base,
    verdict,
    reason: text(entry.reason, 600),
    founder_question: text(entry.founder_question, 400),
    website: WEBSITE.includes(entry.website as WebsiteSeen) ? (entry.website as WebsiteSeen) : "not_opened",
    decision: entry.decision === "keep" || entry.decision === "remove" ? entry.decision : null,
    decided_at: entry.decided_at ? text(entry.decided_at, 40) : null,
  };
}

export function asAuditSummary(value: unknown): AuditSummary | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const questions = (Array.isArray(entry.questions) ? entry.questions : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({ question: text(item.question, 400), why: text(item.why, 600), answer: text(item.answer, 800) }))
    .filter((item) => item.question)
    .slice(0, 12);
  const concerns = (Array.isArray(entry.concerns) ? entry.concerns : [])
    .map((item) => text(item, 400))
    .filter(Boolean)
    .slice(0, 10);
  const overview = text(entry.overview, 2000);
  if (!overview && questions.length === 0 && concerns.length === 0) return null;
  return { overview, questions, concerns };
}

function list<T>(value: unknown, read: (item: unknown) => T | null): T[] {
  return (Array.isArray(value) ? value : []).map(read).filter((item): item is T => item !== null);
}

export function asListAudit(row: Record<string, unknown>): ListAudit {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    list_fingerprint: String(row.list_fingerprint ?? ""),
    run_id: row.run_id != null ? String(row.run_id) : null,
    status: row.status === "complete" ? "complete" : "running",
    sample: list(row.sample, asSampleFund),
    funds: list(row.funds, asAuditFund),
    summary: asAuditSummary(row.summary),
    created_by: row.created_by != null ? String(row.created_by) : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export const NOT_REVIEWED = "Not reviewed: the AI gave no answer for this fund. Check it yourself.";

/**
 * The AI's verdicts for one batch, matched to the sample funds asked about.
 * A fund the AI skipped is recorded as a flag to check by hand, so the audit
 * always moves on.
 */
export function readBatch(asked: AuditSampleFund[], raw: unknown): AuditFund[] {
  const entries = (Array.isArray(raw) ? raw : []).filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
  );
  const out: AuditFund[] = [];
  for (const fund of asked) {
    const entry = entries.find((item) => text(item.id, 200) === fund.id);
    if (!entry) {
      out.push({ ...fund, verdict: "flag", reason: NOT_REVIEWED, founder_question: "", website: "not_opened", decision: null, decided_at: null });
      continue;
    }
    const read = asAuditFund({ ...entry, ...fund, decision: null, decided_at: null });
    if (read) out.push(read);
  }
  return out;
}
