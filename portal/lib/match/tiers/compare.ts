// Side-by-side comparison of a saved current-engine run and a saved four-tier
// run of the same client, Fund Database version and profile. Pure module:
// built from the stored results only, so it shows exactly what was saved.

import { NOTE_LABEL, REASONS, TIER_INFO, TIER_KEYS, type NoteCode, type ReasonCode, type TierKey } from "./core.ts";

export const LEGACY_TIERS = ["bullseye", "match", "expansion"] as const;
export type LegacyTier = (typeof LEGACY_TIERS)[number];

export const LEGACY_LABEL: Record<LegacyTier, string> = {
  bullseye: "Bullseye",
  match: "Match",
  expansion: "Expansion",
};

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

/** Where a firm ended up in the four-tier run. */
export type NewPlace = TierKey | "generalist" | "unresolved" | "excluded" | "rejected" | "represented";
export const NEW_PLACES: NewPlace[] = [...TIER_KEYS, "rejected", "generalist", "unresolved", "excluded", "represented"];
export type OldPlace = LegacyTier | "rejected" | "not_listed";
export const OLD_PLACES: OldPlace[] = [...LEGACY_TIERS, "rejected", "not_listed"];

export function newPlaceLabel(place: NewPlace) {
  if ((TIER_KEYS as readonly string[]).includes(place)) return TIER_INFO[place as TierKey].label;
  return {
    generalist: "Generalists",
    unresolved: "Unresolved",
    excluded: "Excluded",
    rejected: "Rejected for client",
    represented: "Shown as another record of the firm",
  }[place as "generalist" | "unresolved" | "excluded" | "rejected" | "represented"];
}

export function oldPlaceLabel(place: OldPlace) {
  if ((LEGACY_TIERS as readonly string[]).includes(place)) return LEGACY_LABEL[place as LegacyTier];
  return place === "rejected" ? "Rejected for client" : "Not listed";
}

export function reasonLabel(code: string) {
  return (REASONS as Record<string, { label: string }>)[code]?.label ?? code;
}

export function noteLabel(code: string) {
  return NOTE_LABEL[code as NoteCode] ?? code;
}

export type MovementRow = {
  firmId: string;
  name: string;
  old: OldPlace;
  oldWhy: string;
  next: NewPlace;
  /** The deciding reason code (empty when tiered). */
  reason: string;
  why: string;
  notes: string[];
  duplicate: string;
};

export type Comparison = {
  oldCounts: Record<OldPlace, number>;
  newCounts: Record<NewPlace, number>;
  /** old place → new place → funds. */
  matrix: Record<OldPlace, Record<NewPlace, number>>;
  /** Every fund that was listed before, or is in a tier, a group or unresolved now. */
  rows: MovementRow[];
  dropped: MovementRow[];
  added: MovementRow[];
  /** Totals per deciding reason, for funds not in a tier. */
  reasons: { code: string; label: string; status: string; funds: number; wereListed: number }[];
  duplicates: MovementRow[];
};

function oldPlaceOf(row: StoredResult | undefined): OldPlace {
  if (!row || row.status !== "tiered") return "not_listed";
  if (row.detail.rejected) return "rejected";
  return (LEGACY_TIERS as readonly string[]).includes(row.tier ?? "") ? (row.tier as LegacyTier) : "not_listed";
}

function newPlaceOf(row: StoredResult): NewPlace {
  if (row.detail.representedBy) return "represented";
  if (row.status === "tiered") return row.detail.rejected ? "rejected" : ((row.tier ?? "excluded") as NewPlace);
  return row.status;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** The plain-language reason behind a four-tier result. */
export function whyOf(row: StoredResult) {
  if (row.detail.representedBy) return `Same firm as ${String(row.detail.representedBy)}, which is shown instead.`;
  const checks = (row.detail.checks ?? {}) as Record<string, { result: string; detail: string }>;
  if (row.status === "tiered") return text(checks.sector?.detail);
  const deciding = row.reasonCodes[row.reasonCodes.length - 1] ?? "";
  if (deciding === "dead_website") return `Website check: ${text(row.detail.site)}.`;
  const failing = Object.values(checks).find((check) => check.result !== "pass");
  return failing?.detail ?? reasonLabel(deciding);
}

export function compareRuns(legacy: StoredResult[], tiers: StoredResult[]): Comparison {
  const oldById = new Map(legacy.map((row) => [row.firmId, row]));
  const oldCounts = Object.fromEntries(OLD_PLACES.map((p) => [p, 0])) as Record<OldPlace, number>;
  const newCounts = Object.fromEntries(NEW_PLACES.map((p) => [p, 0])) as Record<NewPlace, number>;
  const matrix = Object.fromEntries(
    OLD_PLACES.map((o) => [o, Object.fromEntries(NEW_PLACES.map((n) => [n, 0]))]),
  ) as Comparison["matrix"];

  const rows: MovementRow[] = [];
  const reasonTotals = new Map<string, { funds: number; wereListed: number }>();
  for (const row of tiers) {
    const before = oldById.get(row.firmId);
    const old = oldPlaceOf(before);
    const next = newPlaceOf(row);
    if (old !== "not_listed") oldCounts[old] += 1;
    newCounts[next] += 1;
    matrix[old][next] += 1;
    const reason = row.status === "tiered" || row.detail.representedBy ? "" : row.reasonCodes[row.reasonCodes.length - 1] ?? "";
    if (reason) {
      const entry = reasonTotals.get(reason) ?? { funds: 0, wereListed: 0 };
      entry.funds += 1;
      if (old !== "not_listed") entry.wereListed += 1;
      reasonTotals.set(reason, entry);
    }
    const listedNow = next !== "excluded" && next !== "represented";
    if (old === "not_listed" && !listedNow) continue;
    const duplicate = row.detail.duplicate as { level?: string; otherIds?: string[] } | undefined;
    rows.push({
      firmId: row.firmId,
      name: row.firmName,
      old,
      oldWhy: text(before?.detail.why),
      next,
      reason,
      why: whyOf(row),
      notes: ((row.detail.notes ?? []) as string[]).map(noteLabel),
      duplicate: duplicate?.level ? `${duplicate.level}: also ${(duplicate.otherIds ?? []).join(", ")}` : "",
    });
  }
  // Firms the current engine listed that the new run has no row for (not in this Fund Database version).
  const seen = new Set(tiers.map((row) => row.firmId));
  for (const row of legacy) {
    if (seen.has(row.firmId)) continue;
    const old = oldPlaceOf(row);
    if (old === "not_listed") continue;
    oldCounts[old] += 1;
    matrix[old].excluded += 1;
    rows.push({ firmId: row.firmId, name: row.firmName, old, oldWhy: text(row.detail.why), next: "excluded", reason: "", why: "Not in the four-tier run.", notes: [], duplicate: "" });
  }

  const tierOrder = (place: OldPlace | NewPlace) =>
    ([...TIER_KEYS, ...LEGACY_TIERS, "rejected", "generalist", "unresolved", "excluded", "represented", "not_listed"] as string[]).indexOf(place);
  rows.sort((a, b) => tierOrder(a.old) - tierOrder(b.old) || tierOrder(a.next) - tierOrder(b.next) || a.name.localeCompare(b.name));

  const inTier = (place: NewPlace) => (TIER_KEYS as readonly string[]).includes(place);
  return {
    oldCounts,
    newCounts,
    matrix,
    rows,
    dropped: rows.filter((r) => r.old !== "not_listed" && r.old !== "rejected" && !inTier(r.next)),
    added: rows.filter((r) => r.old === "not_listed" && inTier(r.next)),
    reasons: Array.from(reasonTotals.entries())
      .map(([code, value]) => ({
        code,
        label: reasonLabel(code),
        status: (REASONS as Record<string, { status: string }>)[code]?.status ?? "",
        ...value,
      }))
      .sort((a, b) => b.funds - a.funds),
    duplicates: rows.filter((r) => r.duplicate),
  };
}

export type { ReasonCode };
