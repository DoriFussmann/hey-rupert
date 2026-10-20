import "server-only";
import { randomUUID } from "node:crypto";
import RME, { type Contact, type Firm, type FundDb } from "@/lib/match/engine/index.mjs";
import { normalizeHeader, parseCsv } from "@/lib/csv";
import {
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  IMPORT_REJECTED_SHOWN,
  asImportSummary,
  type ContactImportView,
  type ImportColumnKey,
  type ImportRejected,
  type ImportSummary,
  type ReappliedContacts,
} from "@/lib/match/contact-import";
import {
  FUND_UPLOAD_FOLDER,
  MATCH_MIGRATION_MISSING,
  loadLiveDb,
  matchTableError,
  newVersionPaths,
  selectAll,
  snapshotBytes,
} from "@/lib/match/db-server";
import { FUND_DB_BUCKET, type FundDbDiff } from "@/lib/match/shared";
import { EMAIL_PATTERN, emailKey } from "@/lib/match/verify";
import type { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string; details?: string[] };

export const IMPORT_MIGRATION_MISSING =
  "Adding contacts by CSV is not set up in the database yet. Run portal/supabase/contact_imports.sql in Supabase.";

export function importTableError(message: string, code?: string) {
  if (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /contact_imports|column .*source/.test(message) ||
    message.toLowerCase().includes("schema cache")
  ) {
    return IMPORT_MIGRATION_MISSING;
  }
  return message;
}

function nowIso() {
  return new Date().toISOString();
}

/** A website as a comparable key: no scheme, www, path or trailing slash. */
function siteKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

/** FirmID + lowercased email: one contact at one fund. */
function contactKey(firmId: string, email: string) {
  return `${firmId}|${emailKey(email)}`;
}

function existingKeys(contacts: Contact[]) {
  return new Set(contacts.filter((contact) => contact.email).map((contact) => contactKey(contact.fid, contact.email)));
}

// ---------------------------------------------------------------------------
// Reading the CSV

type Columns = Partial<Record<ImportColumnKey, number>>;

function mapColumns(header: string[]): { ok: true; columns: Columns } | { ok: false; error: string } {
  const cells = header.map(normalizeHeader);
  const columns: Columns = {};
  for (const column of IMPORT_COLUMNS) {
    const names = [column.header, ...column.aliases].map(normalizeHeader);
    const index = cells.findIndex((cell) => names.includes(cell));
    if (index >= 0) columns[column.key] = index;
  }
  const missing: string[] = [];
  if (columns.firmId === undefined && columns.website === undefined) missing.push("FirmID or Firm Website");
  for (const column of IMPORT_COLUMNS) {
    if (column.required && column.key !== "firmId" && column.key !== "website" && columns[column.key] === undefined) {
      missing.push(column.header);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Nothing was added.`,
    };
  }
  return { ok: true, columns };
}

const VALUE_MAX = 200;
const EMAIL_MAX = 254;

/** Reads the CSV against the live database: what would be added, skipped and rejected. */
function readImport(
  text: string,
  db: FundDb,
): Result<{ contacts: Contact[]; summary: ImportSummary }> {
  const table = parseCsv(text);
  if (table.length === 0) return { ok: false, error: "The file is empty." };
  const mapped = mapColumns(table[0]);
  if (!mapped.ok) return mapped;
  const body = table.slice(1);
  if (body.length === 0) return { ok: false, error: "The file has headers but no contacts." };
  if (body.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: `Too many rows (${body.length.toLocaleString("en-US")}). The limit is ${IMPORT_MAX_ROWS.toLocaleString("en-US")} per file.` };
  }

  const byId = new Map(db.firms.map((firm) => [firm.id, firm]));
  const bySite = new Map<string, Firm[]>();
  for (const firm of db.firms) {
    const key = siteKey(firm.web);
    if (!key) continue;
    bySite.set(key, [...(bySite.get(key) ?? []), firm]);
  }
  const existing = existingKeys(db.contacts);
  const inFile = new Set<string>();
  const { columns } = mapped;

  const contacts: Contact[] = [];
  const rejected: ImportRejected[] = [];
  const sample: string[] = [];
  let duplicates = 0;

  body.forEach((cells, index) => {
    const row = index + 2;
    const value = (key: ImportColumnKey, max = VALUE_MAX) => {
      const at = columns[key];
      return at === undefined ? "" : (cells[at] ?? "").trim().slice(0, max);
    };
    const reject = (reason: string) => rejected.push({ row, reason });

    const missing = IMPORT_COLUMNS.filter(
      (column) => column.required && column.key !== "firmId" && column.key !== "website" && !value(column.key),
    ).map((column) => column.header);
    if (missing.length > 0) {
      reject(`Missing ${missing.join(", ")}.`);
      return;
    }

    const firmId = value("firmId");
    const website = value("website");
    let firm: Firm | undefined;
    if (firmId) {
      firm = byId.get(firmId);
      if (!firm) {
        reject(`FirmID "${firmId}" is not in the Fund Database.`);
        return;
      }
    } else if (website) {
      const matches = bySite.get(siteKey(website)) ?? [];
      if (matches.length === 0) {
        reject(`No fund in the Fund Database has the website "${website}".`);
        return;
      }
      if (matches.length > 1) {
        reject(`${matches.length} funds share the website "${website}". Use their FirmID.`);
        return;
      }
      firm = matches[0];
    } else {
      reject("Needs a FirmID or a Firm Website.");
      return;
    }

    const email = value("email", EMAIL_MAX);
    if (!EMAIL_PATTERN.test(email)) {
      reject(`"${email}" is not a valid email.`);
      return;
    }
    const key = contactKey(firm.id, email);
    if (existing.has(key) || inFile.has(key)) {
      duplicates += 1;
      return;
    }
    inFile.add(key);

    const [contact] = RME.normalize(
      [],
      [
        {
          FirmID: firm.id,
          "First Name": value("first"),
          "Last Name": value("last"),
          Prefix: value("prefix"),
          Title: value("title"),
          "Work Email": email,
          "Work Phone": value("phone"),
          City: value("city"),
          State: value("state"),
          Country: value("country"),
        },
      ],
      [],
    ).contacts;
    contacts.push(contact);
    if (sample.length < 10) sample.push(`${contact.first} ${contact.last} · ${firm.name}`);
  });

  return {
    ok: true,
    value: {
      contacts,
      summary: {
        rows: body.length,
        added: contacts.length,
        duplicates,
        rejectedCount: rejected.length,
        rejected: rejected.slice(0, IMPORT_REJECTED_SHOWN),
        sample,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Imports

type ImportRow = {
  id: string;
  file_name: string;
  upload_path: string;
  status: "staged" | "applied";
  contacts: Contact[] | null;
  summary: unknown;
  created_by: string | null;
  created_at: string;
};

function toView(row: ImportRow): ContactImportView {
  return {
    id: row.id,
    fileName: row.file_name,
    createdAt: row.created_at,
    createdBy: row.created_by,
    summary: asImportSummary(row.summary),
  };
}

async function removeStagedImports(supabase: ServiceClient) {
  const { data, error } = await supabase.from("contact_imports").select("id, upload_path").eq("status", "staged");
  if (error) return importTableError(error.message, error.code);
  for (const row of data ?? []) {
    await supabase.storage.from(FUND_DB_BUCKET).remove([String(row.upload_path)]);
    await supabase.from("contact_imports").delete().eq("id", row.id).eq("status", "staged");
  }
  return null;
}

/** The CSV waiting for Apply, if any. */
export async function loadStagedImport(supabase: ServiceClient): Promise<Result<ContactImportView | null>> {
  const { data, error } = await supabase
    .from("contact_imports")
    .select("id, file_name, upload_path, status, summary, created_by, created_at")
    .eq("status", "staged")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: importTableError(error.message, error.code) };
  return { ok: true, value: data ? toView(data as ImportRow) : null };
}

/** Reads a CSV and keeps it for the preview. Nothing changes until Apply. */
export async function stageContactImport(
  supabase: ServiceClient,
  fileName: string,
  text: string,
  by: string | null,
): Promise<Result<ContactImportView>> {
  const live = await loadLiveDb(supabase);
  if (!live.ok) return { ok: false, error: live.error };
  const read = readImport(text, live.value.db);
  if (!read.ok) return read;

  const cleared = await removeStagedImports(supabase);
  if (cleared) return { ok: false, error: cleared };

  const uploadPath = `${FUND_UPLOAD_FOLDER}${randomUUID()}.csv`;
  const { error: uploadError } = await supabase.storage
    .from(FUND_DB_BUCKET)
    .upload(uploadPath, Buffer.from(text, "utf8"), { contentType: "text/csv", upsert: false });
  if (uploadError) return { ok: false, error: `The file could not be saved: ${uploadError.message}.` };

  const { data, error } = await supabase
    .from("contact_imports")
    .insert({
      file_name: fileName.slice(0, 255) || "contacts.csv",
      upload_path: uploadPath,
      status: "staged",
      contacts: read.value.contacts,
      summary: read.value.summary,
      created_by: by,
    })
    .select("id, file_name, upload_path, status, summary, created_by, created_at")
    .single();
  if (error || !data) {
    await supabase.storage.from(FUND_DB_BUCKET).remove([uploadPath]);
    return { ok: false, error: importTableError(error?.message ?? "The import was not saved.", error?.code) };
  }
  return { ok: true, value: toView(data as ImportRow) };
}

export async function discardContactImport(supabase: ServiceClient, id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("contact_imports")
    .select("id, upload_path, status")
    .eq("id", id)
    .maybeSingle();
  if (error) return importTableError(error.message, error.code);
  if (!data || data.status !== "staged") return "Only a CSV that hasn't been applied can be discarded.";
  await supabase.storage.from(FUND_DB_BUCKET).remove([String(data.upload_path)]);
  const { error: deleteError } = await supabase
    .from("contact_imports")
    .delete()
    .eq("id", id)
    .eq("status", "staged");
  return deleteError ? importTableError(deleteError.message, deleteError.code) : null;
}

/**
 * Adds the CSV's contacts to the live database as a new live version. Checked
 * again against the live database, in case it changed since the preview.
 */
export async function applyContactImport(
  supabase: ServiceClient,
  id: string,
  by: string | null,
): Promise<Result<{ added: number }>> {
  const { data: waiting, error: waitingError } = await supabase
    .from("fund_db_versions")
    .select("id")
    .eq("status", "staged")
    .limit(1);
  if (waitingError) return { ok: false, error: matchTableError(waitingError.message, waitingError.code) };
  if ((waiting ?? []).length > 0) {
    return {
      ok: false,
      error: "A workbook upload is waiting above. Apply or discard it first, then apply this CSV.",
    };
  }

  const { data, error } = await supabase
    .from("contact_imports")
    .select("id, file_name, upload_path, status, contacts, summary, created_by, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: importTableError(error.message, error.code) };
  const row = data as ImportRow | null;
  if (!row || row.status !== "staged") return { ok: false, error: "This CSV is no longer waiting to be applied." };

  const live = await loadLiveDb(supabase);
  if (!live.ok) return { ok: false, error: live.error };
  const { db } = live.value;
  const firmIds = new Set(db.firms.map((firm) => firm.id));
  const existing = existingKeys(db.contacts);
  const toAdd = (Array.isArray(row.contacts) ? row.contacts : []).filter((contact) => {
    const key = contactKey(contact.fid, contact.email);
    if (!firmIds.has(contact.fid) || existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  if (toAdd.length === 0) return { ok: false, error: "Nothing to add: these contacts are already in the database." };

  const next: FundDb = { firms: db.firms, contacts: [...db.contacts, ...toAdd] };
  const { id: versionId, snapshotPath } = newVersionPaths();
  const { error: snapshotError } = await supabase.storage
    .from(FUND_DB_BUCKET)
    .upload(snapshotPath, snapshotBytes(next), { contentType: "application/gzip", upsert: false });
  if (snapshotError) return { ok: false, error: `The database could not be stored: ${snapshotError.message}.` };

  const diff: FundDbDiff = {
    previous: { firms: db.firms.length, contacts: db.contacts.length },
    added: 0,
    removed: 0,
    changed: 0,
    addedSample: [],
    removedSample: [],
    reviewsOnRemoved: 0,
    warnings: [],
    contactsAdded: toAdd.length,
  };
  const { error: versionError } = await supabase.from("fund_db_versions").insert({
    id: versionId,
    file_name: row.file_name,
    upload_path: row.upload_path,
    snapshot_path: snapshotPath,
    status: "staged",
    source: "csv",
    firms: next.firms.length,
    contacts: next.contacts.length,
    offices: 0,
    diff,
    created_by: by,
  });
  if (versionError) {
    await supabase.storage.from(FUND_DB_BUCKET).remove([snapshotPath]);
    return { ok: false, error: importTableError(versionError.message, versionError.code) };
  }

  const { error: applyError } = await supabase.rpc("apply_fund_db_version", { p_id: versionId });
  if (applyError) {
    await supabase.from("fund_db_versions").delete().eq("id", versionId).eq("status", "staged");
    await supabase.storage.from(FUND_DB_BUCKET).remove([snapshotPath]);
    return { ok: false, error: matchTableError(applyError.message, applyError.code) };
  }

  const { error: markError } = await supabase
    .from("contact_imports")
    .update({ status: "applied", version_id: versionId, applied_at: nowIso(), contacts: toAdd })
    .eq("id", row.id);
  if (markError) {
    return {
      ok: false,
      error: `The contacts are live, but the import was not recorded, so a new workbook would not keep them: ${markError.message}`,
    };
  }
  return { ok: true, value: { added: toAdd.length } };
}

/**
 * Puts every applied CSV contact back on top of a new provider workbook.
 * Before the CSV migration has run there are none, and nothing changes.
 */
export async function reapplyImportedContacts(
  supabase: ServiceClient,
  db: FundDb,
): Promise<Result<{ db: FundDb; counts: ReappliedContacts }>> {
  const counts: ReappliedContacts = { readded: 0, dropped: 0, inWorkbook: 0 };
  const loaded = await selectAll<{ contacts: Contact[] | null }>((from, to) =>
    supabase
      .from("contact_imports")
      .select("contacts")
      .eq("status", "applied")
      .order("applied_at")
      .range(from, to),
  );
  if (!loaded.ok) {
    // selectAll reports a missing table as the Rupert Match migration; here
    // that can only be contact_imports, so there is nothing to put back.
    return loaded.error === MATCH_MIGRATION_MISSING
      ? { ok: true, value: { db, counts } }
      : { ok: false, error: loaded.error };
  }

  const firmIds = new Set(db.firms.map((firm) => firm.id));
  const existing = existingKeys(db.contacts);
  const added: Contact[] = [];
  for (const row of loaded.rows) {
    for (const contact of Array.isArray(row.contacts) ? row.contacts : []) {
      if (!contact?.fid || !contact.email) continue;
      const key = contactKey(contact.fid, contact.email);
      if (!firmIds.has(contact.fid)) counts.dropped += 1;
      else if (existing.has(key)) counts.inWorkbook += 1;
      else {
        existing.add(key);
        added.push(contact);
        counts.readded += 1;
      }
    }
  }
  return { ok: true, value: { db: { firms: db.firms, contacts: [...db.contacts, ...added] }, counts } };
}
