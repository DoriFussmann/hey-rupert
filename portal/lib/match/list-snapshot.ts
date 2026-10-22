import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/match/db-server";
import { contactId, type CheckSteps, type MailboxResult, type VerifyState } from "@/lib/match/verify";
import {
  fitTiersFor,
  type InvestorListPayload,
  type InvestorVerification,
} from "@/lib/setup";

/**
 * The verification state of each investing contact with an email at a listed
 * fund, by list row id. Undefined when the row's fund is not known.
 */
export type PeopleStates = (rowId: string) => VerifyState[] | undefined;

type ServiceClient = ReturnType<typeof createServiceClient>;

type SampleContact = { id: string; firmId: string };

type CheckRow = {
  firm_id: string;
  email_key: string;
  status: string | null;
  steps: CheckSteps | null;
  checked_at: string | null;
};

function sampleOf(value: unknown): SampleContact[] {
  if (!Array.isArray(value)) return [];
  const contacts: SampleContact[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const firmId = String(raw.firmId ?? "").trim();
    const id = String(raw.id ?? "").trim();
    if (firmId && id) contacts.push({ id, firmId });
  }
  return contacts;
}

function mailboxOf(steps: CheckSteps | null): MailboxResult | null {
  const result = steps?.mailbox?.result;
  return result ?? null;
}

/**
 * Freezes this client's latest verification onto the list and drops invalid
 * emails from the contact counts. No snapshot when this client has not run it.
 */
export async function withVerificationSnapshot(
  supabase: ServiceClient,
  clientId: string,
  peopleOf: PeopleStates,
  list: InvestorListPayload,
): Promise<InvestorListPayload> {
  const { data, error } = await supabase
    .from("verification_runs")
    .select("contacts, reused, finished_at, updated_at")
    .eq("client_id", clientId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return { ...list, verification: { verification_ran: false } };

  const sample = [...sampleOf(data.contacts), ...sampleOf(data.reused)];
  if (sample.length === 0) return { ...list, verification: { verification_ran: false } };

  const firmIds = Array.from(new Set(sample.map((contact) => contact.firmId)));
  const checks = new Map<string, CheckRow>();
  for (let index = 0; index < firmIds.length; index += 200) {
    const chunk = firmIds.slice(index, index + 200);
    const loaded = await selectAll<CheckRow>((from, to) =>
      supabase
        .from("contact_checks")
        .select("firm_id, email_key, status, steps, checked_at")
        .in("firm_id", chunk)
        .order("firm_id")
        .order("email_key")
        .range(from, to),
    );
    if (!loaded.ok) return { ...list, verification: { verification_ran: false } };
    for (const row of loaded.rows) checks.set(contactId(row.firm_id, row.email_key), row);
  }

  const wanted = new Set(sample.map((contact) => contact.id));
  const firmsChecked = new Set<string>();
  const firmsActive = new Set<string>();
  let emailsChecked = 0;
  let emailsValid = 0;
  let emailsAcceptAll = 0;
  let emailsInvalid = 0;
  let emailsUnknown = 0;
  let latest = "";
  for (const id of Array.from(wanted)) {
    const row = checks.get(id);
    if (!row) continue;
    firmsChecked.add(row.firm_id);
    if (row.steps?.role?.result === "confirmed") firmsActive.add(row.firm_id);
    if (row.checked_at && row.checked_at > latest) latest = row.checked_at;
    const mailbox = mailboxOf(row.steps);
    if (!mailbox || mailbox === "error") {
      if (row.status === "clean") {
        emailsChecked += 1;
        emailsValid += 1;
      } else if (row.status === "email_bad") {
        emailsChecked += 1;
        emailsInvalid += 1;
      } else if (row.status === "unknown") {
        emailsChecked += 1;
        emailsUnknown += 1;
      }
      continue;
    }
    emailsChecked += 1;
    if (mailbox === "valid") emailsValid += 1;
    else if (mailbox === "accept_all") emailsAcceptAll += 1;
    else if (mailbox === "invalid" || mailbox === "disposable") emailsInvalid += 1;
    else emailsUnknown += 1;
  }

  let removed = 0;
  const rows = list.rows.map((row) => {
    const people = peopleOf(row.id);
    if (!people) return row;
    const bad = people.filter((state) => state === "email_bad").length;
    removed += bad;
    const count = Math.max(0, people.length - bad);
    return {
      ...row,
      contact_count: count,
      contact:
        count > 0
          ? `${count} investing contact${count === 1 ? "" : "s"} identified`
          : "Contacts being confirmed",
    };
  });

  const verification: InvestorVerification = {
    verification_ran: true,
    verified_at: latest || String(data.finished_at ?? data.updated_at ?? ""),
    sample_size: sample.length,
    firms_checked: firmsChecked.size,
    firms_confirmed_active: firmsActive.size,
    emails_checked: emailsChecked,
    emails_valid: emailsValid,
    emails_accept_all: emailsAcceptAll,
    emails_invalid: emailsInvalid,
    emails_unknown: emailsUnknown,
    deliverable_rate: emailsChecked > 0 ? Math.round((emailsValid / emailsChecked) * 100) : 0,
    excludes_invalid: removed > 0,
  };

  const summary = list.summary
    ? {
        ...list.summary,
        tiers: fitTiersFor(list.tier_scheme).map(({ tier }) => {
          const existing = list.summary?.tiers.find((item) => item.tier === tier);
          const inTier = rows.filter((row) => row.tier === tier && !row.hidden_duplicate && !row.broad);
          return {
            tier,
            funds: inTier.length,
            contacts: inTier.reduce((sum, row) => sum + (row.contact_count ?? 0), 0),
            by_type: existing?.by_type ?? [],
          };
        }),
      }
    : list.summary;

  return { ...list, rows, summary, verification };
}
