import "server-only";
import type { Contact, FundDb } from "@/lib/match/engine/index.mjs";
import { selectAll } from "@/lib/match/db-server";
import {
  contactId,
  emailKey,
  type KeyedContact,
  type VerifyStatus,
} from "@/lib/match/verify";
import type { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };

export const VERIFY_MIGRATION_MISSING =
  "Email Verification is not set up in the database yet. Run portal/supabase/contact_verification.sql in Supabase.";

const VERIFY_TABLES =
  /contact_checks|contact_corrections|contact_decisions|contact_leads|verification_runs|verification_results/;

function isMissingTable(message: string, code?: string) {
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (VERIFY_TABLES.test(message) && /does not exist|schema cache|could not find/i.test(message))
  );
}

export function verifyTableError(message: string, code?: string) {
  return isMissingTable(message, code) ? VERIFY_MIGRATION_MISSING : message;
}

/**
 * Matching keeps working before the verification migration runs: a missing
 * table reads as empty. Any other error is returned.
 */
function tolerant<T>(
  loaded: { ok: true; rows: T[] } | { ok: false; error: string },
): { ok: true; rows: T[] } | { ok: false; error: string } {
  if (loaded.ok) return loaded;
  if (loaded.error.includes("Rupert Match is not set up") || isMissingTable(loaded.error)) {
    return { ok: true, rows: [] };
  }
  return loaded;
}

export type Correction = {
  firm_id: string;
  email_key: string;
  firm_name: string;
  person_name: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  flag: "removed" | "left_firm" | null;
  flag_reason: string | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string;
};

const CORRECTION_COLUMNS =
  "firm_id, email_key, firm_name, person_name, email, first_name, last_name, title, flag, flag_reason, note, updated_by, updated_at";

export async function loadCorrections(supabase: ServiceClient): Promise<Loaded<Map<string, Correction>>> {
  const loaded = tolerant(
    await selectAll<Correction>((from, to) =>
      supabase
        .from("contact_corrections")
        .select(CORRECTION_COLUMNS)
        .order("firm_id")
        .order("email_key")
        .range(from, to),
    ),
  );
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    value: new Map(loaded.rows.map((row) => [contactId(row.firm_id, row.email_key), row])),
  };
}

export type Decision = { decision: "keep" | "remove"; status: string | null };

/** Keep / remove decisions for one client, by contact id. */
export async function loadDecisions(
  supabase: ServiceClient,
  clientId: string,
): Promise<Loaded<Map<string, Decision>>> {
  const loaded = tolerant(
    await selectAll<{ firm_id: string; email_key: string; decision: string; status: string | null }>(
      (from, to) =>
        supabase
          .from("contact_decisions")
          .select("firm_id, email_key, decision, status")
          .eq("client_id", clientId)
          .order("firm_id")
          .order("email_key")
          .range(from, to),
    ),
  );
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    value: new Map(
      loaded.rows.map((row) => [
        contactId(row.firm_id, row.email_key),
        { decision: row.decision === "remove" ? "remove" : "keep", status: row.status },
      ]),
    ),
  };
}

/**
 * The Fund Database with corrections applied: fixed emails, names and
 * titles; contacts who left a fund taken out of it; and contacts this client
 * removed taken out. Every contact carries its original email key. Returns
 * the database unchanged when there is nothing to apply.
 */
export function applyCorrections(
  db: FundDb,
  corrections: Map<string, Correction>,
  decisions: Map<string, Decision>,
): FundDb {
  const removed = Array.from(decisions.values()).some((item) => item.decision === "remove");
  if (corrections.size === 0 && !removed) return db;

  const contacts: KeyedContact[] = [];
  for (const contact of db.contacts as Contact[]) {
    if (!contact.email) {
      contacts.push(contact);
      continue;
    }
    const key = emailKey(contact.email);
    const id = contactId(contact.fid, key);
    if (decisions.get(id)?.decision === "remove") continue;
    const fix = corrections.get(id);
    if (!fix) {
      contacts.push(contact);
      continue;
    }
    if (fix.flag === "left_firm") continue;
    contacts.push({
      ...contact,
      key,
      email: fix.email || contact.email,
      first: fix.first_name ?? contact.first,
      last: fix.last_name ?? contact.last,
      title: fix.title ?? contact.title,
    });
  }
  return { firms: db.firms, contacts };
}

export type CheckBrief = {
  email: string;
  status: VerifyStatus | null;
  checkedAt: string | null;
  /** A step failed, so the result is shown but not reused. */
  hadError: boolean;
};

const ID_CHUNK = 200;

/** Stored checks for every contact at these funds, by contact id. */
export async function loadChecksForFirms(
  supabase: ServiceClient,
  firmIds: string[],
): Promise<Loaded<Map<string, CheckBrief>>> {
  const ids = Array.from(new Set(firmIds));
  const chunks = Array.from({ length: Math.ceil(ids.length / ID_CHUNK) }, (_, index) =>
    ids.slice(index * ID_CHUNK, (index + 1) * ID_CHUNK),
  );
  const loaded = await Promise.all(
    chunks.map(async (chunk) =>
      tolerant(
        await selectAll<{
          firm_id: string;
          email_key: string;
          email: string;
          status: VerifyStatus | null;
          checked_at: string | null;
          had_error: boolean | null;
        }>((from, to) =>
          supabase
            .from("contact_checks")
            .select("firm_id, email_key, email, status, checked_at, had_error")
            .in("firm_id", chunk)
            .order("firm_id")
            .order("email_key")
            .range(from, to),
        ),
      ),
    ),
  );
  const checks = new Map<string, CheckBrief>();
  for (const part of loaded) {
    if (!part.ok) return part;
    for (const row of part.rows) {
      checks.set(contactId(row.firm_id, row.email_key), {
        email: row.email,
        status: row.status,
        checkedAt: row.checked_at,
        hadError: Boolean(row.had_error),
      });
    }
  }
  return { ok: true, value: checks };
}
