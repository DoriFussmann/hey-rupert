import "server-only";
import { randomUUID } from "node:crypto";
import RME, { type FundDb } from "@/lib/match/engine/index.mjs";
import { callClaudeAgent, webSearchTool } from "@/lib/anthropic";
import { domainSearch, findEmail, isHunterConfigured } from "@/lib/hunter";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { TaxIndex } from "@/lib/taxonomy/core";
import { cleanUrl } from "@/lib/match/landscape/core";
import { domainOf } from "@/lib/match/landscape/check";
import {
  onlyLabels,
  pickContacts,
  splitName,
  toContacts,
  toFirm,
  type AddedContact,
  type AddedFund,
  type AddedStatus,
} from "./core.ts";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ADDED_MIGRATION = "The added-funds table is missing. Run portal/supabase/added_funds.sql in the Supabase SQL editor.";

function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /added_funds/.test(message) ? ADDED_MIGRATION : message;
}

type Row = {
  id: string;
  firm_id: string;
  name: string;
  kind: "fund" | "angel";
  status: AddedStatus;
  website: string;
  description: string;
  hq_city: string;
  hq_country: string;
  founded_year: number | null;
  firm_type: string;
  stages: string[];
  geographies: string[];
  industries: string[];
  verticals: string[];
  financing: string[];
  contacts: AddedContact[];
  sources: { url: string; label: string }[];
  notes: string;
  found_for_client: string | null;
  landscape_id: string | null;
  investor_id: string | null;
  created_by: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string;
};

function fromRow(r: Row): AddedFund {
  return {
    id: r.id,
    firmId: r.firm_id,
    name: r.name,
    kind: r.kind,
    status: r.status,
    website: r.website,
    description: r.description,
    hqCity: r.hq_city,
    hqCountry: r.hq_country,
    foundedYear: r.founded_year,
    firmType: r.firm_type,
    stages: r.stages ?? [],
    geographies: r.geographies ?? [],
    industries: r.industries ?? [],
    verticals: r.verticals ?? [],
    financing: r.financing ?? [],
    contacts: r.contacts ?? [],
    sources: r.sources ?? [],
    notes: r.notes,
    foundForClient: r.found_for_client,
    landscapeId: r.landscape_id,
    investorId: r.investor_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
  };
}

// ---------------------------------------------------------------------------
// The taxonomy's labels, and the raw value a provider record would carry

export type LabelLists = {
  stages: string[];
  geographies: string[];
  industries: string[];
  verticals: string[];
  financing: string[];
  firmTypes: string[];
};

export function labelLists(index: TaxIndex): LabelLists {
  const nodes = Array.from(index.nodes.values()).filter((n) => n.status === "active");
  const of = (dimension: string, kinds?: string[], test?: (attrs: Record<string, unknown>) => boolean) =>
    nodes
      .filter((n) => n.dimension === dimension && (!kinds || kinds.includes(n.kind)) && (!test || test(n.attrs)))
      .map((n) => n.label)
      .sort();
  return {
    stages: nodes
      .filter((n) => n.dimension === "stage" && n.kind === "stage")
      .sort((a, b) => Number(a.attrs.ladder ?? 99) - Number(b.attrs.ladder ?? 99))
      .map((n) => n.label),
    geographies: of("geography", ["region", "subregion", "country", "us_region"]),
    industries: of("sector", ["sector"], (a) => a.granularity === "broad"),
    verticals: of("sector", ["sector"], (a) => a.granularity !== "broad"),
    financing: of("financing"),
    firmTypes: of("firm_type"),
  };
}

const FIELD_DIMENSION: Record<string, string> = {
  stage: "stage",
  geography: "geography",
  industry: "sector",
  vertical: "sector",
  financing: "financing",
  firm_type: "firm_type",
  hq_country: "geography",
};

/** A raw value the taxonomy already maps (approved) to this label, in this field; the label itself when there is none. */
export function rawForFn(index: TaxIndex) {
  const cache = new Map<string, string>();
  return (field: string, label: string) => {
    const key = `${field}|${label}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const dimension = FIELD_DIMENSION[field];
    const node = Array.from(index.nodes.values()).find((n) => n.dimension === dimension && n.label.toLowerCase() === label.toLowerCase());
    const alias = node
      ? index.taxonomy.aliases.find((a) => a.field === field && a.state === "mapped" && a.review === "approved" && a.nodeIds.includes(node.id))
      : undefined;
    const raw = alias?.rawValue ?? label;
    cache.set(key, raw);
    return raw;
  };
}

// ---------------------------------------------------------------------------
// Reading

export async function listAddedFunds(supabase: ServiceClient, status?: AddedStatus): Promise<Result<AddedFund[]>> {
  let query = supabase.from("added_funds").select("*").order("created_at", { ascending: false }).limit(1000);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: (data as Row[]).map(fromRow) };
}

/** The funds added from one Step 2 landscape, by investor id. Empty (not an error) before the migration. */
export async function addedForLandscape(supabase: ServiceClient, landscapeId: string): Promise<Record<string, AddedFund>> {
  const { data, error } = await supabase.from("added_funds").select("*").eq("landscape_id", landscapeId);
  if (error || !data) return {};
  return Object.fromEntries((data as Row[]).filter((r) => r.investor_id).map((r) => [r.investor_id!, fromRow(r)]));
}

/**
 * Approved added funds as Fund Database records and contacts, to merge into
 * the live database. Empty before the migration, so matching never breaks.
 */
export async function approvedAsDb(supabase: ServiceClient, index: TaxIndex): Promise<Pick<FundDb, "firms" | "contacts">> {
  const { data, error } = await supabase.from("added_funds").select("*").eq("status", "approved");
  if (error || !data) return { firms: [], contacts: [] };
  const rawFor = rawForFn(index);
  const funds = (data as Row[]).map(fromRow);
  return { firms: funds.map((f) => toFirm(f, rawFor)), contacts: funds.flatMap(toContacts) };
}

/** The live database with the approved added funds appended (never replacing a provider record). */
export function withAdded(db: FundDb, added: Pick<FundDb, "firms" | "contacts">): FundDb {
  if (!added.firms.length) return db;
  const ids = new Set(db.firms.map((f) => f.id));
  const firms = added.firms.filter((f) => !ids.has(f.id));
  const keep = new Set(firms.map((f) => f.id));
  return { ...db, firms: [...db.firms, ...firms], contacts: [...db.contacts, ...added.contacts.filter((c) => keep.has(c.fid))] };
}

// ---------------------------------------------------------------------------
// Try and Add to DB

const RESEARCH_TOOL = {
  name: "submit_fund",
  description: "Deliver what you found about the investor.",
  input_schema: {
    type: "object",
    properties: {
      website: { type: "string" },
      description: { type: "string" },
      hqCity: { type: "string" },
      hqCountry: { type: "string" },
      foundedYear: { type: "integer" },
      firmType: { type: "string" },
      stages: { type: "array", items: { type: "string" } },
      geographies: { type: "array", items: { type: "string" } },
      industries: { type: "array", items: { type: "string" } },
      verticals: { type: "array", items: { type: "string" } },
      financing: { type: "array", items: { type: "string" } },
      people: {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" }, title: { type: "string" } }, required: ["name", "title"] },
      },
      angel: {
        type: "object",
        description: "For an angel only: the person.",
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          title: { type: "string" },
          firm: { type: "string" },
          firmWebsite: { type: "string" },
          linkedin: { type: "string" },
        },
      },
      sources: {
        type: "array",
        items: { type: "object", properties: { url: { type: "string" }, label: { type: "string" } }, required: ["url", "label"] },
      },
      notes: { type: "string", description: "Anything a reviewer should know: doubts, what you couldn't confirm." },
    },
    required: ["website", "description", "stages", "geographies", "industries", "verticals", "people", "sources", "notes"],
  },
};

export type AddInput = {
  clientId: string;
  landscapeId: string;
  investorId: string;
  name: string;
  kind: "fund" | "angel";
  website: string;
  competitors: string[];
  sourceUrl: string;
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Researches a missing investor, finds up to 5 investing contacts with
 * Hunter, and saves it as pending. Pending: used for this client only, until
 * an admin approves it for the shared database.
 */
export async function addFund(supabase: ServiceClient, index: TaxIndex, input: AddInput, actor: string | null): Promise<Result<AddedFund>> {
  const existing = await addedForLandscape(supabase, input.landscapeId);
  if (existing[input.investorId]) return { ok: true, value: existing[input.investorId] };
  const prompt = await loadPrompt(supabase, "add_fund_research", { clientId: input.clientId, purpose: `Step 2: add ${input.name}` });
  if (!prompt.ok) return { ok: false, error: prompt.error };
  const labels = labelLists(index);
  const facts = [
    `Investor: ${input.name} (${input.kind === "angel" ? "an angel, a person" : "a fund"})`,
    input.website ? `Website (from earlier research or the admin): ${input.website}` : "Website: not known yet.",
    `Invested in: ${input.competitors.join(", ")}`,
    input.sourceUrl ? `Source article: ${input.sourceUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
    content: [{ type: "text", text: `Research ${input.name} and deliver it by calling the ${RESEARCH_TOOL.name} tool.` }],
    tool: RESEARCH_TOOL,
    serverTools: [webSearchTool(6)],
    requireServerTools: true,
    maxTokens: 6000,
  });
  if (!result.ok) return { ok: false, error: `The research did not finish: ${result.reason}` };
  const r = result.input;
  const angel = (r.angel && typeof r.angel === "object" ? r.angel : {}) as Record<string, unknown>;
  const website = cleanUrl(r.website) || cleanUrl(input.website) || (input.kind === "angel" ? cleanUrl(angel.firmWebsite) : "");
  const domain = website ? domainOf(website) : "";

  // Contacts: Hunter only (the AI never supplies an email).
  const contacts: AddedContact[] = [];
  let credits = 0;
  const notes: string[] = [text(r.notes, 800)].filter(Boolean);
  if (!isHunterConfigured()) notes.push("Hunter is not set up (HUNTER_API_KEY): no emails looked up.");
  else if (input.kind === "angel") {
    const first = text(angel.firstName, 60) || splitName(input.name).first;
    const last = text(angel.lastName, 80) || splitName(input.name).last;
    const angelDomain = domainOf(cleanUrl(angel.firmWebsite) || website);
    if (first && last && angelDomain) {
      const found = await findEmail({ domain: angelDomain, firstName: first, lastName: last });
      if (found.ok && found.value) {
        credits += 1;
        contacts.push({ first, last, title: text(angel.title, 120), email: found.value.email, confidence: found.value.score, linkedin: cleanUrl(angel.linkedin), source: "hunter_finder" });
      } else if (!found.ok) notes.push(found.reason);
      else notes.push("Hunter found no email for this person.");
    } else notes.push("No name and website to look up an email for this angel.");
  } else if (domain) {
    const found = await domainSearch(domain, 10);
    if (found.ok) {
      if (found.value.people.length) credits += 1;
      for (const p of pickContacts(found.value.people, RME.roleOf)) {
        contacts.push({
          first: p.firstName,
          last: p.lastName,
          title: p.position,
          email: p.email,
          confidence: p.confidence,
          linkedin: cleanUrl(p.linkedin),
          source: "hunter_domain",
        });
      }
      // Hunter knew nobody investing: look up the investing team the research named, one by one.
      if (!contacts.length) {
        const people = (Array.isArray(r.people) ? r.people : []) as { name?: string; title?: string }[];
        const ranked = pickContacts(
          people.map((x) => ({ ...x, position: text(x.title, 120), confidence: null, email: text(x.name, 120) })),
          RME.roleOf,
          3,
        );
        for (const person of ranked) {
          const { first, last } = splitName(person.email);
          const one = await findEmail({ domain, firstName: first, lastName: last });
          if (one.ok && one.value) {
            credits += 1;
            contacts.push({ first, last, title: person.position, email: one.value.email, confidence: one.value.score, linkedin: "", source: "hunter_finder" });
          }
        }
      }
      if (!contacts.length) notes.push("Hunter found no investing contacts at this domain.");
    } else notes.push(found.reason);
  } else notes.push("No website found, so no emails could be looked up.");

  const year = typeof r.foundedYear === "number" && r.foundedYear > 1900 && r.foundedYear <= new Date().getFullYear() ? r.foundedYear : null;
  const sources = (Array.isArray(r.sources) ? r.sources : [])
    .map((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      return { url: cleanUrl(x.url), label: text(x.label, 120) };
    })
    .filter((s) => s.url)
    .slice(0, 10);
  if (input.sourceUrl && !sources.some((s) => s.url === input.sourceUrl)) sources.unshift({ url: input.sourceUrl, label: "Funding article" });
  const [firmType] = onlyLabels([r.firmType], labels.firmTypes, 1);

  const row = {
    firm_id: `RUP-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: input.name,
    kind: input.kind,
    status: "pending",
    website,
    description: text(r.description, 400),
    hq_city: text(r.hqCity, 80),
    hq_country: onlyLabels([r.hqCountry], labels.geographies, 1)[0] ?? text(r.hqCountry, 80),
    founded_year: year,
    firm_type: firmType ?? "",
    stages: onlyLabels(r.stages, labels.stages),
    geographies: onlyLabels(r.geographies, labels.geographies),
    industries: onlyLabels(r.industries, labels.industries),
    verticals: onlyLabels(r.verticals, labels.verticals),
    financing: onlyLabels(r.financing, labels.financing),
    contacts,
    sources,
    notes: notes.join(" ").slice(0, 1500),
    found_for_client: input.clientId,
    landscape_id: input.landscapeId,
    investor_id: input.investorId,
    hunter_credits: credits,
    usage: result.usage,
    created_by: actor,
  };
  const { data, error } = await supabase.from("added_funds").insert(row).select("*").single<Row>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

// ---------------------------------------------------------------------------
// Review (Fund Database page)

export type AddedEdits = Partial<
  Pick<AddedFund, "name" | "website" | "description" | "hqCity" | "hqCountry" | "firmType" | "stages" | "geographies" | "industries" | "verticals" | "financing">
>;

/** Edits a pending fund's details (labels outside the taxonomy are dropped). */
export async function editAddedFund(supabase: ServiceClient, index: TaxIndex, id: string, edits: AddedEdits): Promise<Result<AddedFund>> {
  const labels = labelLists(index);
  const patch: Record<string, unknown> = {};
  if (edits.name !== undefined) patch.name = text(edits.name, 120);
  if (edits.website !== undefined) patch.website = cleanUrl(edits.website);
  if (edits.description !== undefined) patch.description = text(edits.description, 400);
  if (edits.hqCity !== undefined) patch.hq_city = text(edits.hqCity, 80);
  if (edits.hqCountry !== undefined) patch.hq_country = onlyLabels([edits.hqCountry], labels.geographies, 1)[0] ?? "";
  if (edits.firmType !== undefined) patch.firm_type = onlyLabels([edits.firmType], labels.firmTypes, 1)[0] ?? "";
  if (edits.stages !== undefined) patch.stages = onlyLabels(edits.stages, labels.stages);
  if (edits.geographies !== undefined) patch.geographies = onlyLabels(edits.geographies, labels.geographies);
  if (edits.industries !== undefined) patch.industries = onlyLabels(edits.industries, labels.industries);
  if (edits.verticals !== undefined) patch.verticals = onlyLabels(edits.verticals, labels.verticals);
  if (edits.financing !== undefined) patch.financing = onlyLabels(edits.financing, labels.financing);
  if (patch.name === "") return { ok: false, error: "A fund needs a name." };
  const { data, error } = await supabase.from("added_funds").update(patch).eq("id", id).eq("status", "pending").select("*").single<Row>();
  if (error) return { ok: false, error: error.code === "PGRST116" ? "Only a pending fund can be edited." : tableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

/** Approve (joins the shared database for every client), reject, or back to pending. */
export async function reviewAddedFund(
  supabase: ServiceClient,
  id: string,
  status: AddedStatus,
  note: string,
  actor: string | null,
): Promise<Result<AddedFund>> {
  const { data, error } = await supabase
    .from("added_funds")
    .update({
      status,
      review_note: text(note, 500),
      reviewed_by: status === "pending" ? null : actor,
      reviewed_at: status === "pending" ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single<Row>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}
