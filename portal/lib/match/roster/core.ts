// Step 3: The Final Roster. Pure module: the Dry Match shortlist, plus the
// funds brought back in 2C, plus the investors added in 2D that pass the
// Step 1 filters (missing fields filled in by the admin first), minus the
// client's own exclusions, matched strictly. Every entry keeps its source and
// the competitors it backed.

import type { DryData } from "../dry/core.ts";
import { MISSING_LABEL, missingFields, type MissingField } from "../added/core.ts";

export { MISSING_LABEL, missingFields, type MissingField };
import { firstFailure, indexFirms, matchInvestor, type CheckRow, type DbFirm, type SavedStepChoice } from "../landscape/check.ts";

export type RosterSource = "dry" | "brought_back" | "added";

export const SOURCE_LABEL: Record<RosterSource, string> = {
  dry: "Dry Match",
  brought_back: "Brought back",
  added: "Added",
};

export type RosterEntry = {
  firmId: string;
  name: string;
  website: string;
  source: RosterSource;
  /** The competitors it backed (2B), by name. Empty: none known. */
  backed: string[];
  /** Step 3: the comparable companies it backed (3B), by name. Absent on Rosters built before Step 3. */
  comparables?: string[];
  /** Step 3: the client named it (a strategic, or a lead they want pitched). */
  clientNamed?: boolean;
  /** For an added investor: its review status in the Fund Database. */
  addedStatus: "pending" | "approved" | null;
  kind: "fund" | "angel" | null;
};

/** An investor added in 2D, as 3A and 3B see it. */
export type AddedCheck = {
  addedId: string;
  firmId: string;
  name: string;
  kind: "fund" | "angel";
  status: "pending" | "approved";
  /** 3A: fields Step 1 would find empty. The admin fills them in; nothing is guessed. */
  missing: MissingField[];
  /**
   * 3B:
   * - missing: can't be filtered until the missing fields are filled in.
   * - pass: passes all four Step 1 filters.
   * - secondary: fails only on sector but lists the client's Secondary 1 or 2 (the 2C rule).
   * - fail: fails a filter; reason says which, with the investor's own values.
   * - not_found: not in this client's database (e.g. rejected since).
   */
  result: "missing" | "pass" | "secondary" | "fail" | "not_found";
  reason: string;
};

export type AddedInput = { id: string; firmId: string; name: string; kind: "fund" | "angel"; status: "pending" | "approved" | "rejected" };

export type ExclusionCheck = {
  line: string;
  /** excluded: a clear match on the Roster. not_on_roster: a clear match that isn't on the Roster anyway. not_matched: no clear match; ignored. */
  result: "excluded" | "not_on_roster" | "not_matched";
  firmId: string | null;
  firmName: string | null;
};

export type RosterCounts = {
  dry: number;
  broughtBack: number;
  added: number;
  /** Before exclusions. */
  combined: number;
  excluded: number;
  total: number;
  backed: number;
  /** Step 3: backed a comparable company, and named by the client. */
  comparables?: number;
  clientNamed?: number;
  /** Added investors that failed a filter, and still waiting for missing fields. */
  addedFailed: number;
  addedMissing: number;
  /** Shortlist funds no longer in the database. */
  gone: number;
};

export type Roster = {
  entries: RosterEntry[];
  added: AddedCheck[];
  exclusions: ExclusionCheck[];
  counts: RosterCounts;
};

/** The client's exclusions, one per line (commas and semicolons also separate), as the engine has always split them. */
export function exclusionLines(text: string): string[] {
  const seen = new Set<string>();
  return (text ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (s.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** A line that is a website, not a name: "acme.vc", "https://www.acme.vc/team". */
function asWebsite(line: string): string {
  const bare = line.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : "";
}

export function buildRoster(input: {
  /** Built on the client's live database, added investors included. */
  data: DryData;
  firms: DbFirm[];
  /** The confirmed Step 1 choices and shortlist. */
  steps: SavedStepChoice[];
  shortlist: string[];
  /** The 2C rows. Empty when Step 2 was skipped. */
  rows: CheckRow[];
  /** The 3C rows (Companies Like You). Empty when Step 3 was skipped. */
  likeRows?: CheckRow[];
  /** The investors added from this client's Step 2 and Step 3. */
  added: AddedInput[];
  /** Funds Rupert added by hand for this client: on the Roster whatever the Step 1 filters say. */
  manual?: { firmId: string; kind: "fund" | "angel" }[];
  /** The client's sector labels (primary and secondary), for the 2C rule. */
  clientSectors: string[];
  exclusions: string;
}): Roster {
  const fundById = new Map(input.data.funds.map((f) => [f.id, f]));
  const firmById = new Map(input.firms.map((f) => [f.id, f]));

  // Who backed which competitor (Step 2), and which comparable company (Step 3), by database record.
  const likeRows = input.likeRows ?? [];
  const tally = (rows: CheckRow[]) => {
    const by = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.bucket === "removed") continue;
      const id = row.firmId ?? row.added?.firmId ?? null;
      if (!id) continue;
      const set = by.get(id) ?? new Set<string>();
      row.investor.backed.forEach((b) => b.competitor && set.add(b.competitor));
      by.set(id, set);
    }
    return by;
  };
  const backedBy = tally(input.rows);
  const comparablesBy = tally(likeRows);
  const namedByClient = new Set(
    likeRows.filter((r) => r.investor.clientNamed && r.bucket !== "removed").map((r) => r.firmId ?? r.added?.firmId ?? null).filter((x): x is string => !!x),
  );

  const entries = new Map<string, RosterEntry>();
  const put = (firmId: string, source: RosterSource, extra?: Partial<RosterEntry>) => {
    if (entries.has(firmId)) return false;
    const firm = firmById.get(firmId);
    entries.set(firmId, {
      firmId,
      name: firm?.name ?? firmId,
      website: firm?.web ?? "",
      source,
      backed: Array.from(backedBy.get(firmId) ?? []).sort(),
      comparables: Array.from(comparablesBy.get(firmId) ?? []).sort(),
      clientNamed: namedByClient.has(firmId),
      addedStatus: null,
      kind: null,
      ...extra,
    });
    return true;
  };

  let gone = 0;
  let dry = 0;
  for (const id of input.shortlist) {
    if (!fundById.has(id)) {
      gone += 1;
      continue;
    }
    if (put(id, "dry")) dry += 1;
  }

  let broughtBack = 0;
  for (const row of [...input.rows, ...likeRows]) {
    if (row.bucket === "not_in_list" && row.action === "bring_back" && row.firmId && fundById.has(row.firmId)) {
      if (put(row.firmId, "brought_back")) broughtBack += 1;
    }
  }

  const lower = new Set(input.clientSectors.map((s) => s.toLowerCase()));
  const added: AddedCheck[] = [];
  const seenAdded = new Set<string>();
  let addedIn = 0;
  for (const a of input.added) {
    if (a.status === "rejected" || seenAdded.has(a.firmId)) continue;
    seenAdded.add(a.firmId);
    const base = { addedId: a.id, firmId: a.firmId, name: a.name, kind: a.kind, status: a.status };
    const fund = fundById.get(a.firmId);
    if (!fund) {
      added.push({ ...base, missing: [], result: "not_found", reason: "Not in this client's database." });
      continue;
    }
    const missing = missingFields(fund);
    if (missing.length) {
      added.push({ ...base, missing, result: "missing", reason: `Missing: ${missing.map((m) => MISSING_LABEL[m]).join(", ")}.` });
      continue;
    }
    const failure = firstFailure(input.data, fund, input.steps);
    let result: AddedCheck["result"] = "pass";
    let reason = "Passes all four Step 1 filters.";
    if (failure) {
      const sectors = fund.sector.map((i) => input.data.labels.sector[i]).filter((s) => lower.has(s.toLowerCase()));
      if (failure.step === "sector" && sectors.length) {
        result = "secondary";
        reason = `Fails only on sector, but lists ${sectors.join(", ")}: the client's sub-sector.`;
      } else {
        result = "fail";
        reason = `${failure.label}: ${failure.fundValues}.`;
      }
    }
    added.push({ ...base, missing: [], result, reason });
    if (result === "pass" || result === "secondary") {
      if (put(a.firmId, "added", { addedStatus: a.status, kind: a.kind })) addedIn += 1;
    }
  }

  for (const m of input.manual ?? []) {
    if (firmById.has(m.firmId) && put(m.firmId, "added", { addedStatus: "approved", kind: m.kind })) addedIn += 1;
  }

  // Exclusions: only a clear match (website, or the same name) counts. Anything else is shown and ignored.
  const index = indexFirms(input.firms);
  const combined = entries.size;
  const exclusions: ExclusionCheck[] = exclusionLines(input.exclusions).map((line) => {
    const match = matchInvestor({ name: line, website: asWebsite(line) }, index);
    const clear = match.how === "website" || match.how === "name";
    const firmId = clear ? match.firmIds[0] : null;
    const firmName = firmId ? firmById.get(firmId)?.name ?? null : null;
    if (!firmId) return { line, result: "not_matched", firmId: null, firmName: null };
    if (entries.has(firmId)) {
      entries.delete(firmId);
      return { line, result: "excluded", firmId, firmName };
    }
    return { line, result: "not_on_roster", firmId, firmName };
  });

  const order: Record<RosterSource, number> = { dry: 0, brought_back: 1, added: 2 };
  const list = Array.from(entries.values()).sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));
  return {
    entries: list,
    added,
    exclusions,
    counts: {
      dry,
      broughtBack,
      added: addedIn,
      combined,
      excluded: exclusions.filter((e) => e.result === "excluded").length,
      total: list.length,
      backed: list.filter((e) => e.backed.length).length,
      comparables: list.filter((e) => e.comparables?.length).length,
      clientNamed: list.filter((e) => e.clientNamed).length,
      addedFailed: added.filter((a) => a.result === "fail" || a.result === "not_found").length,
      addedMissing: added.filter((a) => a.result === "missing").length,
      gone,
    },
  };
}
