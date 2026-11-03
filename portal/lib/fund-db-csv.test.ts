import assert from "node:assert/strict";
import { test } from "node:test";
import type { Contact, Firm, FundDb } from "./match/engine/index.mjs";
import { contactsCsv, fundsCsv } from "./fund-db-csv.ts";

const firm = (over: Partial<Firm>): Firm => ({
  id: "F1",
  name: "Acme Ventures",
  type: "Venture Capital",
  region: "North America",
  year: 2015,
  stages: ["Seed", "Series A"],
  fin: ["Equity"],
  ind: ["Software"],
  vert: ["Fintech", "SaaS"],
  geo: ["United States"],
  city: "Menlo Park",
  state: "CA",
  country: "United States",
  web: "https://acme.vc",
  email: "",
  phone: "",
  nContacts: 1,
  offices: [{ city: "New York", country: "United States", type: "Branch" }],
  ...over,
});

const contact = (over: Partial<Contact>): Contact => ({
  fid: "F1",
  first: "Ana",
  last: "López",
  prefix: "",
  title: "Partner",
  email: "ana@acme.vc",
  phone: "",
  city: "Menlo Park",
  state: "CA",
  country: "United States",
  officeType: "HQ",
  principal: true,
  lead: false,
  matchQ: "",
  ...over,
});

const db: FundDb = { firms: [firm({})], contacts: [contact({})] };

test("funds CSV: BOM, header, multi-values joined, quoting, offices", () => {
  const csv = fundsCsv(db);
  assert.ok(csv.startsWith("﻿Fund ID,Name,Source,"));
  const row = csv.split("\r\n")[1];
  assert.ok(row.startsWith("F1,Acme Ventures,Provider,Venture Capital,North America,2015,"));
  assert.ok(row.includes('"Seed; Series A"'));
  assert.ok(row.includes('"Fintech; SaaS"'));
  assert.ok(row.includes('"New York, United States (Branch)"'));
});

test("added funds follow provider records, marked, without duplicating provider ids", () => {
  const added = {
    firms: [firm({ id: "RUP-1", name: "Angel, Jane" }), firm({ id: "F1", name: "Duplicate" })],
    contacts: [contact({ fid: "RUP-1", email: "jane@x.com" }), contact({ fid: "F1", email: "dup@x.com" })],
  };
  const funds = fundsCsv(db, added).trim().split("\r\n");
  assert.equal(funds.length, 3);
  assert.ok(funds[2].startsWith('RUP-1,"Angel, Jane",Added by Rupert,'));
  const contacts = contactsCsv(db, added).trim().split("\r\n");
  assert.equal(contacts.length, 3);
  assert.ok(contacts[1].startsWith("F1,Acme Ventures,Provider,Ana,López,,Partner,ana@acme.vc,"));
  assert.ok(contacts[1].endsWith(",HQ,Yes,No"));
  assert.ok(contacts[2].startsWith('RUP-1,"Angel, Jane",Added by Rupert,'));
});
