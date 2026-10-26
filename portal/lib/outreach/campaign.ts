// The campaign: every email for every contact, rendered and locked, ready to
// export to Instantly. And the funds the client knows (warm intros).
// Pure module, safe on the server and in the browser.
// See claude/rupert-outreach-spec.md in the project.

import type { CopyEmail, InvestorRow } from "../setup.ts";
import { csvCell } from "../csv.ts";
import {
  OTHER_TIER_LABEL,
  SEQUENCE_LENGTH,
  copyTierOf,
  fundTypeKey,
  optOutFor,
  renderForTier,
  type OtherTier,
  type TypedCopy,
  type TypedGroupCopy,
} from "./copy.ts";
import { emailsHash, firstNameOf, isApproved, type CoreMessage, type CorePerson } from "./core.ts";

// ---------------------------------------------------------------------------
// Warm intros: funds the client marked "I know them"

export type WarmIntroStatus = "not_started" | "asked" | "intro_made" | "not_pursuing";

export const WARM_INTRO_STATUSES: { value: WarmIntroStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "asked", label: "Asked for an intro" },
  { value: "intro_made", label: "Intro made" },
  { value: "not_pursuing", label: "Not pursuing" },
];

export function asWarmIntroStatus(value: unknown): WarmIntroStatus {
  return WARM_INTRO_STATUSES.some((item) => item.value === value) ? (value as WarmIntroStatus) : "not_started";
}

// ---------------------------------------------------------------------------
// Sphere, Tier 3 and Tier 4: emails rendered from the confirmed copy

/** The copy group a fund is written with: its type, the group its type was merged into, else Other. */
export function otherGroupFor(typed: TypedCopy, fundType: string): TypedGroupCopy | null {
  const type = fundTypeKey(fundType);
  return (
    typed.others.find((group) => group.type === type) ??
    typed.others.find((group) => group.merged?.includes(type)) ??
    typed.others.find((group) => group.type === "Other") ??
    null
  );
}

/**
 * One contact's three emails at a Sphere, Tier 3 or Tier 4 fund: the type's
 * sequence with the tier line, name and fund filled in. Stored without the
 * opt-out line, which the export adds.
 */
export function renderOtherEmails(group: TypedGroupCopy, tier: OtherTier, person: Pick<CorePerson, "first_name">, fundName: string): CopyEmail[] {
  const values = { first_name: person.first_name, fund_name: fundName };
  return Array.from({ length: SEQUENCE_LENGTH }, (_, index) => renderForTier(group, index, tier, values, ""));
}

/** Greeting fix when a contact has no first name: "Hi ," becomes "Hi,". */
export function tidyGreeting(emails: CopyEmail[]): CopyEmail[] {
  return emails.map((email) => ({ ...email, body: email.body.replace(/^(Hi|Hello|Dear)\s+,/m, "$1,") }));
}

/** The copy tier of a list row, as a number 2–4 (Core is 1). */
export function otherTierOf(row: Pick<InvestorRow, "tier" | "broad">): OtherTier | null {
  const tier = copyTierOf(row);
  return tier === 1 ? null : tier;
}

// ---------------------------------------------------------------------------
// Readiness

export type CampaignMessage = Pick<
  CoreMessage,
  "id" | "firm_id" | "fund_name" | "fund_type" | "person" | "slot" | "position" | "emails" | "status" | "approved_hash"
> & { tier: number };

/** Why the campaign can't be built yet. Empty: it can. */
export function buildBlockers(input: {
  copyConfirmed: boolean;
  copyByType: boolean;
  coreFunds: number;
  core: CampaignMessage[];
}): string[] {
  const blockers: string[] = [];
  if (!input.copyByType) blockers.push("The email copy isn't written by fund type.");
  if (!input.copyConfirmed) blockers.push("The client hasn't confirmed the email copy yet.");
  const active = input.core.filter((m) => m.slot === "active");
  if (input.coreFunds > 0 && active.length === 0) blockers.push("Line up and write the Core contacts first.");
  const waiting = active.filter((m) => !isApproved(m));
  if (waiting.length > 0) {
    const names = waiting.slice(0, 3).map((m) => `${m.person.name || m.person.email} (${m.fund_name})`);
    blockers.push(
      `${waiting.length} Core contact${waiting.length === 1 ? " isn't" : "s aren't"} approved: ${names.join(", ")}${waiting.length > 3 ? "…" : ""}. Approve them or move them to reserve.`,
    );
  }
  return blockers;
}

/** First wave: each fund's first contact. Second wave, a few days later: the others. */
export function waveOf(message: Pick<CampaignMessage, "position">) {
  return message.position === 0 ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Export (Instantly CSV)

export const EXPORT_COLUMNS = [
  "email",
  "first_name",
  "last_name",
  "company_name",
  "tier",
  "fund_type",
  "wave",
  ...Array.from({ length: SEQUENCE_LENGTH }, (_, i) => [`subject_${i + 1}`, `body_${i + 1}`, `body_${i + 1}_html`]).flat(),
] as const;

const TIER_NAME: Record<number, string> = { 1: "Core", ...OTHER_TIER_LABEL };

function lastNameOf(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = firstNameOf(name);
  const index = parts.indexOf(first);
  return index >= 0 ? parts.slice(index + 1).join(" ") : parts.slice(1).join(" ");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text as simple HTML: blank lines make paragraphs, single newlines make <br>. */
export function textToHtml(value: string) {
  return value
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>;

/**
 * Rows for the export: active contacts whose text is exactly what was approved
 * (by Rupert for Core, by the client's confirmation for the rest). Anything
 * else is listed under `skipped`, never exported.
 */
export function exportRows(messages: CampaignMessage[], optOutLine: string, wave: 1 | 2 | null) {
  const rows: ExportRow[] = [];
  const skipped: CampaignMessage[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.slot !== "active") continue;
    if (wave && waveOf(m) !== wave) continue;
    const email = m.person.email.trim().toLowerCase();
    if (!email || seen.has(email) || !isApproved(m)) {
      if (!seen.has(email)) skipped.push(m);
      continue;
    }
    seen.add(email);
    const row: Record<string, string> = {
      email: m.person.email.trim(),
      first_name: m.person.first_name,
      last_name: lastNameOf(m.person.name),
      company_name: m.fund_name,
      tier: TIER_NAME[m.tier] ?? String(m.tier),
      fund_type: m.fund_type,
      wave: String(waveOf(m)),
    };
    m.emails.forEach((item, index) => {
      const optOut = optOutFor(index, optOutLine).trim();
      const body = optOut ? `${item.body.trimEnd()}\n\n${optOut}` : item.body.trimEnd();
      row[`subject_${index + 1}`] = item.subject.trim();
      row[`body_${index + 1}`] = body;
      row[`body_${index + 1}_html`] = textToHtml(body);
    });
    rows.push(row as ExportRow);
  }
  return { rows, skipped };
}

export function toCsv(rows: ExportRow[]) {
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const row of rows) lines.push(EXPORT_COLUMNS.map((column) => csvCell(row[column] ?? "")).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Counts for the campaign summary. */
export function campaignSummary(messages: CampaignMessage[]) {
  const active = messages.filter((m) => m.slot === "active");
  const byTier: Record<string, number> = {};
  for (const m of active) {
    const name = TIER_NAME[m.tier] ?? String(m.tier);
    byTier[name] = (byTier[name] ?? 0) + 1;
  }
  return {
    funds: new Set(active.map((m) => m.firm_id)).size,
    contacts: active.length,
    wave1: active.filter((m) => waveOf(m) === 1).length,
    wave2: active.filter((m) => waveOf(m) === 2).length,
    byTier,
    approved: active.filter((m) => isApproved(m)).length,
  };
}

export { emailsHash };
