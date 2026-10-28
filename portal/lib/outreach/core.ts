// Core outreach: the contacts at each Core fund, their Quick Facts and their
// own emails. Pure module, safe on the server and in the browser.
//
// Each fund gets as many active contacts as the campaign plan says (default
// 2: the engine's Primary and Backup), skipping contacts verification flagged. Any other reachable contact is a
// reserve: listed, not emailed, activated by Rupert. Every active contact's
// emails are written from the Core template of the fund's type and a few
// sourced Quick Facts, and Rupert approves each one.
// See claude/rupert-outreach-spec.md in the project.

import type { CopyEmail } from "../setup.ts";
import { SEQUENCE_LENGTH, emailIssues, fundTypeKey, type CopyIssue, type TypedCopy, type TypedGroupCopy } from "./copy.ts";

/** Contacts emailed per fund when the list doesn't say (every list before the setting was stored). */
export const DEFAULT_CONTACTS_PER_FIRM = 2;

/** The contacts per fund to email: the list's, set from its campaign plan; else the default. */
export function perFirmOf(list: { contacts_per_firm?: number } | null | undefined) {
  const n = Math.round(Number(list?.contacts_per_firm));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10) : DEFAULT_CONTACTS_PER_FIRM;
}

/** How many of a fund's contacts get emailed. */
export function toEmail(contactsOnFile: number, perFirm: number) {
  return Math.max(0, Math.min(contactsOnFile, perFirm));
}
export const MAX_QUICK_FACTS = 5;
/** Fund facts are reused across clients for this long. */
export const FUND_RESEARCH_TTL_DAYS = 60;

export type ContactSlot = "active" | "reserve";
export type MessageStatus = "pending" | "drafted" | "approved" | "error";

export const STATUS_LABEL: Record<MessageStatus, string> = {
  pending: "Not written",
  drafted: "Ready to review",
  approved: "Approved",
  error: "Failed",
};

/** A contact as the saved run stores it (PersonRecord, lib/match/tiers/core.ts). */
export type RunPerson = {
  fid: string;
  key: string;
  name: string;
  title: string;
  email: string;
  score: number;
  seq: string;
};

export type CorePerson = {
  /** FirmID the contact is stored under (verification is keyed by it). */
  fid: string;
  name: string;
  first_name: string;
  title: string;
  email: string;
  /** "Primary", "Backup" or "" for the others. */
  seq: string;
};

export type QuickFact = {
  fact: string;
  url: string;
  /** Whether the fact is about the fund or the person. */
  about: "fund" | "person";
};

/** One contact's row in outreach_messages. */
export type CoreMessage = {
  id: string;
  firm_id: string;
  fund_name: string;
  fund_type: string;
  person_key: string;
  person: CorePerson;
  slot: ContactSlot;
  position: number;
  quick_facts: QuickFact[];
  emails: CopyEmail[];
  status: MessageStatus;
  error: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approved_hash: string | null;
  updated_at: string;
};

const HONORIFIC = /^(mr|mrs|ms|miss|mx|dr|prof|sir)\.?\s+/i;

/** First name for "Hi …": honorifics dropped, then the first word. */
export function firstNameOf(name: string) {
  const clean = name.trim().replace(HONORIFIC, "").trim();
  if (!clean || clean === "(no name)") return "";
  return clean.split(/\s+/)[0];
}

export const emailKey = (email: string) => email.trim().toLowerCase();

export function asCorePerson(person: RunPerson): CorePerson {
  return {
    fid: person.fid,
    name: person.name === "(no name)" ? "" : person.name,
    first_name: firstNameOf(person.name),
    title: person.title,
    email: person.email.trim(),
    seq: person.seq,
  };
}

/** Run order: Primary, Backup, then the rest by the engine's score. */
function runOrder(a: RunPerson, b: RunPerson) {
  const rank = (p: RunPerson) => (p.seq === "Primary" ? 0 : p.seq === "Backup" ? 1 : 2);
  return rank(a) - rank(b) || b.score - a.score;
}

/**
 * The fund's active contacts and reserves. People without an email, repeats
 * of one address, and contacts `blocked` (verification found a problem, or
 * Rupert removed them for this client) are left out entirely.
 */
export function selectCoreContacts(people: RunPerson[], blocked: (person: RunPerson) => boolean, perFirm = DEFAULT_CONTACTS_PER_FIRM) {
  const seen = new Set<string>();
  const usable: RunPerson[] = [];
  let leftOut = 0;
  for (const person of [...people].sort(runOrder)) {
    const key = emailKey(person.email ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (blocked(person)) {
      leftOut += 1;
      continue;
    }
    usable.push(person);
  }
  const n = Math.max(1, Math.floor(perFirm));
  return { active: usable.slice(0, n), reserve: usable.slice(n), leftOut };
}

/** The key a contact is stored under in outreach_messages. */
export function personKey(person: Pick<RunPerson, "fid" | "email">) {
  return `${person.fid}|${emailKey(person.email)}`;
}

// ---------------------------------------------------------------------------
// Quick Facts

export function safeHttpUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href.slice(0, 500) : "";
  } catch {
    return "";
  }
}

/** Facts with a real source link only, at most five. */
export function asQuickFacts(value: unknown, max = MAX_QUICK_FACTS): QuickFact[] {
  if (!Array.isArray(value)) return [];
  const out: QuickFact[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const fact = String(raw.fact ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
    const url = safeHttpUrl(raw.url);
    if (!fact || !url || seen.has(fact.toLowerCase())) continue;
    seen.add(fact.toLowerCase());
    out.push({ fact, url, about: raw.about === "person" ? "person" : "fund" });
    if (out.length >= max) break;
  }
  return out;
}

export function researchIsFresh(researchedAt: string | null | undefined, now = Date.now()) {
  if (!researchedAt) return false;
  const at = Date.parse(researchedAt);
  return Number.isFinite(at) && now - at < FUND_RESEARCH_TTL_DAYS * 86_400_000;
}

// ---------------------------------------------------------------------------
// The emails

export function asCoreEmails(value: unknown): CopyEmail[] {
  // Claude sometimes sends the array as a JSON string, or as an object keyed 0/1/2.
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    parsed = Array.isArray(record.emails) ? record.emails : Object.keys(record).sort().map((key) => record[key]);
  }
  const list = Array.isArray(parsed) ? parsed : [];
  return Array.from({ length: SEQUENCE_LENGTH }, (_, index) => {
    const raw = (list[index] && typeof list[index] === "object" ? list[index] : {}) as Record<string, unknown>;
    return { subject: String(raw.subject ?? "").slice(0, 300), body: String(raw.body ?? "").slice(0, 10000) };
  });
}

/** Problems in one contact's emails. They are written for one person, so no {{fields}} may remain. */
export function coreMessageIssues(emails: CopyEmail[], maxWords: number): CopyIssue[] {
  return emails.flatMap((email, index) => emailIssues(email, index, "core", maxWords, "Email", []));
}

export function hasBlockingIssues(emails: CopyEmail[], maxWords: number) {
  return coreMessageIssues(emails, maxWords).some((issue) => issue.level === "error");
}

/** A stable fingerprint of the emails: an approval holds only for the text approved. */
export function emailsHash(emails: CopyEmail[]) {
  const textValue = JSON.stringify(emails.map((email) => [email.subject.trim(), email.body.trim()]));
  let hash = 0x811c9dc5;
  for (let i = 0; i < textValue.length; i += 1) {
    hash ^= textValue.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Approved, and the text has not changed since. */
export function isApproved(message: Pick<CoreMessage, "status" | "approved_hash" | "emails">) {
  return message.status === "approved" && message.approved_hash === emailsHash(message.emails);
}

// ---------------------------------------------------------------------------
// Summary

export type CoreSummary = {
  funds: number;
  active: number;
  reserve: number;
  written: number;
  approved: number;
  failed: number;
};

export function coreSummary(messages: Pick<CoreMessage, "firm_id" | "slot" | "status" | "approved_hash" | "emails">[]): CoreSummary {
  const active = messages.filter((m) => m.slot === "active");
  return {
    funds: new Set(messages.map((m) => m.firm_id)).size,
    active: active.length,
    reserve: messages.length - active.length,
    written: active.filter((m) => m.status === "drafted" || m.status === "approved").length,
    approved: active.filter((m) => isApproved(m)).length,
    failed: active.filter((m) => m.status === "error").length,
  };
}

/** The Core template for a fund type: its own, else the group it was merged into, else Other. */
export function templateFor(typed: TypedCopy | null, fundType: string): TypedGroupCopy | null {
  if (!typed) return null;
  const type = fundTypeKey(fundType);
  return (
    typed.core.find((group) => group.type === type) ??
    typed.core.find((group) => group.merged?.includes(type)) ??
    typed.core.find((group) => group.type === "Other") ??
    null
  );
}
