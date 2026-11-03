import type { Contact, Firm, FundDb } from "./match/engine/index.mjs";
import { csvCell } from "./csv.ts";

/**
 * The Fund Database as two CSV files (funds, contacts), for the admin's
 * Download CSV links. Multi-value fields are joined with "; ".
 */

export type FundSource = "Provider" | "Added by Rupert";

const FUND_COLUMNS = [
  "Fund ID",
  "Name",
  "Source",
  "Type",
  "Region",
  "Founded",
  "Stages",
  "Financing",
  "Industries",
  "Verticals",
  "Geographies",
  "HQ city",
  "HQ state",
  "HQ country",
  "Website",
  "Email",
  "Phone",
  "Contacts",
  "Offices",
] as const;

const CONTACT_COLUMNS = [
  "Fund ID",
  "Fund name",
  "Source",
  "First name",
  "Last name",
  "Prefix",
  "Title",
  "Email",
  "Phone",
  "City",
  "State",
  "Country",
  "Office type",
  "Principal",
  "Lead",
] as const;

const join = (values: string[] | undefined) => (values ?? []).filter(Boolean).join("; ");
const text = (value: unknown) => (value == null ? "" : String(value));

function toCsv(columns: readonly string[], rows: string[][]) {
  const lines = [columns.join(","), ...rows.map((row) => row.map((cell) => csvCell(cell)).join(","))];
  // BOM so Excel reads UTF-8 (accented fund and people names).
  return `﻿${lines.join("\r\n")}\r\n`;
}

function fundRow(firm: Firm, source: FundSource): string[] {
  return [
    firm.id,
    firm.name,
    source,
    firm.type,
    firm.region,
    text(firm.year),
    join(firm.stages),
    join(firm.fin),
    join(firm.ind),
    join(firm.vert),
    join(firm.geo),
    firm.city,
    firm.state,
    firm.country,
    firm.web,
    firm.email,
    firm.phone,
    text(firm.nContacts),
    (firm.offices ?? []).map((o) => [o.city, o.country].filter(Boolean).join(", ") + (o.type ? ` (${o.type})` : "")).join("; "),
  ].map(text);
}

function contactRow(contact: Contact, fundName: string, source: FundSource): string[] {
  return [
    contact.fid,
    fundName,
    source,
    contact.first,
    contact.last,
    contact.prefix,
    contact.title,
    contact.email,
    contact.phone,
    contact.city,
    contact.state,
    contact.country,
    contact.officeType,
    contact.principal ? "Yes" : "No",
    contact.lead ? "Yes" : "No",
  ].map(text);
}

/** Provider records first, then funds Rupert added (approved), skipping any id the provider already has. */
function merged(db: FundDb, added: Pick<FundDb, "firms" | "contacts">) {
  const providerIds = new Set(db.firms.map((f) => f.id));
  const addedFirms = added.firms.filter((f) => !providerIds.has(f.id));
  const addedIds = new Set(addedFirms.map((f) => f.id));
  return {
    firms: [
      ...db.firms.map((firm) => ({ firm, source: "Provider" as const })),
      ...addedFirms.map((firm) => ({ firm, source: "Added by Rupert" as const })),
    ],
    contacts: [
      ...db.contacts.map((contact) => ({ contact, source: "Provider" as const })),
      ...added.contacts.filter((c) => addedIds.has(c.fid)).map((contact) => ({ contact, source: "Added by Rupert" as const })),
    ],
  };
}

export function fundsCsv(db: FundDb, added: Pick<FundDb, "firms" | "contacts"> = { firms: [], contacts: [] }) {
  return toCsv(FUND_COLUMNS, merged(db, added).firms.map(({ firm, source }) => fundRow(firm, source)));
}

export function contactsCsv(db: FundDb, added: Pick<FundDb, "firms" | "contacts"> = { firms: [], contacts: [] }) {
  const all = merged(db, added);
  const names = new Map(all.firms.map(({ firm }) => [firm.id, firm.name]));
  return toCsv(
    CONTACT_COLUMNS,
    all.contacts.map(({ contact, source }) => contactRow(contact, names.get(contact.fid) ?? "", source)),
  );
}
