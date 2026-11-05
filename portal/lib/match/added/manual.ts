import "server-only";
import { randomUUID } from "node:crypto";
import RME from "@/lib/match/engine/index.mjs";
import { callClaudeAgent, webSearchTool } from "@/lib/anthropic";
import { domainSearch, findEmail, isHunterConfigured } from "@/lib/hunter";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { TaxIndex } from "@/lib/taxonomy/core";
import { cleanUrl } from "@/lib/match/landscape/core";
import { domainOf } from "@/lib/match/landscape/check";
import { matchDataSnapshot } from "@/lib/match/tiers/server";
import {
  ADDED_MIGRATION,
  RESEARCH_TOOL,
  countryLabels,
  findAddedElsewhere,
  fromRow,
  labelLists,
  tableError,
  tableReady,
  type LabelLists,
  type Row,
} from "./server";
import { MAX_ADDED_CONTACTS, onlyLabels, ownSite, pickContacts, splitName, type AddedContact, type AddedFund } from "./core.ts";

// Funds Rupert adds by hand from any Matching step: saved approved (in the
// shared Fund Database for every client at once) and put on the Roster of the
// client he was working on, whatever the Step 1 filters say. Marked by
// investor_id "manual" (no landscape).

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const MANUAL = "manual";
const MAX_MANUAL_CONTACTS = 10;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The form: everything a fund can carry. Labels outside the taxonomy are dropped. */
export type ManualFundInput = {
  name: string;
  kind: "fund" | "angel";
  website: string;
  description: string;
  hqCity: string;
  hqCountry: string;
  foundedYear: number | null;
  firmType: string;
  stages: string[];
  geographies: string[];
  industries: string[];
  verticals: string[];
  financing: string[];
  notes: string;
  contacts: AddedContact[];
};

export type ManualOptions = LabelLists & { countries: string[] };

export function manualOptions(index: TaxIndex): ManualOptions {
  return { ...labelLists(index), countries: countryLabels(index).sort() };
}

function cleanContacts(v: unknown): AddedContact[] {
  return (Array.isArray(v) ? v : [])
    .map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      const email = text(x.email, 160).toLowerCase();
      const confidence = typeof x.confidence === "number" ? x.confidence : null;
      const source = x.source === "hunter_domain" || x.source === "hunter_finder" || x.source === "research" ? x.source : "manual";
      return {
        first: text(x.first, 60),
        last: text(x.last, 80),
        title: text(x.title, 120),
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
        confidence: source === "manual" ? null : confidence,
        linkedin: cleanUrl(x.linkedin),
        source,
      } as AddedContact;
    })
    .filter((c) => c.first || c.last || c.email)
    .slice(0, MAX_MANUAL_CONTACTS);
}

/** The table's columns from the form, labels checked against the taxonomy. */
function columns(index: TaxIndex, input: ManualFundInput) {
  const labels = labelLists(index);
  const year = Number(input.foundedYear);
  return {
    name: text(input.name, 120),
    kind: input.kind === "angel" ? "angel" : "fund",
    website: ownSite(text(input.website, 500)),
    description: text(input.description, 400),
    hq_city: text(input.hqCity, 80),
    hq_country: onlyLabels([input.hqCountry], countryLabels(index), 1)[0] ?? "",
    founded_year: Number.isInteger(year) && year > 1900 && year <= new Date().getFullYear() ? year : null,
    firm_type: onlyLabels([input.firmType], labels.firmTypes, 1)[0] ?? "",
    stages: onlyLabels(list(input.stages), labels.stages),
    geographies: onlyLabels(list(input.geographies), labels.geographies),
    industries: onlyLabels(list(input.industries), labels.industries),
    verticals: onlyLabels(list(input.verticals), labels.verticals),
    financing: onlyLabels(list(input.financing), labels.financing),
    notes: text(input.notes, 1500),
    contacts: cleanContacts(input.contacts),
  };
}

/** The funds added by hand for this client (not removed). */
export async function manualFunds(supabase: ServiceClient, clientId: string): Promise<AddedFund[]> {
  const { data, error } = await supabase
    .from("added_funds")
    .select("*")
    .eq("found_for_client", clientId)
    .eq("investor_id", MANUAL)
    .neq("status", "rejected")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as Row[]).map(fromRow);
}

/** The database record already using this website, if any (provider or added). */
async function recordWithSite(supabase: ServiceClient, clientId: string, website: string): Promise<Result<{ id: string; name: string } | null>> {
  const domain = website ? domainOf(website) : "";
  if (!domain) return { ok: true, value: null };
  const snapshot = await matchDataSnapshot(supabase, clientId);
  if (!snapshot.ok) return snapshot;
  const hit = snapshot.value.db.firms.find((f) => f.web && domainOf(f.web) === domain);
  return { ok: true, value: hit ? { id: hit.id, name: hit.name } : null };
}

/** Adds a fund by hand: approved at once, for every client, and on this client's Roster. */
export async function addManualFund(
  supabase: ServiceClient,
  index: TaxIndex,
  clientId: string,
  input: ManualFundInput,
  actor: string | null,
): Promise<Result<AddedFund>> {
  if (!(await tableReady(supabase))) return { ok: false, error: ADDED_MIGRATION };
  const row = columns(index, input);
  if (!row.name) return { ok: false, error: "A fund needs a name." };
  const elsewhere = await findAddedElsewhere(supabase, row.name, row.website);
  if (elsewhere) {
    return {
      ok: false,
      error: `${elsewhere.name} was already added (${elsewhere.status === "pending" ? "pending review on the Fund Database page" : elsewhere.status}).`,
    };
  }
  const existing = await recordWithSite(supabase, clientId, row.website);
  if (!existing.ok) return existing;
  if (existing.value) return { ok: false, error: `${existing.value.name} is already in the database with this website.` };
  const at = new Date().toISOString();
  const { data, error } = await supabase
    .from("added_funds")
    .insert({
      ...row,
      firm_id: `RUP-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "approved",
      sources: row.website ? [{ url: row.website, label: "Website" }] : [],
      found_for_client: clientId,
      landscape_id: null,
      investor_id: MANUAL,
      created_by: actor,
      reviewed_by: actor,
      reviewed_at: at,
      review_note: "Added by hand in Matching: approved on save.",
    })
    .select("*")
    .single<Row>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

/** Saves the form over a fund added by hand. */
export async function updateManualFund(
  supabase: ServiceClient,
  index: TaxIndex,
  clientId: string,
  id: string,
  input: ManualFundInput,
): Promise<Result<AddedFund>> {
  const row = columns(index, input);
  if (!row.name) return { ok: false, error: "A fund needs a name." };
  if (row.website) {
    const existing = await recordWithSite(supabase, clientId, row.website);
    if (!existing.ok) return existing;
    const mine = await one(supabase, clientId, id);
    if (!mine.ok) return mine;
    if (existing.value && existing.value.id !== mine.value.firmId) {
      return { ok: false, error: `${existing.value.name} is already in the database with this website.` };
    }
  }
  const { data, error } = await supabase
    .from("added_funds")
    .update(row)
    .eq("id", id)
    .eq("found_for_client", clientId)
    .eq("investor_id", MANUAL)
    .select("*")
    .single<Row>();
  if (error) return { ok: false, error: error.code === "PGRST116" ? "That fund is no longer here." : tableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

/** Removes a fund added by hand: off the Roster and out of the database (kept on record as rejected). */
export async function removeManualFund(supabase: ServiceClient, clientId: string, id: string, actor: string | null): Promise<Result<null>> {
  const { error } = await supabase
    .from("added_funds")
    .update({ status: "rejected", reviewed_by: actor, reviewed_at: new Date().toISOString(), review_note: "Removed in Matching." })
    .eq("id", id)
    .eq("found_for_client", clientId)
    .eq("investor_id", MANUAL);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: null };
}

async function one(supabase: ServiceClient, clientId: string, id: string): Promise<Result<AddedFund>> {
  const { data, error } = await supabase
    .from("added_funds")
    .select("*")
    .eq("id", id)
    .eq("found_for_client", clientId)
    .eq("investor_id", MANUAL)
    .maybeSingle<Row>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data) return { ok: false, error: "That fund is no longer here." };
  return { ok: true, value: fromRow(data) };
}

/**
 * Hunter for a fund added by hand: an email for every named contact without one
 * (Email Finder, about 1 credit each), or, with no contacts at all, the
 * investing team at the website's domain (Domain Search, 1 credit).
 */
export async function findManualEmails(
  supabase: ServiceClient,
  clientId: string,
  id: string,
): Promise<Result<{ fund: AddedFund; message: string }>> {
  if (!isHunterConfigured()) return { ok: false, error: "Hunter is not set up (HUNTER_API_KEY)." };
  const got = await one(supabase, clientId, id);
  if (!got.ok) return got;
  const fund = got.value;
  const domain = fund.website ? domainOf(fund.website) : "";
  if (!domain) return { ok: false, error: "Add the fund's website first: Hunter looks people up by its domain." };
  const contacts = [...fund.contacts];
  let credits = 0;
  let found = 0;
  const problems: string[] = [];
  if (!contacts.length) {
    const result = await domainSearch(domain, 10);
    if (!result.ok) return { ok: false, error: result.reason };
    if (result.value.people.length) credits += 1;
    for (const p of pickContacts(result.value.people, RME.roleOf, MAX_ADDED_CONTACTS)) {
      contacts.push({ first: p.firstName, last: p.lastName, title: p.position, email: p.email, confidence: p.confidence, linkedin: cleanUrl(p.linkedin), source: "hunter_domain" });
      found += 1;
    }
  } else {
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      if (c.email) continue;
      const { first, last } = c.last ? { first: c.first, last: c.last } : splitName(c.first);
      if (!first || !last) {
        problems.push(`${c.first || "A contact"}: needs a first and last name.`);
        continue;
      }
      const result = await findEmail({ domain, firstName: first, lastName: last });
      if (!result.ok) {
        problems.push(result.reason);
        break;
      }
      credits += 1;
      if (result.value) {
        contacts[i] = { ...c, first, last, email: result.value.email, confidence: result.value.score, source: "hunter_finder" };
        found += 1;
      } else problems.push(`${first} ${last}: no email found.`);
    }
  }
  const { data, error } = await supabase
    .from("added_funds")
    .update({ contacts })
    .eq("id", id)
    .select("*")
    .single<Row>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  // Credits are recorded best effort.
  if (credits) {
    const { data: prev } = await supabase.from("added_funds").select("hunter_credits").eq("id", id).maybeSingle<{ hunter_credits: number | null }>();
    await supabase.from("added_funds").update({ hunter_credits: Number(prev?.hunter_credits ?? 0) + credits }).eq("id", id);
  }
  const head = !fund.contacts.length
    ? found
      ? `Hunter found ${found} investing ${found === 1 ? "contact" : "contacts"} at ${domain}.`
      : `Hunter found no investing contacts at ${domain}.`
    : found
      ? `Hunter found ${found} ${found === 1 ? "email" : "emails"}.`
      : "Hunter found no new emails.";
  return { ok: true, value: { fund: fromRow(data), message: [head, ...problems].join(" ") } };
}

/** Fill with AI: research the fund on the web and suggest the form's fields (never an email). */
export async function researchManualFund(
  supabase: ServiceClient,
  index: TaxIndex,
  clientId: string,
  input: { name: string; kind: "fund" | "angel"; website: string },
): Promise<Result<Partial<ManualFundInput>>> {
  const name = text(input.name, 120);
  if (!name) return { ok: false, error: "Type the fund's name first." };
  const prompt = await loadPrompt(supabase, "add_fund_research", { clientId, purpose: `Matching: add ${name} by hand` });
  if (!prompt.ok) return { ok: false, error: prompt.error };
  const labels = labelLists(index);
  const website = ownSite(text(input.website, 500));
  const facts = [
    `Investor: ${name} (${input.kind === "angel" ? "an angel, a person" : "a fund"})`,
    website ? `Website (from the admin): ${website}` : "Website: not known yet.",
    "Found by the admin while researching a client's market.",
  ].join("\n");
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(
      prompt.value,
      "## The investor",
      facts,
      "## Labels you may use",
      [
        `firmType: ${labels.firmTypes.join(", ")}`,
        `stages: ${labels.stages.join(", ")}`,
        `geographies: ${labels.geographies.join(", ")}`,
        `industries: ${labels.industries.join(", ")}`,
        `verticals: ${labels.verticals.join(", ")}`,
        `financing: ${labels.financing.join(", ")}`,
      ].join("\n"),
    ),
    content: [{ type: "text", text: `Research ${name} and deliver it by calling the ${RESEARCH_TOOL.name} tool.` }],
    tool: RESEARCH_TOOL,
    serverTools: [webSearchTool(6)],
    requireServerTools: true,
    maxTokens: 6000,
  });
  if (!result.ok) return { ok: false, error: `The research did not finish: ${result.reason}` };
  const r = result.input;
  const people = (Array.isArray(r.people) ? r.people : []).filter((x): x is { name?: string; title?: string } => !!x && typeof x === "object");
  const angel = (r.angel && typeof r.angel === "object" ? r.angel : {}) as Record<string, unknown>;
  const contacts: AddedContact[] =
    input.kind === "angel"
      ? [{ first: text(angel.firstName, 60) || splitName(name).first, last: text(angel.lastName, 80) || splitName(name).last, title: text(angel.title, 120), email: "", confidence: null, linkedin: cleanUrl(angel.linkedin), source: "research" }]
      : pickContacts(
          // pickContacts keys on email: the name stands in for it here (no email from the AI).
          people.map((x) => ({ position: text(x.title, 120), confidence: null, email: text(x.name, 120) })),
          RME.roleOf,
          MAX_ADDED_CONTACTS,
        ).map((x) => ({ ...splitName(x.email), title: x.position, email: "", confidence: null, linkedin: "", source: "research" as const }));
  const year = typeof r.foundedYear === "number" ? r.foundedYear : null;
  return {
    ok: true,
    value: {
      website: website || ownSite(text(r.website, 500)),
      description: text(r.description, 400),
      hqCity: text(r.hqCity, 80),
      hqCountry: onlyLabels([r.hqCountry], countryLabels(index), 1)[0] ?? "",
      foundedYear: year && year > 1900 && year <= new Date().getFullYear() ? year : null,
      firmType: onlyLabels([r.firmType], labels.firmTypes, 1)[0] ?? "",
      stages: onlyLabels(r.stages, labels.stages),
      geographies: onlyLabels(r.geographies, labels.geographies),
      industries: onlyLabels(r.industries, labels.industries),
      verticals: onlyLabels(r.verticals, labels.verticals),
      financing: onlyLabels(r.financing, labels.financing),
      notes: text(r.notes, 800),
      contacts: contacts.filter((c) => c.first || c.last),
    },
  };
}
