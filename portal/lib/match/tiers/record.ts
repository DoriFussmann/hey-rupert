// The rows a saved match run stores: one per fund. Pure module.

import type { FirmOutcome, TierRun } from "./core.ts";

export type ResultRow = {
  firm_id: string;
  firm_name: string;
  status: "tiered" | "excluded" | "unresolved" | "generalist";
  tier: string;
  reason_codes: string[];
  detail: Record<string, unknown>;
  score: number | "";
  position: number;
};

/** Drops empty values so excluded funds stay small. */
function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) =>
      v != null && v !== "" && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0),
    ),
  );
}

/** A repeated FirmID is stored as "id#2", "id#3"…, so every Fund Database row keeps its own result. */
export function rowKey(firmId: string, occurrence: number) {
  return occurrence > 1 ? `${firmId}#${occurrence}` : firmId;
}

/** For a fund outside the tiers only the deciding check is kept: the audit needs why it failed, not what it passed. */
function keptChecks(outcome: FirmOutcome, listed: boolean) {
  if (listed) return outcome.checks;
  return Object.fromEntries(Object.entries(outcome.checks).filter(([, check]) => check && check.result !== "pass"));
}

export function tierRow(outcome: FirmOutcome, position: number): ResultRow {
  const listed = outcome.status === "tiered" || outcome.status === "generalist";
  return {
    firm_id: rowKey(outcome.firmId, outcome.occurrence),
    firm_name: outcome.name,
    status: outcome.status,
    tier: outcome.tier ?? "",
    reason_codes: outcome.reasons,
    detail: compact({
      notes: outcome.notes,
      checks: keptChecks(outcome, listed),
      sector: outcome.sector,
      firmSectors: listed ? outcome.firmSectors : [],
      generalistWhy: outcome.generalistWhy,
      fitParts: outcome.fitParts,
      confidence: outcome.confidence,
      contacts: listed ? outcome.contacts : [],
      flags: listed ? outcome.flags.map((flag) => `${flag.sev}: ${flag.text}`) : [],
      pros: outcome.pros,
      site: outcome.site,
      rejected: outcome.rejected,
      duplicate: outcome.duplicate,
      fof: outcome.fof
        ? { status: outcome.fof.status, evidenceUrl: outcome.fof.evidenceUrl, evidenceNote: outcome.fof.evidenceNote, rationale: outcome.fof.rationale, reviewedBy: outcome.fof.reviewedBy }
        : null,
      sectorTags: outcome.sectorTags,
      people: listed && !outcome.representedBy ? outcome.people : [],
      identity: outcome.identity,
      representedBy: outcome.representedBy,
    }),
    score: outcome.score ?? "",
    position,
  };
}

export function tierRows(run: TierRun) {
  return run.outcomes.map((outcome, i) => tierRow(outcome, i + 1));
}
