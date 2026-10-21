// Exports of a saved four-tier run. Pure module: every export is built from
// one saved run's stored rows, so it can always be traced back to that run,
// its rules version and its inputs. An export never runs the engine.

import { VERIFY_LABEL, type VerifyState } from "../verify.ts";
import { NOTE_LABEL, REASONS, TIER_INFO, TIER_KEYS, type IdentityDetail, type NoteCode, type PersonRecord, type TierKey } from "./core.ts";
import type { StoredResult } from "./compare.ts";

export type RunHeaderLike = {
  id: string;
  clientName: string;
  rulesVersion: string;
  taxonomyRevision: number;
  profileVersion: number | null;
  fundDbVersion: string;
  fundDbFile: string;
  ranAt: string;
  ranBy: string | null;
  resultsExpected: number;
  profileInputs: Record<string, unknown>;
  settings: Record<string, unknown>;
};

/** Stored verification per contact (FirmID|email key) and this client's keep/remove decision. */
export type ContactStates = Map<
  string,
  { email: string; status: VerifyState | null; checkedAt: string | null; decision: "keep" | "remove" | null }
>;

/** Statuses left out by default, unless kept for this client (as in today's export). */
const KNOWN_PROBLEMS = new Set<VerifyState>(["email_bad", "left_firm", "role_changed", "not_found"]);

const emailKey = (email: string) => email.trim().toLowerCase();

export function verifyStateOf(person: PersonRecord, states: ContactStates): VerifyState {
  if (!person.email) return "unverified";
  const state = states.get(`${person.fid}|${person.key}`);
  if (!state?.status) return "unverified";
  return emailKey(state.email) === emailKey(person.email) ? state.status : "unverified";
}

const label = (v: unknown) => (v as { label?: string | null } | null)?.label ?? "";

export function runFacts(header: RunHeaderLike, complete: boolean): (string | number)[][] {
  const inputs = header.profileInputs;
  const identities = Array.isArray(header.settings.identities) ? (header.settings.identities as unknown[]).length : 0;
  const warnings = Array.isArray(inputs.warnings) ? (inputs.warnings as string[]) : [];
  return [
    ["Saved run", header.id],
    ["Client", header.clientName],
    ["Ran", header.ranAt],
    ["Ran by", header.ranBy ?? ""],
    ["Complete", complete ? "Yes" : "No: not every result was saved"],
    ["Rules", header.rulesVersion],
    ["Taxonomy revision", header.taxonomyRevision],
    ["Company profile version", header.profileVersion ?? "Legacy profile"],
    ["Fund Database", `${header.fundDbFile} (${header.fundDbVersion})`],
    ["Primary sector", label(inputs.primarySector)],
    ["Secondary sectors", Array.isArray(inputs.secondarySectors) ? (inputs.secondarySectors as unknown[]).map(label).join(", ") || "None" : ""],
    ["Stage", label(inputs.stage)],
    ["HQ", [label(inputs.hqCountry), label(inputs.hqState)].filter(Boolean).join(", ")],
    ["Readiness", String(inputs.readiness ?? "")],
    ["Identity groups applied", identities],
    ...warnings.map((w, i) => [i === 0 ? "Profile warnings" : "", w]),
  ];
}

function placeOf(row: StoredResult) {
  if (row.status === "tiered") return TIER_INFO[row.tier as TierKey]?.label ?? row.tier ?? "";
  return { generalist: "Generalist", unresolved: "Unresolved", excluded: "Excluded" }[row.status as "generalist" | "unresolved" | "excluded"] ?? row.status;
}

function reasonOf(row: StoredResult) {
  const code = row.reasonCodes[row.reasonCodes.length - 1];
  return code ? (REASONS as Record<string, { label: string }>)[code]?.label ?? code : "";
}

function checkText(row: StoredResult, key: string) {
  const checks = (row.detail.checks ?? {}) as Record<string, { result: string; detail: string }>;
  return checks[key]?.detail ?? "";
}

function identityText(row: StoredResult) {
  const identity = row.detail.identity as IdentityDetail | undefined;
  if (!identity) return "";
  const others = identity.members.filter((m) => m.firmId !== row.firmId);
  return `${identity.kind === "offices" ? "Offices" : "Duplicate records"} (${identity.status === "confirmed" ? `confirmed by ${identity.decidedBy ?? "admin"}` : "applied automatically"}). ${identity.derivation} Other records: ${others
    .map((m) => `${m.firmId} ${m.country}: ${m.status === "tiered" ? TIER_INFO[m.tier as TierKey]?.label : m.status}${m.rejected ? " (rejected for this client)" : ""}`)
    .join("; ")}`;
}

const noteText = (row: StoredResult) => ((row.detail.notes ?? []) as string[]).map((n) => NOTE_LABEL[n as NoteCode] ?? n).join("; ");

/** Listed funds, one row each, tier by tier, in the saved order. Records shown through another record are left out. */
export function fundRows(rows: StoredResult[]) {
  const header = [
    "Tier", "Rank", "FirmID", "Fund", "Fit", "Rejected for client", "Relationship used", "Why this tier",
    "Stage evidence", "Geography evidence", "Firm sectors", "Notes", "Same firm as", "Website check",
  ];
  const out: (string | number)[][] = [header];
  for (const tier of TIER_KEYS) {
    let rank = 0;
    for (const row of rows) {
      if (row.status !== "tiered" || row.tier !== tier || row.detail.representedBy) continue;
      rank += 1;
      const sector = row.detail.sector as { relation?: string; companySectorLabel?: string; firmSectorLabel?: string; edgeId?: string | null } | undefined;
      out.push([
        TIER_INFO[tier].label,
        rank,
        row.firmId,
        row.firmName,
        row.score ?? "",
        row.detail.rejected ? String(row.detail.rejected) : "",
        sector ? `${sector.companySectorLabel} → ${sector.firmSectorLabel} (${sector.relation}${sector.edgeId ? `, ${sector.edgeId}` : ""})` : "",
        checkText(row, "sector"),
        checkText(row, "stage"),
        checkText(row, "geography"),
        ((row.detail.sectorTags ?? []) as string[]).join(", "),
        noteText(row),
        identityText(row),
        String(row.detail.site ?? ""),
      ]);
    }
  }
  return out;
}

/**
 * Investing contacts of the listed funds. By default, contacts with a known
 * problem are left out unless kept for this client, as in today's export.
 * A person who appears under two funds is listed once.
 */
export function contactRows(rows: StoredResult[], states: ContactStates, includeAll = false) {
  const header = ["Tier", "Fund", "FirmID of the contact", "Sequence", "Name", "Title", "Role", "Email", "Phone", "City", "Country", "Score", "Verification"];
  const out: (string | number)[][] = [header];
  const seen = new Set<string>();
  let leftOut = 0;
  let repeated = 0;
  for (const tier of TIER_KEYS) {
    for (const row of rows) {
      if (row.status !== "tiered" || row.tier !== tier || row.detail.representedBy || row.detail.rejected) continue;
      for (const person of (row.detail.people ?? []) as PersonRecord[]) {
        const state = verifyStateOf(person, states);
        const decision = states.get(`${person.fid}|${person.key}`)?.decision ?? null;
        if (!includeAll && KNOWN_PROBLEMS.has(state) && decision !== "keep") {
          leftOut += 1;
          continue;
        }
        const key = emailKey(person.email);
        if (key && seen.has(key)) {
          repeated += 1;
          continue;
        }
        if (key) seen.add(key);
        out.push([
          TIER_INFO[tier].label, row.firmName, person.fid, person.seq, person.name, person.title, person.role,
          person.email, person.phone, person.city, person.country, person.score,
          VERIFY_LABEL[state] + (decision === "keep" && state !== "clean" ? " (kept)" : ""),
        ]);
      }
    }
  }
  return { rows: out, leftOut, repeated };
}

/**
 * Funds outside the tiers: generalists, unresolved and excluded, each with its
 * deciding reason and evidence; then records shown through another record.
 */
export function outsideRows(rows: StoredResult[]) {
  const header = ["Status", "Reason", "FirmID", "Fund", "Evidence", "Firm sectors"];
  const out: (string | number)[][] = [header];
  for (const status of ["generalist", "unresolved", "excluded"] as const) {
    for (const row of rows) {
      if (row.status !== status || row.detail.representedBy) continue;
      const checks = (row.detail.checks ?? {}) as Record<string, { result: string; detail: string }>;
      const failing = Object.values(checks).find((c) => c.result !== "pass");
      out.push([
        placeOf(row),
        reasonOf(row),
        row.firmId,
        row.firmName,
        row.reasonCodes.includes("dead_website") ? `Website check: ${String(row.detail.site ?? "")}` : failing?.detail ?? "",
        ((row.detail.sectorTags ?? []) as string[]).join(", "),
      ]);
    }
  }
  for (const row of rows) {
    if (!row.detail.representedBy) continue;
    out.push(["Shown as another record", `Same firm as ${String(row.detail.representedBy)}`, row.firmId, row.firmName, `Own result: ${placeOf(row)}${reasonOf(row) ? `, ${reasonOf(row)}` : ""}`, ((row.detail.sectorTags ?? []) as string[]).join(", ")]);
  }
  return out;
}

export const NEAR_MISS_BANNER = [
  "NOT AN ELIGIBLE MATCH LIST. These funds FAILED the stage check and are outside every tier.",
  "They list a stage next to the company's, not the company's own. Do not send, import or use as an investor list.",
];

/** Funds excluded as one stage off, for review only. */
export function nearMissRows(rows: StoredResult[]) {
  const header = ["Status", "FirmID", "Fund", "Stage evidence", "Firm sectors"];
  const out: (string | number)[][] = [header];
  for (const row of rows) {
    if (row.reasonCodes[row.reasonCodes.length - 1] !== "stage_one_off") continue;
    out.push(["NOT ELIGIBLE: one stage off", row.firmId, row.firmName, checkText(row, "stage"), ((row.detail.sectorTags ?? []) as string[]).join(", ")]);
  }
  return out;
}

/** Counts read back from the stored rows, so a view or export never relies on the run's own totals alone. */
export function storedCounts(rows: StoredResult[]) {
  const tiers = Object.fromEntries(TIER_KEYS.map((k) => [k, 0])) as Record<TierKey, number>;
  const reasons: Record<string, number> = {};
  let generalists = 0, unresolved = 0, excluded = 0, rejected = 0, represented = 0;
  for (const row of rows) {
    if (row.detail.representedBy) {
      represented += 1;
      continue;
    }
    if (row.status === "tiered") {
      if (row.detail.rejected) rejected += 1;
      else tiers[row.tier as TierKey] += 1;
    } else {
      if (row.status === "generalist") generalists += 1;
      if (row.status === "unresolved") unresolved += 1;
      if (row.status === "excluded") excluded += 1;
      const code = row.reasonCodes[row.reasonCodes.length - 1];
      if (code) reasons[code] = (reasons[code] ?? 0) + 1;
    }
  }
  return { tiers, generalists, unresolved, excluded, rejected, represented, reasons, total: rows.length };
}
