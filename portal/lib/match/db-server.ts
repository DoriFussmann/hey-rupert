import "server-only";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { gunzipSync, gzipSync } from "node:zlib";
import ExcelJS from "exceljs";
import RME, { type Firm, type FundDb } from "@/lib/match/engine/index.mjs";
import { FUND_DB_BUCKET, type FundDbDiff, type FundDbVersion } from "@/lib/match/shared";
import type { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;

export const FUND_UPLOAD_FOLDER = "uploads/";

export const MATCH_MIGRATION_MISSING =
  "Rupert Match is not set up in the database yet. Run portal/supabase/rupert_match.sql in Supabase.";

export function matchTableError(message: string, code?: string) {
  if (
    code === "42P01" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST205" ||
    /fund_db_versions|match_profiles|match_reviews|match_suppressions|match_site_checks|apply_fund_db_version/.test(
      message,
    ) ||
    message.toLowerCase().includes("schema cache")
  ) {
    return MATCH_MIGRATION_MISSING;
  }
  return message;
}

/** Reads every row of a query, 1,000 at a time (the API's page size). */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string; code?: string } | null;
  }>,
): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return { ok: false, error: matchTableError(error.message, error.code) };
    rows.push(...(data ?? []));
    if (!data || data.length < size) return { ok: true, rows };
  }
}

// ---------------------------------------------------------------------------
// Workbook format (see the handoff's data/DATA.md)

const SHEETS = {
  firms: {
    name: "Firms",
    columns: [
      "FirmID", "Firm Name", "Type of Firm", "Region", "Year Founded", "Stage",
      "Financing", "Industry", "Vertical", "Geography", "City", "State",
      "Country", "Website", "Email", "Phone", "Total Contacts",
    ],
  },
  contacts: {
    name: "All Contacts",
    columns: [
      "FirmID", "First Name", "Last Name", "Prefix", "Title", "Work Email",
      "Work Phone", "City", "State", "Country", "Office Type",
      "Principal Contact", "Office Lead Contact", "Firm Match",
    ],
  },
  offices: {
    name: "Offices",
    columns: ["Firm Name", "City", "Country", "Office Type"],
  },
} as const;

type SheetKey = keyof typeof SHEETS;
type Row = Record<string, string | number | null>;

/** Which sheet a header row belongs to, when the sheet name doesn't say. */
function sheetFromHeader(header: string[]): SheetKey | null {
  const has = (column: string) => header.includes(column);
  if (has("FirmID") && has("Work Email")) return "contacts";
  if (has("FirmID") && has("Type of Firm")) return "firms";
  if (!has("FirmID") && has("Firm Name") && has("Office Type")) return "offices";
  return null;
}

function sheetFromName(name: string | undefined): SheetKey | null {
  const clean = String(name ?? "").trim().toLowerCase();
  for (const key of Object.keys(SHEETS) as SheetKey[]) {
    if (SHEETS[key].name.toLowerCase() === clean) return key;
  }
  return null;
}

function cellValue(value: ExcelJS.CellValue): string | number | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && value.text != null) return String(value.text);
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("error" in value) return null;
  }
  return String(value);
}

type ParsedWorkbook = Record<SheetKey, Row[] | null>;

/** Streams the workbook and keeps only the columns matching uses. */
async function readWorkbook(
  buffer: Buffer,
): Promise<{ ok: true; sheets: ParsedWorkbook } | { ok: false; errors: string[] }> {
  const sheets: ParsedWorkbook = { firms: null, contacts: null, offices: null };
  const errors: string[] = [];
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
    entries: "ignore",
  });

  try {
    for await (const worksheet of reader) {
      const named = sheetFromName((worksheet as unknown as { name?: string }).name);
      let key: SheetKey | null = null;
      let columns: Map<number, string> | null = null;
      let skip = false;

      for await (const row of worksheet) {
        if (skip) continue;
        const values = (row.values as ExcelJS.CellValue[]) ?? [];
        if (!columns) {
          const header = values.map((value) => String(cellValue(value) ?? "").trim());
          if (header.every((cell) => !cell)) continue;
          key = named ?? sheetFromHeader(header);
          if (!key || sheets[key]) {
            skip = true;
            continue;
          }
          const wanted = new Set<string>(SHEETS[key].columns);
          const missing = SHEETS[key].columns.filter((column) => !header.includes(column));
          if (missing.length > 0) {
            errors.push(
              `The ${SHEETS[key].name} sheet is missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
            );
            skip = true;
            continue;
          }
          columns = new Map();
          header.forEach((name, index) => {
            if (wanted.has(name) && !Array.from(columns!.values()).includes(name)) {
              columns!.set(index, name);
            }
          });
          sheets[key] = [];
          continue;
        }
        const record: Row = {};
        let empty = true;
        for (const [index, name] of Array.from(columns.entries())) {
          const value = cellValue(values[index]);
          const clean = typeof value === "string" ? value.trim() || null : value;
          if (clean != null) empty = false;
          record[name] = clean;
        }
        if (!empty) sheets[key!]!.push(record);
      }
    }
  } catch (err) {
    return {
      ok: false,
      errors: [
        `The file could not be read as an Excel workbook (${err instanceof Error ? err.message : "unknown error"}). Save it as .xlsx and try again.`,
      ],
    };
  }

  if (!sheets.firms && !errors.some((error) => error.includes("Firms sheet"))) {
    errors.push('No "Firms" sheet found.');
  }
  if (!sheets.contacts && !errors.some((error) => error.includes("All Contacts sheet"))) {
    errors.push('No "All Contacts" sheet found.');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, sheets };
}

/** Values the matching rules don't know: a sign the vendor changed its taxonomy. */
function vocabularyWarnings(firms: Firm[]) {
  const known = {
    "Type of Firm": new Set<string>([
      "Venture Capital Investment Firm",
      "Private Equity Investment Firm",
      "Family Investment Office",
      "Angel Investor Group",
    ]),
    Stage: new Set([...RME.VC_LADDER, ...RME.PE_STAGES]),
    Industry: new Set(RME.INDUSTRIES),
    Vertical: new Set(RME.VERTICALS),
  };
  const unknown: Record<keyof typeof known, Map<string, number>> = {
    "Type of Firm": new Map(),
    Stage: new Map(),
    Industry: new Map(),
    Vertical: new Map(),
  };
  const note = (field: keyof typeof known, value: string) => {
    if (value && !known[field].has(value)) {
      unknown[field].set(value, (unknown[field].get(value) ?? 0) + 1);
    }
  };
  for (const firm of firms) {
    note("Type of Firm", firm.type);
    firm.stages.forEach((value) => note("Stage", value));
    firm.ind.forEach((value) => note("Industry", value));
    firm.vert.forEach((value) => note("Vertical", value));
  }
  const warnings: string[] = [];
  for (const [field, values] of Object.entries(unknown)) {
    if (values.size === 0) continue;
    const list = Array.from(values.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([value, count]) => `"${value}" (${count})`)
      .join(", ");
    warnings.push(
      `${field}: values the matching rules don't recognise yet, so these tags are ignored: ${list}${values.size > 6 ? ", …" : ""}.`,
    );
  }
  return warnings;
}

export type StagedWorkbook = {
  db: FundDb;
  offices: number;
  warnings: string[];
};

/** Parses, validates and normalizes a workbook. */
export async function buildFundDb(
  buffer: Buffer,
): Promise<{ ok: true; value: StagedWorkbook } | { ok: false; errors: string[] }> {
  const read = await readWorkbook(buffer);
  if (!read.ok) return read;
  const { firms, contacts, offices } = read.sheets;
  if (!firms || !contacts) return { ok: false, errors: ["The workbook is incomplete."] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let noId = 0;
  const firmRows = firms.filter((row) => {
    const id = String(row.FirmID ?? "").trim();
    if (!id) {
      noId += 1;
      return false;
    }
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
    return true;
  });
  if (firmRows.length === 0) errors.push("The Firms sheet has no funds.");
  if (duplicates.size > 0) {
    errors.push(
      `${duplicates.size} FirmID${duplicates.size > 1 ? "s are" : " is"} used more than once (e.g. ${Array.from(duplicates).slice(0, 3).join(", ")}). Each fund needs its own FirmID, because reviews are kept by FirmID.`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  if (noId > 0) warnings.push(`${noId} row${noId > 1 ? "s" : ""} in Firms had no FirmID and were skipped.`);
  if (!offices) warnings.push('No "Offices" sheet: office locations are not used.');
  const orphans = contacts.filter((row) => !seen.has(String(row.FirmID ?? "").trim())).length;
  if (orphans > 0) {
    warnings.push(`${orphans} contact${orphans > 1 ? "s" : ""} point to a FirmID that isn't in Firms and are not used.`);
  }

  const db = RME.normalize(firmRows, contacts, offices ?? []);
  warnings.push(...vocabularyWarnings(db.firms));
  return { ok: true, value: { db, offices: offices?.length ?? 0, warnings } };
}

function firmKey(firm: Firm) {
  return JSON.stringify(firm);
}

/** What changes between the live database and a new one. */
export function diffFundDb(
  previous: FundDb | null,
  next: FundDb,
  reviewedFirmIds: Set<string>,
  warnings: string[],
): FundDbDiff {
  if (!previous) {
    return {
      previous: null,
      added: next.firms.length,
      removed: 0,
      changed: 0,
      addedSample: [],
      removedSample: [],
      reviewsOnRemoved: 0,
      warnings,
    };
  }
  const before = new Map(previous.firms.map((firm) => [firm.id, firm]));
  const after = new Map(next.firms.map((firm) => [firm.id, firm]));
  const added = next.firms.filter((firm) => !before.has(firm.id));
  const removed = previous.firms.filter((firm) => !after.has(firm.id));
  const changed = next.firms.filter((firm) => {
    const old = before.get(firm.id);
    return old && firmKey(old) !== firmKey(firm);
  }).length;
  const allWarnings = [...warnings];
  if (next.firms.length < previous.firms.length * 0.75) {
    allWarnings.unshift(
      `This file has ${next.firms.length.toLocaleString("en-US")} funds, against ${previous.firms.length.toLocaleString("en-US")} today. Is it the full database?`,
    );
  }
  return {
    previous: { firms: previous.firms.length, contacts: previous.contacts.length },
    added: added.length,
    removed: removed.length,
    changed,
    addedSample: added.slice(0, 8).map((firm) => firm.name),
    removedSample: removed.slice(0, 8).map((firm) => firm.name),
    reviewsOnRemoved: removed.filter((firm) => reviewedFirmIds.has(firm.id)).length,
    warnings: allWarnings,
  };
}

// ---------------------------------------------------------------------------
// Snapshots and the in-memory cache

export function snapshotBytes(db: FundDb) {
  return gzipSync(JSON.stringify({ firms: db.firms, contacts: db.contacts }));
}

function parseSnapshot(bytes: Buffer): FundDb {
  const parsed = JSON.parse(gunzipSync(bytes).toString("utf8")) as FundDb;
  if (!Array.isArray(parsed.firms) || !Array.isArray(parsed.contacts)) {
    throw new Error("The stored fund database snapshot is damaged.");
  }
  return { firms: parsed.firms, contacts: parsed.contacts };
}

export type LiveDb = {
  version: { id: string; fileName: string; firms: number; contacts: number; appliedAt: string | null };
  db: FundDb;
};

let cached: LiveDb | null = null;
let loading: { id: string; promise: Promise<FundDb> } | null = null;

async function downloadSnapshot(supabase: ServiceClient, path: string) {
  const { data, error } = await supabase.storage.from(FUND_DB_BUCKET).download(path);
  if (error || !data) {
    throw new Error(`The fund database could not be loaded: ${error?.message ?? "missing file"}.`);
  }
  return parseSnapshot(Buffer.from(await data.arrayBuffer()));
}

/** The live fund database, cached in memory until another version goes live. */
export async function loadLiveDb(
  supabase: ServiceClient,
): Promise<{ ok: true; value: LiveDb } | { ok: false; error: string; empty?: true }> {
  const { data, error } = await supabase
    .from("fund_db_versions")
    .select("id, file_name, firms, contacts, snapshot_path, applied_at")
    .eq("status", "live")
    .maybeSingle();
  if (error) return { ok: false, error: matchTableError(error.message, error.code) };
  if (!data) {
    return {
      ok: false,
      empty: true,
      error: "No fund database yet. Upload the workbook under Fund database.",
    };
  }

  const version = {
    id: String(data.id),
    fileName: String(data.file_name),
    firms: Number(data.firms),
    contacts: Number(data.contacts),
    appliedAt: data.applied_at != null ? String(data.applied_at) : null,
  };
  if (cached?.version.id === version.id) return { ok: true, value: cached };

  try {
    if (loading?.id !== version.id) {
      loading = { id: version.id, promise: downloadSnapshot(supabase, String(data.snapshot_path)) };
    }
    const db = await loading.promise;
    cached = { version, db };
    return { ok: true, value: cached };
  } catch (err) {
    loading = null;
    return { ok: false, error: err instanceof Error ? err.message : "The fund database could not be loaded." };
  }
}

export function newVersionPaths() {
  const id = randomUUID();
  return { id, snapshotPath: `snapshots/${id}.json.gz` };
}

export function asFundDbVersion(row: Record<string, unknown>): FundDbVersion {
  const status = row.status === "live" || row.status === "archived" ? row.status : "staged";
  return {
    id: String(row.id),
    fileName: String(row.file_name ?? ""),
    status,
    firms: Number(row.firms ?? 0),
    contacts: Number(row.contacts ?? 0),
    offices: Number(row.offices ?? 0),
    diff: (row.diff as FundDbDiff | null) ?? null,
    createdBy: row.created_by != null ? String(row.created_by) : null,
    createdAt: String(row.created_at ?? ""),
    appliedAt: row.applied_at != null ? String(row.applied_at) : null,
  };
}
