// Adding contacts to the Fund Database from a CSV: the columns, the template
// and what the preview shows. Pure module (no server code).

import { csvCell } from "@/lib/csv";

export const IMPORT_MAX_BYTES = 3 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
/** Rejected rows kept for the preview. */
export const IMPORT_REJECTED_SHOWN = 200;

export type ImportColumnKey =
  | "firmId"
  | "website"
  | "first"
  | "last"
  | "title"
  | "email"
  | "prefix"
  | "phone"
  | "city"
  | "state"
  | "country";

export type ImportColumn = {
  key: ImportColumnKey;
  header: string;
  /** Other header names accepted (compared without case, spaces, - or _). */
  aliases: string[];
  required: boolean;
  /** Shown next to the column in the list. */
  note?: string;
};

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "firmId", header: "FirmID", aliases: ["firm id", "fund id"], required: true, note: "or Firm Website" },
  { key: "website", header: "Firm Website", aliases: ["website", "fund website"], required: true, note: "if there is no FirmID" },
  { key: "first", header: "First Name", aliases: ["first", "firstname"], required: true },
  { key: "last", header: "Last Name", aliases: ["last", "lastname", "surname"], required: true },
  { key: "title", header: "Title", aliases: ["job title", "position"], required: true },
  { key: "email", header: "Work Email", aliases: ["email", "email address"], required: true },
  { key: "prefix", header: "Prefix", aliases: [], required: false },
  { key: "phone", header: "Work Phone", aliases: ["phone"], required: false },
  { key: "city", header: "City", aliases: [], required: false },
  { key: "state", header: "State", aliases: [], required: false },
  { key: "country", header: "Country", aliases: [], required: false },
];

export const IMPORT_TEMPLATE =
  IMPORT_COLUMNS.map((column) => column.header).join(",") +
  "\n" +
  [
    "",
    "examplefund.com",
    "Jane",
    "Smith",
    "Partner",
    "jane@examplefund.com",
    "",
    "",
    "New York",
    "NY",
    "United States",
  ]
    .map(csvCell)
    .join(",") +
  "\n";

export type ImportRejected = { row: number; reason: string };

/** What a CSV adds, as the preview shows it. */
export type ImportSummary = {
  rows: number;
  added: number;
  duplicates: number;
  rejectedCount: number;
  /** The first IMPORT_REJECTED_SHOWN rejected rows. */
  rejected: ImportRejected[];
  /** A few of the contacts that will be added: "Name · Fund". */
  sample: string[];
};

export type ContactImportView = {
  id: string;
  fileName: string;
  createdAt: string;
  createdBy: string | null;
  summary: ImportSummary;
};

/** CSV contacts put back on top of a new provider workbook. */
export type ReappliedContacts = {
  /** Added again on top of the workbook. */
  readded: number;
  /** Their fund is not in the new workbook. */
  dropped: number;
  /** The provider's workbook now has them. */
  inWorkbook: number;
};

export function asImportSummary(value: unknown): ImportSummary {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const count = (item: unknown) => Math.max(0, Math.floor(Number(item) || 0));
  return {
    rows: count(raw.rows),
    added: count(raw.added),
    duplicates: count(raw.duplicates),
    rejectedCount: count(raw.rejectedCount),
    rejected: Array.isArray(raw.rejected)
      ? raw.rejected
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({ row: count(item.row), reason: String(item.reason ?? "") }))
          .slice(0, IMPORT_REJECTED_SHOWN)
      : [],
    sample: Array.isArray(raw.sample) ? raw.sample.map((item) => String(item)).slice(0, 10) : [],
  };
}
