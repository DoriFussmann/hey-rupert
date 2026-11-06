import "server-only";
import { randomUUID } from "node:crypto";
import RME, { type FundDb } from "@/lib/match/engine/index.mjs";
import { callClaudeAgent, webSearchTool } from "@/lib/anthropic";
import { domainSearch, findEmail, isHunterConfigured } from "@/lib/hunter";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { TaxIndex } from "@/lib/taxonomy/core";
import { investorKey } from "@/lib/match/landscape/investors";
import { cleanUrl } from "@/lib/match/landscape/core";
import { loadLiveDb } from "@/lib/match/db-server";
import { domainOf } from "@/lib/match/landscape/check";
import {
  addedRevision,
  ownSite,
  rawForFn,
  onlyLabels,
  pickContacts,
  splitName,
  toContacts,
  toFirm,
  type AddedContact,
  type AddedFund,
  type AddedStatus,
  type AiSuggestion,
  missingFields,
  type FillItem,
  type MissingField,
} from "./core.ts";
import { buildDryData } from "@/lib/match/dry/core";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ADDED_MIGRATION = "The added-funds table is missing. Run portal/supabase/added_funds.sql in the Supabase SQL editor.";

export function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" ? ADDED_MIGRATION : message;
}

/** Whether the table exists. Checked before any paid call (research, Hunter). */
export async function tableReady(supabase: ServiceClient): Promise<boolean> {
  const { error } = await supabase.from("added_funds").select("id").limit(1);
  return !error;
}

export type Row = {
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
  ai_suggestion?: AiSuggestion | null;
};

export function fromRow(r: Row): AddedFund {
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
    aiSuggestion: r.ai_suggestion ?? null,
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

// ---------------------------------------------------------------------------
// Reading

export async function listAddedFunds(supabase: ServiceClient, status?: AddedStatus): Promise<Result<AddedFund[]>> {
  let query = supabase.from("added_funds").select("*").order("created_at", { ascending: false }).range(0, 4999);
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
 * Added funds as Fund Database records and contacts, to merge into the live
 * database for one client: every approved fund, plus the pending ones found
 * for this client (they count for it until reviewed). Empty before the
 * migration, so matching never breaks.
 */
export async function addedAsDb(
  supabase: ServiceClient,
  index: TaxIndex,
  clientId: string,
): Promise<Pick<FundDb, "firms" | "contacts"> & { revision: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return { firms: [], contacts: [], revision: "" };
  const { data, error } = await supabase
    .from("added_funds")
    .select("*")
    .or(`status.eq.approved,and(status.eq.pending,found_for_client.eq.${clientId})`)
    .range(0, 9999);
  if (error || !data) return { firms: [], contacts: [], revision: "" };
  const rawFor = rawForFn(index);
  const funds = (data as Row[]).map(fromRow);
  return { firms: funds.map((f) => toFirm(f, rawFor)), contacts: funds.flatMap(toContacts), revision: addedRevision(funds) };
}

/** The live database with added funds appended (never replacing a provider record). */
export function withAdded(db: FundDb, added: Pick<FundDb, "firms" | "contacts">): FundDb {
  if (!added.firms.length) return db;
  const ids = new Set(db.firms.map((f) => f.id));
  const firms = added.firms.filter((f) => !ids.has(f.id));
  const keep = new Set(firms.map((f) => f.id));
  return { ...db, firms: [...db.firms, ...firms], contacts: [...db.contacts, ...added.contacts.filter((c) => keep.has(c.fid))] };
}

// ---------------------------------------------------------------------------
// Try and Add to DB

export const RESEARCH_TOOL = {
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
export type AddOutcome =
  | { kind: "added"; fund: AddedFund }
  | { kind: "existing"; fund: AddedFund }
  /** Its website belongs to a record already in the database: match it instead of adding. */
  | { kind: "in_database"; firm: { id: string; name: string }; website: string };

export async function addFund(
  supabase: ServiceClient,
  index: TaxIndex,
  input: AddInput,
  actor: string | null,
  /** The database record with this website, if any (provider or added). */
  inDatabase: (website: string) => { id: string; name: string } | null,
): Promise<Result<AddOutcome>> {
  // Before any paid call: the table, and whether this investor is already added (here or for another client).
  if (!(await tableReady(supabase))) return { ok: false, error: ADDED_MIGRATION };
  const existing = await addedForLandscape(supabase, input.landscapeId);
  const mine = existing[input.investorId];
  if (mine && mine.status !== "rejected") return { ok: true, value: { kind: "existing", fund: mine } };
  const known = cleanUrl(input.website) ? ownSite(input.website) : "";
  const elsewhere = await findAddedElsewhere(supabase, input.name, known);
  if (elsewhere) {
    return {
      ok: false,
      error: `${elsewhere.name} was already added (${elsewhere.status === "pending" ? "pending review" : elsewhere.status})${
        elsewhere.landscapeId === input.landscapeId ? " for another investor on this list" : " while researching another client"
      }. ${
        elsewhere.status === "pending" ? "Approve it on the Fund Database page to use it for every client." : ""
      }`.trim(),
    };
  }
  if (known) {
    const firm = inDatabase(known);
    if (firm) return { ok: true, value: { kind: "in_database", firm, website: known } };
  }
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
  // The admin's (or accepted) website wins over the research's; platforms (LinkedIn…) are never a fund's site.
  // An angel's employer's site is used to look up their email, never stored as the angel's own.
  const website = known || ownSite(text(r.website, 500));
  const domain = input.kind === "fund" && website ? domainOf(website) : "";
  if (website) {
    const firm = inDatabase(website);
    if (firm) return { ok: true, value: { kind: "in_database", firm, website } };
  }

  // Contacts: Hunter only (the AI never supplies an email).
  const contacts: AddedContact[] = [];
  let credits = 0;
  const notes: string[] = [text(r.notes, 800)].filter(Boolean);
  if (!isHunterConfigured()) notes.push("Hunter is not set up (HUNTER_API_KEY): no emails looked up.");
  else if (input.kind === "angel") {
    const first = text(angel.firstName, 60) || splitName(input.name).first;
    const last = text(angel.lastName, 80) || splitName(input.name).last;
    const angelDomain = domainOf(ownSite(text(angel.firmWebsite, 500)) || website);
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
        const people = (Array.isArray(r.people) ? r.people : []).filter(
          (x): x is { name?: string; title?: string } => !!x && typeof x === "object",
        );
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
  const country = text(r.hqCountry, 80);
  if (country && !onlyLabels([country], countryLabels(index), 1).length) notes.push(`HQ country as found: ${country}.`);

  const row = {
    firm_id: `RUP-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: input.name,
    kind: input.kind,
    status: "pending",
    website,
    description: text(r.description, 400),
    hq_city: text(r.hqCity, 80),
    hq_country: onlyLabels([r.hqCountry], countryLabels(index), 1)[0] ?? "",
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
  // A rejected earlier attempt for this investor makes way for the new one.
  if (mine && mine.status === "rejected") await supabase.from("added_funds").delete().eq("id", mine.id).eq("status", "rejected");
  const { data, error } = await supabase.from("added_funds").insert(row).select("*").single<Row>();
  if (error) {
    if (error.code === "23505") {
      const again = await addedForLandscape(supabase, input.landscapeId);
      if (again[input.investorId]) return { ok: true, value: { kind: "existing", fund: again[input.investorId] } };
    }
    return { ok: false, error: tableError(error.message, error.code) };
  }
  return { ok: true, value: { kind: "added", fund: fromRow(data) } };
}

/** The country labels (for an HQ country). */
export function countryLabels(index: TaxIndex) {
  return Array.from(index.nodes.values())
    .filter((n) => n.status === "active" && n.dimension === "geography" && n.kind === "country")
    .map((n) => n.label);
}

/** An added fund (not rejected) for another landscape with the same name or website, if any. */
export async function findAddedElsewhere(supabase: ServiceClient, name: string, website: string): Promise<AddedFund | null> {
  const { data, error } = await supabase.from("added_funds").select("*").neq("status", "rejected").range(0, 4999);
  if (error || !data) return null;
  const key = investorKey(name);
  const domain = website ? domainOf(website) : "";
  const hit = (data as Row[]).find((r) => (key && investorKey(r.name) === key) || (domain && r.website && domainOf(r.website) === domain));
  return hit ? fromRow(hit) : null;
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
  if (edits.website !== undefined) patch.website = ownSite(edits.website);
  if (edits.description !== undefined) patch.description = text(edits.description, 400);
  if (edits.hqCity !== undefined) patch.hq_city = text(edits.hqCity, 80);
  if (edits.hqCountry !== undefined) patch.hq_country = onlyLabels([edits.hqCountry], countryLabels(index), 1)[0] ?? "";
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

export type FilledFields = { stages?: string[]; geographies?: string[]; sectors?: string[] };

/**
 * Step 3A: fills in the fields an added investor is missing (stage,
 * geography, sector), pending or approved. Only labels the taxonomy has are
 * kept; a sector goes to industries or verticals by its granularity. With a
 * client, only investors added for that client can be changed. Clears the AI
 * suggestion, which this answers.
 */
export async function fillAddedFields(
  supabase: ServiceClient,
  index: TaxIndex,
  clientId: string | null,
  id: string,
  fields: FilledFields,
): Promise<Result<AddedFund>> {
  const labels = labelLists(index);
  const patch: Record<string, unknown> = {};
  if (fields.stages?.length) patch.stages = onlyLabels(fields.stages, labels.stages);
  if (fields.geographies?.length) patch.geographies = onlyLabels(fields.geographies, labels.geographies);
  if (fields.sectors?.length) {
    const industries = onlyLabels(fields.sectors, labels.industries);
    const verticals = onlyLabels(fields.sectors, labels.verticals);
    if (industries.length || verticals.length) {
      patch.industries = industries;
      patch.verticals = verticals;
    }
  }
  const empty = Object.values(patch).every((v) => !(v as string[]).length);
  if (empty) return { ok: false, error: "Choose at least one value." };
  let query = supabase.from("added_funds").update(patch).eq("id", id).in("status", ["pending", "approved"]);
  if (clientId) query = query.eq("found_for_client", clientId);
  const { data, error } = await query.select("*").single<Row>();
  if (error) return { ok: false, error: error.code === "PGRST116" ? "That investor wasn't added for this client, or was rejected." : tableError(error.message, error.code) };
  // The suggestion is answered (its own column: never breaks the save before the migration). A field the AI
  // already searched and found nothing for stays marked that way, so it isn't searched again.
  const saved = fromRow(data);
  const before = saved.aiSuggestion ?? null;
  const left = missingOf(index, saved);
  const next: AiSuggestion | null =
    before && left.length && left.every((m) => before.fields.includes(m))
      ? { ...before, fields: left, stages: [], geographies: [], sectors: [], skipped: false }
      : null;
  await supabase.from("added_funds").update({ ai_suggestion: next }).eq("id", id);
  return { ok: true, value: { ...saved, aiSuggestion: next } };
}

/** The fields Step 1 would find empty for an added investor, read through the taxonomy like any fund. */
export function missingOf(index: TaxIndex, fund: AddedFund): MissingField[] {
  const firm = toFirm(fund, rawForFn(index));
  const data = buildDryData({ firms: [firm], contacts: [] } as unknown as FundDb, index, { financing: [], stage: null, hqCountry: null, primarySector: null });
  return data.funds[0] ? missingFields(data.funds[0]) : [];
}

/** The added investors (not rejected) with missing fields, for 3A and the Fund Database page. */
export function fillItems(index: TaxIndex, funds: AddedFund[]): FillItem[] {
  return funds
    .filter((f) => f.status !== "rejected")
    .map((f) => ({ f, missing: missingOf(index, f) }))
    .filter((x) => x.missing.length)
    .map(({ f, missing }) => ({
      addedId: f.id,
      name: f.name,
      kind: f.kind,
      status: f.status as "pending" | "approved",
      website: f.website,
      missing,
      stages: f.stages,
      geographies: f.geographies,
      sectors: [...f.industries, ...f.verticals],
      financing: f.financing,
      hqCountry: f.hqCountry,
      firmType: f.firmType,
      suggestion: f.aiSuggestion ?? null,
    }));
}

export const AI_FIELDS_MIGRATION = "The AI-suggestions column is missing. Run portal/supabase/added_fields_ai.sql in the Supabase SQL editor.";

const SUGGEST_TOOL = {
  name: "submit_fields",
  description: "Deliver the missing fields you found.",
  input_schema: {
    type: "object",
    properties: {
      stages: { type: "array", items: { type: "string" } },
      geographies: { type: "array", items: { type: "string" } },
      sectors: { type: "array", items: { type: "string" } },
      sources: {
        type: "array",
        items: { type: "object", properties: { url: { type: "string" }, label: { type: "string" } }, required: ["url", "label"] },
      },
      note: { type: "string", description: "What you couldn't find, and anything a reviewer should know." },
    },
    required: ["stages", "geographies", "sectors", "sources", "note"],
  },
};

/**
 * Fill missing fields with AI, for one added investor: a web search for its
 * missing fields only, in the taxonomy's labels. Saved as a suggestion that
 * waits for the admin's Accept; nothing counts until then.
 */
export async function suggestMissingFields(supabase: ServiceClient, index: TaxIndex, id: string, clientId: string | null): Promise<Result<AiSuggestion>> {
  const { data: row, error } = await supabase.from("added_funds").select("*").eq("id", id).maybeSingle<Row>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!row || row.status === "rejected" || (clientId && row.found_for_client !== clientId)) return { ok: false, error: "Unknown investor." };
  if (!("ai_suggestion" in row)) return { ok: false, error: AI_FIELDS_MIGRATION };
  const fund = fromRow(row);
  const missing = missingOf(index, fund);
  if (!missing.length) return { ok: false, error: `${fund.name} has nothing missing.` };
  const prompt = await loadPrompt(supabase, "added_fields_fill", { clientId: row.found_for_client, purpose: `Fill missing fields: ${fund.name}` });
  if (!prompt.ok) return { ok: false, error: prompt.error };
  const labels = labelLists(index);
  const sectors = [...labels.industries, ...labels.verticals].sort();
  const word: Record<MissingField, string> = { stage: "stages", geography: "geographies", sector: "sectors" };
  const known = [
    fund.stages.length ? `stages: ${fund.stages.join(", ")}` : "",
    fund.geographies.length ? `geographies: ${fund.geographies.join(", ")}` : "",
    fund.industries.length || fund.verticals.length ? `sectors: ${[...fund.industries, ...fund.verticals].join(", ")}` : "",
    fund.hqCountry ? `HQ country: ${fund.hqCountry}` : "",
    fund.description ? `description: ${fund.description}` : "",
  ].filter(Boolean);
  const facts = [
    `Investor: ${fund.name} (${fund.kind === "angel" ? "an angel, a person" : "a fund"})`,
    fund.website ? `Website: ${fund.website}` : "Website: not known.",
    known.length ? `Already known (some may not map to the taxonomy):\n${known.join("\n")}` : "Already known: nothing.",
    `Fields to fill: ${missing.map((m) => word[m]).join(", ")}`,
  ].join("\n");
  const allowed = [
    missing.includes("stage") ? `stages: ${labels.stages.join(", ")}` : "",
    missing.includes("geography") ? `geographies: ${labels.geographies.join(", ")}` : "",
    missing.includes("sector") ? `sectors: ${sectors.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value, "## The investor", facts, "## Labels you may use", allowed),
    content: [{ type: "text", text: `Find ${fund.name}'s missing fields and deliver them by calling the ${SUGGEST_TOOL.name} tool.` }],
    tool: SUGGEST_TOOL,
    serverTools: [webSearchTool(4)],
    requireServerTools: true,
    maxTokens: 3000,
  });
  if (!result.ok) return { ok: false, error: `${fund.name}: the search did not finish (${result.reason}).` };
  const r = result.input;
  const suggestion: AiSuggestion = {
    fields: missing,
    stages: missing.includes("stage") ? onlyLabels(r.stages, labels.stages) : [],
    geographies: missing.includes("geography") ? onlyLabels(r.geographies, labels.geographies) : [],
    sectors: missing.includes("sector") ? onlyLabels(r.sectors, sectors) : [],
    sources: (Array.isArray(r.sources) ? r.sources : [])
      .map((x) => {
        const v = (x ?? {}) as Record<string, unknown>;
        return { url: cleanUrl(v.url), label: text(v.label, 120) };
      })
      .filter((x) => x.url)
      .slice(0, 6),
    note: text(r.note, 600),
    at: new Date().toISOString(),
  };
  const saved = await supabase.from("added_funds").update({ ai_suggestion: suggestion }).eq("id", id);
  if (saved.error) return { ok: false, error: /ai_suggestion/.test(saved.error.message) ? AI_FIELDS_MIGRATION : saved.error.message };
  return { ok: true, value: suggestion };
}

/** Skip an investor's missing fields for now (it stays off the Roster), or bring it back. Kept with the suggestion. */
export async function skipMissingFields(supabase: ServiceClient, id: string, skip: boolean): Promise<Result<null>> {
  const { data, error } = await supabase.from("added_funds").select("ai_suggestion").eq("id", id).maybeSingle<{ ai_suggestion: AiSuggestion | null }>();
  if (error) return { ok: false, error: /ai_suggestion/.test(error.message) ? AI_FIELDS_MIGRATION : error.message };
  const current = data?.ai_suggestion ?? null;
  const next: AiSuggestion | null = skip
    ? { ...(current ?? { fields: [], stages: [], geographies: [], sectors: [], sources: [], note: "", at: new Date().toISOString() }), skipped: true }
    : current && (current.stages.length || current.geographies.length || current.sectors.length || current.note)
      ? { ...current, skipped: false }
      : null;
  const saved = await supabase.from("added_funds").update({ ai_suggestion: next }).eq("id", id);
  return saved.error ? { ok: false, error: saved.error.message } : { ok: true, value: null };
}

/** Dismiss an AI suggestion without using it. */
export async function dismissSuggestion(supabase: ServiceClient, id: string): Promise<Result<null>> {
  const { error } = await supabase.from("added_funds").update({ ai_suggestion: null }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true, value: null };
}

/** Approve (joins the shared database for every client), reject, or back to pending. */
export async function reviewAddedFund(
  supabase: ServiceClient,
  id: string,
  status: AddedStatus,
  note: string,
  actor: string | null,
): Promise<Result<AddedFund>> {
  if (status === "approved") {
    // Never a second record for a fund the provider already has (same website).
    const { data: current } = await supabase.from("added_funds").select("*").eq("id", id).maybeSingle<Row>();
    if (current?.website) {
      const live = await loadLiveDb(supabase);
      if (live.ok) {
        const domain = domainOf(current.website);
        const clash = live.value.db.firms.find((f) => f.web && domainOf(f.web) === domain);
        if (clash) {
          return {
            ok: false,
            error: `${clash.name} (${clash.id}) is already in the Fund Database with this website. Reject this one, or correct its website if it's a different fund.`,
          };
        }
      }
    }
  }
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

/**
 * Approve All Pending: every pending fund (or only those found for one client) joins the shared
 * database at once. Same rule as one by one: a fund whose website the provider already has is
 * left pending and reported, never added as a second record.
 */
export async function approveAllPending(
  supabase: ServiceClient,
  actor: string | null,
  clientId: string | null = null,
): Promise<Result<{ approved: number; skipped: { name: string; reason: string }[] }>> {
  let query = supabase.from("added_funds").select("*").eq("status", "pending").range(0, 4999);
  if (clientId) query = query.eq("found_for_client", clientId);
  const { data, error } = await query;
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  const pending = (data ?? []) as Row[];
  if (!pending.length) return { ok: true, value: { approved: 0, skipped: [] } };
  const live = await loadLiveDb(supabase);
  const byDomain = new Map<string, { id: string; name: string }>();
  if (live.ok) for (const f of live.value.db.firms) if (f.web) byDomain.set(domainOf(f.web), { id: f.id, name: f.name });
  const skipped: { name: string; reason: string }[] = [];
  const ids: string[] = [];
  for (const r of pending) {
    const clash = r.website ? byDomain.get(domainOf(r.website)) : undefined;
    if (clash) skipped.push({ name: r.name, reason: `${clash.name} (${clash.id}) already has this website: reject it, or correct its website.` });
    else ids.push(r.id);
  }
  for (let at = 0; at < ids.length; at += 200) {
    const { error: upError } = await supabase
      .from("added_funds")
      .update({ status: "approved", review_note: "Approved with Approve All Pending.", reviewed_by: actor, reviewed_at: new Date().toISOString() })
      .in("id", ids.slice(at, at + 200))
      .eq("status", "pending");
    if (upError) return { ok: false, error: tableError(upError.message, upError.code) };
  }
  return { ok: true, value: { approved: ids.length, skipped } };
}

export { ownSite, rawForFn };
