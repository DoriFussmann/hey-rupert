import "server-only";
import { randomUUID } from "node:crypto";
import { callClaudeAgent, callClaudeTool, webSearchTool, type ClaudeUsage } from "@/lib/anthropic";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import { loadCompanyProfile } from "@/lib/company-profile/server";
import { loadProfileState } from "@/lib/match/profile-server";
import type { createServiceClient } from "@/lib/supabase/admin";
import { MAX_COMPETITORS, cleanUrl, orderCompetitors, sameName, type Competitor, type LinkState } from "./core.ts";
import { cleanInvestor, cleanInvestorList, mergeInvestor, orderInvestors, type Investor, type ResearchState } from "./investors.ts";
import { checkInvestors, type Bucket, type CheckRow, type InvestorDecision, type WebsiteSuggestion } from "./check.ts";
import { buildDryData, type DryStep } from "@/lib/match/dry/core";
import { matchDataSnapshot } from "@/lib/match/tiers/server";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const LANDSCAPE_MIGRATION = "The Step 2 table is missing. Run portal/supabase/competitive_landscape.sql in the Supabase SQL editor.";

export function landscapeTableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /competitor_landscapes/.test(message) || message.toLowerCase().includes("schema cache")
    ? LANDSCAPE_MIGRATION
    : message;
}

export type Landscape = {
  id: string;
  status: "draft" | "confirmed";
  competitors: Competitor[];
  unfundedNamed: string[];
  clientNamed: string[];
  searchedAt: string;
  searchedBy: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** Step 2B. */
  investors: Investor[];
  research: Record<string, ResearchState>;
  investorsStatus: "none" | "draft" | "confirmed";
  investorsConfirmedAt: string | null;
  investorsConfirmedBy: string | null;
};

type Row = {
  id: string;
  status: "draft" | "confirmed";
  competitors: unknown[];
  unfunded_named: string[];
  client_named: string[];
  searched_at: string;
  searched_by: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  investors: unknown[] | null;
  investor_research: Record<string, ResearchState> | null;
  investors_status: "none" | "draft" | "confirmed" | null;
  investors_confirmed_at: string | null;
  investors_confirmed_by: string | null;
};

const COLUMNS =
  "id, status, competitors, unfunded_named, client_named, searched_at, searched_by, confirmed_at, confirmed_by, investors, investor_research, investors_status, investors_confirmed_at, investors_confirmed_by";

function fromRow(row: Row): Landscape {
  return {
    id: row.id,
    status: row.status,
    competitors: orderCompetitors(row.competitors ?? [], () => randomUUID()),
    unfundedNamed: row.unfunded_named ?? [],
    clientNamed: row.client_named ?? [],
    searchedAt: row.searched_at,
    searchedBy: row.searched_by,
    confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmed_by,
    investors: cleanInvestorList(row.investors ?? [], () => randomUUID()),
    research: row.investor_research ?? {},
    investorsStatus: row.investors_status ?? "none",
    investorsConfirmedAt: row.investors_confirmed_at,
    investorsConfirmedBy: row.investors_confirmed_by,
  };
}

export async function currentLandscape(supabase: ServiceClient, clientId: string): Promise<Result<Landscape | null>> {
  const { data, error } = await supabase
    .from("competitor_landscapes")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("searched_at", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: data ? fromRow(data) : null };
}

/** The client's confirmed Step 1 list, which Step 2 builds on. */
export async function confirmedDryList(supabase: ServiceClient, clientId: string): Promise<Result<string | null>> {
  const { data, error } = await supabase
    .from("dry_match_lists")
    .select("id")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: data?.id ?? null };
}

// ---------------------------------------------------------------------------
// What the client said

type CompanyFacts = {
  name: string;
  website: string;
  oneLiner: string;
  product: string;
  customers: string;
  model: string;
  sectors: string[];
  stage: string;
  hq: string;
  markets: string[];
  /** The founder's own words about competitors: profile list and intake note. */
  clientText: string;
  clientList: string[];
  /** Taxonomy labels the competitors' fields must use. */
  sectorLabels: string[];
  stageLabels: string[];
};

async function companyFacts(supabase: ServiceClient, clientId: string): Promise<Result<CompanyFacts>> {
  const state = await loadProfileState(supabase, clientId);
  if (!state.ok) return { ok: false, error: state.error };
  if (!state.value) return { ok: false, error: "This client has no company profile yet." };
  const loaded = await loadCompanyProfile(supabase, clientId, state.value);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const p = loaded.value.profile;
  const nodes = Array.from(loaded.value.index.nodes.values()).filter((node) => node.status === "active");
  const sectorLabels = nodes.filter((node) => node.dimension === "sector" && node.kind === "sector").map((node) => node.label).sort();
  const stageLabels = nodes
    .filter((node) => node.dimension === "stage" && node.kind === "stage")
    .sort((a, b) => Number(a.attrs.ladder ?? 99) - Number(b.attrs.ladder ?? 99))
    .map((node) => node.label);
  const { data: interview } = await supabase
    .from("intake_interviews")
    .select("topic_status")
    .eq("client_id", clientId)
    .maybeSingle<{ topic_status: Record<string, { note?: string }> | null }>();
  const note = interview?.topic_status?.competitors?.note?.trim() ?? "";
  const clientList = p.exclusions.competitors.map((s) => s.trim()).filter(Boolean);
  return {
    ok: true,
    value: {
      name: p.identity.name,
      website: p.identity.website,
      oneLiner: p.identity.oneLiner,
      product: p.business.product?.text ?? "",
      customers: p.business.customers?.text ?? "",
      model: p.business.businessModel,
      sectors: p.sectors.map((s) => `${s.label} (${s.role})`),
      stage: p.stage?.label ?? "",
      hq: [p.hq.city, p.hq.state?.label, p.hq.country?.label].filter(Boolean).join(", "),
      markets: p.markets.map((m) => m.label),
      clientText: [clientList.length ? `Competitors listed in the profile: ${clientList.join(", ")}` : "", note ? `Intake note on competitors: ${note}` : ""]
        .filter(Boolean)
        .join("\n"),
      clientList,
      sectorLabels,
      stageLabels,
    },
  };
}

// ---------------------------------------------------------------------------
// The search


const TOOL = {
  name: "submit_competitors",
  description: "Deliver the funded direct competitors, most relevant first.",
  input_schema: {
    type: "object",
    properties: {
      competitors: {
        type: "array",
        maxItems: MAX_COMPETITORS,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            website: { type: "string" },
            oneLiner: { type: "string" },
            hq: { type: "string", description: "City and country" },
            stage: { type: "string", description: "The stage of its latest round, one of the stage labels given" },
            geography: { type: "string", description: "Its HQ country, e.g. United States" },
            primarySector: { type: "string", description: "Its primary sector, one of the sector labels given" },
            source: { type: "string", enum: ["client", "web"] },
            why: { type: "string" },
            funding: {
              type: "object",
              properties: {
                totalRaised: { type: "string", description: "e.g. $29M, as reported" },
                lastRound: { type: "string", description: "e.g. $25M Series A" },
                lastRoundDate: { type: "string", description: "e.g. April 2026" },
                investors: { type: "array", items: { type: "string" } },
              },
              required: ["totalRaised", "lastRound", "lastRoundDate", "investors"],
            },
            newsUrl: { type: "string" },
            newsTitle: { type: "string" },
          },
          required: ["name", "website", "source", "why", "funding", "newsUrl", "stage", "geography", "primarySector"],
        },
      },
      unfundedNamed: { type: "array", items: { type: "string" }, description: "Founder-named competitors with no funding found" },
    },
    required: ["competitors", "unfundedNamed"],
  },
};

const BLOCKED = new Set([401, 403, 405, 406, 429, 999]);

/** Opens a link: live (2xx–3xx), broken (404, gone, no such site), or unchecked (the site blocks checks, or it timed out). */
export async function checkLink(url: string): Promise<LinkState> {
  if (!url) return "broken";
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; RupertLinkCheck/1.0)", accept: "text/html,*/*" },
      cache: "no-store",
    });
    void response.body?.cancel().catch(() => undefined);
    if (response.ok) return "live";
    return BLOCKED.has(response.status) ? "unchecked" : "broken";
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return name === "TimeoutError" || name === "AbortError" ? "unchecked" : "broken";
  }
}

export async function withLinkChecks(items: Competitor[]): Promise<Competitor[]> {
  return Promise.all(
    items.map(async (c) => {
      const [website, news] = await Promise.all([checkLink(c.website), checkLink(c.newsUrl)]);
      return { ...c, links: { website, news } };
    }),
  );
}

/** Runs the search and saves it as the client's new draft landscape. */
export async function findCompetitors(
  supabase: ServiceClient,
  clientId: string,
  actor: string | null,
): Promise<Result<Landscape>> {
  const dry = await confirmedDryList(supabase, clientId);
  if (!dry.ok) return dry;
  if (!dry.value) return { ok: false, error: "Confirm Step 1 (the Dry Match Short List) first." };
  const facts = await companyFacts(supabase, clientId);
  if (!facts.ok) return facts;
  const f = facts.value;

  const brief = [
    `Company: ${f.name} (${f.website})`,
    f.oneLiner && `One-liner: ${f.oneLiner}`,
    f.product && `Product: ${f.product}`,
    f.customers && `Customers: ${f.customers}`,
    f.model && `Business model: ${f.model}`,
    f.sectors.length && `Sectors: ${f.sectors.join(", ")}`,
    f.stage && `Stage: ${f.stage}`,
    f.hq && `Based in: ${f.hq}`,
    f.markets.length && `Sells into: ${f.markets.join(", ")}`,
    f.clientText ? `What the founder said about competitors:\n${f.clientText}` : "The founder named no competitors.",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = await loadPrompt(supabase, "competitor_search", { clientId, purpose: "Step 2: funded competitors" });
  if (!prompt.ok) return prompt;

  let usage: ClaudeUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
  const result = await callClaudeAgent<{ competitors?: unknown[]; unfundedNamed?: unknown[] }>({
    system: promptSystem(
      prompt.value,
      "## The company",
      brief,
      "## Fields for matching",
      `For each competitor also give stage (the stage of its latest round), geography (its HQ country) and primarySector, using these exact labels. Leave a field empty if you can't tell.\nStages: ${f.stageLabels.join(", ")}\nSectors: ${f.sectorLabels.join(", ")}`,
    ),
    content: [{ type: "text", text: `Find the funded direct competitors and deliver them by calling the ${TOOL.name} tool.` }],
    tool: TOOL,
    serverTools: [webSearchTool(15)],
    requireServerTools: true,
    maxTokens: 12_000,
  });
  usage = result.usage;
  if (!result.ok) return { ok: false, error: `The competitor search did not finish: ${result.reason}` };

  // "Client" only when the founder's own words name it.
  const clientWords = f.clientText.toLowerCase();
  const raw = (result.input.competitors ?? []).map((item) => {
    const c = item as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name : "";
    const named = !!name && (clientWords.includes(name.toLowerCase()) || f.clientList.some((n) => sameName(n, name)));
    return { ...c, source: named ? "client" : "web" };
  });
  const sectorSet = new Map(f.sectorLabels.map((l) => [l.toLowerCase(), l]));
  const stageSet = new Map(f.stageLabels.map((l) => [l.toLowerCase(), l]));
  const ordered = orderCompetitors(raw, () => randomUUID())
    .filter((c) => c.newsUrl)
    .map((c) => ({
      ...c,
      primarySector: sectorSet.get(c.primarySector.toLowerCase()) ?? "",
      secondarySectors: [],
      sectorsChecked: false,
      stage: stageSet.get(c.stage.toLowerCase()) ?? c.stage,
    }));
  const checked = await withLinkChecks(ordered);
  const unfunded = (result.input.unfundedNamed ?? [])
    .filter((n): n is string => typeof n === "string" && !!n.trim())
    .map((n) => n.trim().slice(0, 120))
    .filter((n) => !checked.some((c) => sameName(c.name, n)));

  const now = new Date().toISOString();
  const cleared = await supabase
    .from("competitor_landscapes")
    .update({ cleared_at: now, cleared_by: actor })
    .eq("client_id", clientId)
    .is("cleared_at", null);
  if (cleared.error) return { ok: false, error: landscapeTableError(cleared.error.message, cleared.error.code) };
  const { data, error } = await supabase
    .from("competitor_landscapes")
    .insert({
      client_id: clientId,
      dry_match_list_id: dry.value,
      competitors: checked,
      unfunded_named: unfunded,
      client_named: f.clientList,
      usage,
      searched_by: actor,
    })
    .select(COLUMNS)
    .single<Row>();
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

/** Saves the admin's edits to the draft (and checks every link again). Confirm also locks it. */
export async function saveCompetitors(
  supabase: ServiceClient,
  clientId: string,
  items: unknown[],
  confirm: boolean,
  actor: string | null,
): Promise<Result<Landscape>> {
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  if (!current.value) return { ok: false, error: "Run Show Competitors first." };
  if (current.value.status === "confirmed") return { ok: false, error: "This list is confirmed. Start over to change it." };
  const list = orderCompetitors(Array.isArray(items) ? items : [], () => randomUUID());
  if (confirm && list.length === 0) return { ok: false, error: "The list is empty. Add at least one competitor, or Start over." };
  const checked = await withLinkChecks(list);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("competitor_landscapes")
    .update({
      competitors: checked,
      updated_at: now,
      ...(confirm ? { status: "confirmed", confirmed_at: now, confirmed_by: actor } : {}),
    })
    .eq("id", current.value.id)
    .eq("status", "draft")
    .select(COLUMNS)
    .single<Row>();
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

export async function clearLandscape(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<null>> {
  const { error } = await supabase
    .from("competitor_landscapes")
    .update({ cleared_at: new Date().toISOString(), cleared_by: actor })
    .eq("client_id", clientId)
    .is("cleared_at", null);
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: null };
}

// ---------------------------------------------------------------------------
// Primary sectors of the confirmed competitors

async function sectorLabels(supabase: ServiceClient, clientId: string): Promise<Result<string[]>> {
  const facts = await companyFacts(supabase, clientId);
  return facts.ok ? { ok: true, value: facts.value.sectorLabels } : facts;
}

const SECTOR_TOOL = {
  name: "submit_sectors",
  description: "Deliver each competitor's primary sector.",
  input_schema: {
    type: "object",
    properties: {
      sectors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            primarySector: { type: "string" },
            secondarySectors: { type: "array", items: { type: "string" }, maxItems: 2 },
          },
          required: ["id", "primarySector", "secondarySectors"],
        },
      },
    },
    required: ["sectors"],
  },
};

/** Fills the empty primary sectors of the confirmed competitors. Nothing else on the list changes. */
export async function fillSectors(supabase: ServiceClient, clientId: string): Promise<Result<Landscape>> {
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  const land = current.value;
  if (!land) return { ok: false, error: "Run Show Competitors first." };
  const missing = land.competitors.filter((c) => !c.primarySector || !c.sectorsChecked);
  if (missing.length === 0) return { ok: true, value: land };
  const labels = await sectorLabels(supabase, clientId);
  if (!labels.ok) return labels;
  const prompt = await loadPrompt(supabase, "competitor_sector", { clientId, purpose: "Step 2: competitors' primary sector" });
  if (!prompt.ok) return prompt;
  const result = await callClaudeTool<{ sectors?: { id?: string; primarySector?: string; secondarySectors?: unknown }[] }>({
    system: promptSystem(
      prompt.value,
      "## Secondary sectors",
      "Also give up to two secondary sectors, when the company clearly belongs to them too (for example AI/ML for an AI-native fintech). Same labels; none is fine.",
      "## Sector labels",
      labels.value.join(", "),
      "## Competitors (id: name, what it does, why it competes)",
      missing.map((c) => `${c.id}: ${c.name}. ${c.oneLiner} ${c.why}`.trim()).join("\n"),
    ),
    messages: [{ role: "user", content: `Classify each competitor by calling the ${SECTOR_TOOL.name} tool.` }],
    tool: SECTOR_TOOL,
    maxTokens: 2000,
  });
  if (!result.ok) return { ok: false, error: `The sectors were not filled: ${result.reason}` };
  const allowed = new Map(labels.value.map((l) => [l.toLowerCase(), l]));
  const found = new Map(
    (result.input.sectors ?? []).flatMap((x) => {
      if (!x.id) return [];
      const primary = allowed.get(String(x.primarySector ?? "").toLowerCase()) ?? "";
      const secondary = (Array.isArray(x.secondarySectors) ? x.secondarySectors : [])
        .map((v) => allowed.get(String(v).toLowerCase()))
        .filter((v): v is string => !!v);
      return [[x.id, { primary, secondary }] as const];
    }),
  );
  // Only empty fields are filled; a sector already set (by the search or the admin) stays.
  const competitors = land.competitors.map((c) => {
    const f = found.get(c.id);
    if (!f) return c;
    const primary = c.primarySector || f.primary;
    return {
      ...c,
      primarySector: primary,
      secondarySectors: c.secondarySectors.length ? c.secondarySectors : f.secondary.filter((v) => v !== primary).slice(0, 2),
      sectorsChecked: true,
    };
  });
  const { data, error } = await supabase
    .from("competitor_landscapes")
    .update({ competitors, updated_at: new Date().toISOString() })
    .eq("id", land.id)
    .select(COLUMNS)
    .single<Row>();
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

// ---------------------------------------------------------------------------
// Step 2B: investors in the confirmed competitors

const INVESTOR_TOOL = {
  name: "submit_investors",
  description: "Deliver every confirmed investor in this competitor.",
  input_schema: {
    type: "object",
    properties: {
      investors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            website: { type: "string" },
            kind: { type: "string", enum: ["fund", "angel", "corporate", "accelerator", "other"] },
            round: { type: "string" },
            lead: { type: "boolean" },
            sourceUrl: { type: "string" },
          },
          required: ["name", "kind", "round", "lead", "sourceUrl"],
        },
      },
    },
    required: ["investors"],
  },
};

/**
 * Researches one confirmed competitor's investors and merges them into the
 * list. The investors already named in Step 2A are added too, with the
 * funding article as their source. Run once per competitor.
 */
export async function researchInvestors(supabase: ServiceClient, clientId: string, competitorId: string): Promise<Result<Landscape>> {
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  const land = current.value;
  if (!land || land.status !== "confirmed") return { ok: false, error: "Confirm the competitors first." };
  if (land.investorsStatus === "confirmed") return { ok: false, error: "The investor list is confirmed. Start over to research again." };
  const c = land.competitors.find((x) => x.id === competitorId);
  if (!c) return { ok: false, error: "That competitor is not on the confirmed list." };

  const prompt = await loadPrompt(supabase, "competitor_investors", { clientId, purpose: `Step 2: investors in ${c.name}` });
  if (!prompt.ok) return prompt;
  const facts = [
    `Competitor: ${c.name}${c.website ? ` (${c.website})` : ""}`,
    c.oneLiner && `What it does: ${c.oneLiner}`,
    c.hq && `HQ: ${c.hq}`,
    [c.funding.lastRound, c.funding.lastRoundDate].filter(Boolean).length && `Latest round: ${[c.funding.lastRound, c.funding.lastRoundDate].filter(Boolean).join(", ")}`,
    c.funding.totalRaised && `Total raised: ${c.funding.totalRaised}`,
    c.newsUrl && `Funding article: ${c.newsUrl}`,
    c.funding.investors.length ? `Investors already named: ${c.funding.investors.join(", ")}` : "No investors named yet.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await callClaudeAgent<{ investors?: unknown[] }>({
    system: promptSystem(prompt.value, "## The competitor", facts),
    content: [{ type: "text", text: `Find every investor in ${c.name} and deliver them by calling the ${INVESTOR_TOOL.name} tool.` }],
    tool: INVESTOR_TOOL,
    serverTools: [webSearchTool(10)],
    requireServerTools: true,
    maxTokens: 10_000,
  });

  const now = new Date().toISOString();
  let list = land.investors;
  // Step 2A already named these, from the competitor's funding article.
  for (const name of c.funding.investors) {
    const seed = cleanInvestor(
      { name, kind: "fund", source: "step2a", backed: [{ competitorId: c.id, competitor: c.name, round: c.funding.lastRound, lead: false, sourceUrl: c.newsUrl }] },
      randomUUID(),
    );
    if (seed) list = mergeInvestor(list, seed);
  }
  let state: ResearchState;
  if (result.ok) {
    let found = 0;
    for (const raw of result.input.investors ?? []) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const inv = cleanInvestor(
        {
          name: r.name,
          website: r.website,
          kind: r.kind,
          source: "research",
          backed: [{ competitorId: c.id, competitor: c.name, round: r.round, lead: r.lead === true, sourceUrl: r.sourceUrl }],
        },
        randomUUID(),
      );
      // A source link is required: no link, no investor.
      if (!inv || !inv.backed[0]?.sourceUrl) continue;
      list = mergeInvestor(list, inv);
      found += 1;
    }
    state = { status: "done", at: now, found };
  } else {
    state = { status: "failed", at: now, found: 0, error: result.reason.slice(0, 300) };
  }

  // Read again just before writing, so two runs never overwrite each other's findings.
  const fresh = await currentLandscape(supabase, clientId);
  if (!fresh.ok) return fresh;
  if (!fresh.value || fresh.value.id !== land.id) return { ok: false, error: "The competitor list changed. Reload the page." };
  let merged = fresh.value.investors;
  for (const inv of list) merged = mergeInvestor(merged, inv);
  const { data, error } = await supabase
    .from("competitor_landscapes")
    .update({
      investors: orderInvestors(merged),
      investor_research: { ...fresh.value.research, [c.id]: state },
      investors_status: "draft",
      updated_at: now,
    })
    .eq("id", land.id)
    .neq("investors_status", "confirmed")
    .select(COLUMNS)
    .single<Row>();
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

/** Saves the admin's edits to the investor list; with confirm, locks it. */
export async function saveInvestors(
  supabase: ServiceClient,
  clientId: string,
  items: unknown[],
  confirm: boolean,
  actor: string | null,
): Promise<Result<Landscape>> {
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  const land = current.value;
  if (!land || land.investorsStatus === "none") return { ok: false, error: "Run Find Investors first." };
  if (land.investorsStatus === "confirmed") return { ok: false, error: "The investor list is confirmed. Start over to change it." };
  const list = cleanInvestorList(Array.isArray(items) ? items : [], () => randomUUID());
  if (confirm && list.length === 0) return { ok: false, error: "The list is empty." };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("competitor_landscapes")
    .update({
      investors: list,
      updated_at: now,
      ...(confirm ? { investors_status: "confirmed", investors_confirmed_at: now, investors_confirmed_by: actor } : {}),
    })
    .eq("id", land.id)
    .eq("investors_status", "draft")
    .select(COLUMNS)
    .single<Row>();
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

/** Start over for Step 2B only: the confirmed competitors stay. */
export async function clearInvestors(supabase: ServiceClient, clientId: string): Promise<Result<Landscape>> {
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  if (!current.value) return { ok: false, error: "Nothing to start over." };
  const { data, error } = await supabase
    .from("competitor_landscapes")
    .update({
      investors: [],
      investor_research: {},
      investors_status: "none",
      investors_confirmed_at: null,
      investors_confirmed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.value.id)
    .select(COLUMNS)
    .single<Row>();
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: fromRow(data) };
}

// ---------------------------------------------------------------------------
// Step 2C: the confirmed investors against the Fund Database and the shortlist

export type CheckResult = {
  rows: CheckRow[];
  /** Whether Find websites can run (its column exists). */
  websitesReady: boolean;
  clientSectors: string[];
  /** Investments of this landscape already recorded in the database (null: the table isn't there yet). */
  recorded: number | null;
  counts: Record<Bucket, number>;
  dryListId: string;
  dryConfirmedAt: string;
  fundDbVersion: string;
};

async function loadDecisions(supabase: ServiceClient, landscapeId: string): Promise<Result<Record<string, InvestorDecision>>> {
  const { data, error } = await supabase
    .from("competitor_landscapes")
    .select("investor_decisions")
    .eq("id", landscapeId)
    .maybeSingle<{ investor_decisions: Record<string, InvestorDecision> | null }>();
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: data?.investor_decisions ?? {} };
}

export const WEBSITES_MIGRATION = "The suggested-websites column is missing. Run portal/supabase/investor_websites.sql in the Supabase SQL editor.";

/** Find websites' suggestions; empty (not an error) before the migration, so the check still runs. */
async function loadSuggestions(supabase: ServiceClient, landscapeId: string): Promise<{ value: Record<string, WebsiteSuggestion>; missing: boolean }> {
  const { data, error } = await supabase
    .from("competitor_landscapes")
    .select("website_suggestions")
    .eq("id", landscapeId)
    .maybeSingle<{ website_suggestions: Record<string, WebsiteSuggestion> | null }>();
  if (error) return { value: {}, missing: true };
  return { value: data?.website_suggestions ?? {}, missing: false };
}

/** Checks every confirmed investor against the live Fund Database and the confirmed Step 1 list. Reads only. */
export async function checkAgainstDatabase(supabase: ServiceClient, clientId: string): Promise<Result<CheckResult>> {
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  const land = current.value;
  if (!land || land.investorsStatus !== "confirmed") return { ok: false, error: "Confirm the investor list first." };
  const { data: dry, error: dryError } = await supabase
    .from("dry_match_lists")
    .select("id, steps, fund_ids, confirmed_at")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; steps: { step: DryStep; chosen: string[] }[]; fund_ids: string[]; confirmed_at: string }>();
  if (dryError) return { ok: false, error: dryError.message };
  if (!dry) return { ok: false, error: "Confirm Step 1 first." };
  const snapshot = await matchDataSnapshot(supabase, clientId);
  if (!snapshot.ok) return snapshot;
  const { db, index, common, profileInputs } = snapshot.value;
  const data = buildDryData(db, index, { financing: [], stage: null, hqCountry: null, primarySector: null });
  type Named = { label?: string | null } | null | undefined;
  const clientSectors = [profileInputs.primarySector as Named, ...((profileInputs.secondarySectors as Named[]) ?? [])]
    .map((x) => x?.label ?? "")
    .filter(Boolean);
  const competitorSectors = Object.fromEntries(land.competitors.map((c) => [c.id, [c.primarySector, ...c.secondarySectors].filter(Boolean)]));
  const decisions = await loadDecisions(supabase, land.id);
  if (!decisions.ok) return decisions;
  const suggestions = await loadSuggestions(supabase, land.id);
  const rows = checkInvestors({
    suggestions: suggestions.value,
    investors: land.investors,
    firms: db.firms.map((f) => ({ id: f.id, name: f.name, web: f.web })),
    data,
    steps: dry.steps.map((s) => ({ step: s.step, chosen: s.chosen })),
    shortlist: new Set(dry.fund_ids),
    decisions: decisions.value,
    clientSectors,
    competitorSectors,
  });
  const counts = { confirm: 0, in_list: 0, not_in_list: 0, missing_fund: 0, missing_angel: 0 } as Record<Bucket, number>;
  rows.forEach((r) => (counts[r.bucket] += 1));
  return {
    ok: true,
    value: { rows, websitesReady: !suggestions.missing, counts, clientSectors, recorded: await recordedCount(supabase, land.id), dryListId: dry.id, dryConfirmedAt: dry.confirmed_at, fundDbVersion: String(common.fund_db_version ?? "") },
  };
}

/** Records the admin's decision on one investor: the record it is, bring back or leave out, and a note. */
export async function decideInvestor(
  supabase: ServiceClient,
  clientId: string,
  investorId: string,
  patch: { firmId?: string | null; action?: "bring_back" | "leave_out" | null; note?: string; lesson?: boolean; website?: string; resetMatch?: boolean; clear?: boolean },
  actor: string | null,
): Promise<Result<null>> {
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  const land = current.value;
  if (!land || land.investorsStatus !== "confirmed") return { ok: false, error: "Confirm the investor list first." };
  if (!land.investors.some((i) => i.id === investorId)) return { ok: false, error: "That investor is not on the confirmed list." };
  const decisions = await loadDecisions(supabase, land.id);
  if (!decisions.ok) return decisions;
  const previous = decisions.value[investorId];
  // Undo: the investor goes back to its automatic match, as if never decided.
  if (patch.clear) {
    const rest = { ...decisions.value };
    delete rest[investorId];
    const { error } = await supabase
      .from("competitor_landscapes")
      .update({ investor_decisions: rest, updated_at: new Date().toISOString() })
      .eq("id", land.id);
    return error ? { ok: false, error: landscapeTableError(error.message, error.code) } : { ok: true, value: null };
  }
  const next: InvestorDecision = { ...(previous ?? {}), by: actor, at: new Date().toISOString() };
  if (patch.firmId !== undefined) {
    next.firmId = patch.firmId;
    // A different record means a different reason: the earlier choice no longer applies.
    if (previous?.firmId !== patch.firmId) delete next.action;
  }
  if (patch.action !== undefined) {
    if (patch.action === null) delete next.action;
    else next.action = patch.action;
  }
  if (patch.website !== undefined) {
    const url = cleanUrl(patch.website);
    if (patch.website.trim() && !url) return { ok: false, error: "That is not a website address." };
    if (url) next.website = url;
    else delete next.website;
  }
  // Match again automatically (e.g. by the new website): the earlier record choice and decision go.
  if (patch.resetMatch) {
    delete next.firmId;
    delete next.action;
  }
  if (patch.note !== undefined) next.note = patch.note.trim().slice(0, 1000);
  if (patch.lesson !== undefined) next.lesson = patch.lesson === true;
  const { error } = await supabase
    .from("competitor_landscapes")
    .update({ investor_decisions: { ...decisions.value, [investorId]: next }, updated_at: next.at })
    .eq("id", land.id);
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: null };
}

/** Sets the same action on many investors at once (the summary table's "apply to all"). */
export async function decideMany(
  supabase: ServiceClient,
  clientId: string,
  investorIds: string[],
  action: "bring_back" | "leave_out" | null,
  actor: string | null,
): Promise<Result<number>> {
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  const land = current.value;
  if (!land || land.investorsStatus !== "confirmed") return { ok: false, error: "Confirm the investor list first." };
  const known = new Set(land.investors.map((i) => i.id));
  const ids = investorIds.filter((id) => known.has(id));
  const decisions = await loadDecisions(supabase, land.id);
  if (!decisions.ok) return decisions;
  const at = new Date().toISOString();
  const next = { ...decisions.value };
  for (const id of ids) {
    const d: InvestorDecision = { ...(next[id] ?? {}), by: actor, at };
    if (action) d.action = action;
    else delete d.action;
    next[id] = d;
  }
  const { error } = await supabase.from("competitor_landscapes").update({ investor_decisions: next, updated_at: at }).eq("id", land.id);
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: ids.length };
}

export const INVESTMENTS_MIGRATION = "The investments table is missing. Run portal/supabase/fund_investments.sql in the Supabase SQL editor.";

/**
 * Records, company-wide, each matched investor's investment in each
 * competitor: the fund, the company, its sectors, the round, whether it led,
 * and the source. A fact about the fund's portfolio, never a change to its
 * sectors. Recording again updates the same rows.
 */
export async function recordInvestments(supabase: ServiceClient, clientId: string, actor: string | null): Promise<Result<number>> {
  const check = await checkAgainstDatabase(supabase, clientId);
  if (!check.ok) return check;
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  const land = current.value!;
  const byId = new Map(land.competitors.map((c) => [c.id, c]));
  const rows = check.value.rows
    .filter((r) => r.firmId && (r.bucket === "in_list" || r.bucket === "not_in_list"))
    .flatMap((r) =>
      r.investor.backed.map((b) => {
        const c = byId.get(b.competitorId);
        return {
          firm_id: r.firmId!,
          investor_name: r.investor.name,
          company: b.competitor,
          company_website: c?.website ?? "",
          company_sectors: c ? [c.primarySector, ...c.secondarySectors].filter(Boolean) : [],
          round: b.round ?? "",
          lead: b.lead,
          source_url: b.sourceUrl ?? "",
          found_for_client: clientId,
          landscape_id: land.id,
          recorded_by: actor,
          recorded_at: new Date().toISOString(),
        };
      }),
    );
  if (!rows.length) return { ok: true, value: 0 };
  // One row per fund, company and round.
  const unique = Array.from(new Map(rows.map((r) => [`${r.firm_id}|${r.company.toLowerCase()}|${r.round.toLowerCase()}`, r])).values());
  const { error } = await supabase.from("fund_investments").upsert(unique, { onConflict: "firm_id,company_key,round_key", ignoreDuplicates: false });
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205" || /fund_investments/.test(error.message);
    return { ok: false, error: missing ? INVESTMENTS_MIGRATION : error.message };
  }
  return { ok: true, value: unique.length };
}

/** How many of this landscape's investments are already recorded. */
export async function recordedCount(supabase: ServiceClient, landscapeId: string): Promise<number | null> {
  const { count, error } = await supabase.from("fund_investments").select("id", { count: "exact", head: true }).eq("landscape_id", landscapeId);
  return error ? null : count ?? 0;
}

// ---------------------------------------------------------------------------
// Find websites: the official website of unclear and missing investors

/** Investors per Find websites request: small enough to finish in one call. */
export const WEBSITE_BATCH = 4;

const WEBSITE_TOOL = {
  name: "submit_websites",
  description: "Deliver each investor's official website.",
  input_schema: {
    type: "object",
    properties: {
      investors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            website: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            foundIn: { type: "string" },
            portfolioUrl: { type: "string" },
            note: { type: "string", description: "One short sentence: how you know it is this investor." },
          },
          required: ["id", "website", "confidence", "foundIn", "portfolioUrl", "note"],
        },
      },
    },
    required: ["investors"],
  },
};

/** Finds the official website of a few investors (at most WEBSITE_BATCH) and saves the suggestions. */
export async function findWebsites(supabase: ServiceClient, clientId: string, investorIds: string[]): Promise<Result<number>> {
  const current = await currentLandscape(supabase, clientId);
  if (!current.ok) return current;
  const land = current.value;
  if (!land || land.investorsStatus !== "confirmed") return { ok: false, error: "Confirm the investor list first." };
  const targets = land.investors.filter((i) => investorIds.includes(i.id)).slice(0, WEBSITE_BATCH);
  if (!targets.length) return { ok: true, value: 0 };
  const prompt = await loadPrompt(supabase, "investor_website", { clientId, purpose: "Step 2: investors' websites" });
  if (!prompt.ok) return prompt;
  const list = targets
    .map((i) => {
      const b = i.backed[0];
      return [
        `id: ${i.id}`,
        `name: ${i.name}`,
        `kind: ${i.kind}`,
        `invested in: ${Array.from(new Set(i.backed.map((x) => x.competitor))).join(", ")}${b?.round ? ` (${b.round})` : ""}`,
        `source article: ${i.backed.map((x) => x.sourceUrl).filter(Boolean)[0] ?? "none"}`,
        i.website ? `website found earlier (check it): ${i.website}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const result = await callClaudeAgent<{ investors?: Record<string, unknown>[] }>({
    system: promptSystem(prompt.value, "## The investors", list),
    content: [{ type: "text", text: `Find each investor's website and deliver them by calling the ${WEBSITE_TOOL.name} tool.` }],
    tool: WEBSITE_TOOL,
    serverTools: [webSearchTool(4 * targets.length)],
    requireServerTools: true,
    maxTokens: 6000,
  });
  if (!result.ok) return { ok: false, error: `Find websites did not finish: ${result.reason}` };
  const now = new Date().toISOString();
  const found: Record<string, WebsiteSuggestion> = {};
  await Promise.all(
    (result.input.investors ?? []).map(async (raw) => {
      const id = typeof raw.id === "string" ? raw.id : "";
      if (!targets.some((t) => t.id === id)) return;
      const website = cleanUrl(raw.website);
      const confidence = raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low";
      found[id] = {
        website,
        confidence: website ? confidence : "low",
        foundIn: cleanUrl(raw.foundIn),
        portfolioUrl: cleanUrl(raw.portfolioUrl),
        note: typeof raw.note === "string" ? raw.note.trim().slice(0, 300) : "",
        link: website ? await checkLink(website) : "broken",
        at: now,
      };
    }),
  );
  // Investors the answer skipped are recorded as "not found", so they aren't asked again blindly.
  for (const t of targets) {
    if (!found[t.id]) found[t.id] = { website: "", confidence: "low", foundIn: "", portfolioUrl: "", note: "Not found.", link: "broken", at: now };
  }
  const existing = await loadSuggestions(supabase, land.id);
  if (existing.missing) return { ok: false, error: WEBSITES_MIGRATION };
  const { error } = await supabase
    .from("competitor_landscapes")
    .update({ website_suggestions: { ...existing.value, ...found }, updated_at: now })
    .eq("id", land.id);
  if (error) return { ok: false, error: landscapeTableError(error.message, error.code) };
  return { ok: true, value: Object.values(found).filter((f) => f.website).length };
}
