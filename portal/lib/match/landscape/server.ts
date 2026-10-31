import "server-only";
import { randomUUID } from "node:crypto";
import { callClaudeAgent, webSearchTool, type ClaudeUsage } from "@/lib/anthropic";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import { loadCompanyProfile } from "@/lib/company-profile/server";
import { loadProfileState } from "@/lib/match/profile-server";
import type { createServiceClient } from "@/lib/supabase/admin";
import { MAX_COMPETITORS, orderCompetitors, sameName, type Competitor, type LinkState } from "./core.ts";

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
};

const COLUMNS = "id, status, competitors, unfunded_named, client_named, searched_at, searched_by, confirmed_at, confirmed_by";

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
};

async function companyFacts(supabase: ServiceClient, clientId: string): Promise<Result<CompanyFacts>> {
  const state = await loadProfileState(supabase, clientId);
  if (!state.ok) return { ok: false, error: state.error };
  if (!state.value) return { ok: false, error: "This client has no company profile yet." };
  const loaded = await loadCompanyProfile(supabase, clientId, state.value);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const p = loaded.value.profile;
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
          required: ["name", "website", "source", "why", "funding", "newsUrl"],
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
    system: promptSystem(prompt.value, "## The company", brief),
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
  const ordered = orderCompetitors(raw, () => randomUUID()).filter((c) => c.newsUrl);
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
