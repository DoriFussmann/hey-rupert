import "server-only";
import { callClaudeTool } from "@/lib/anthropic";
import { MAX_SECONDARY, SECTOR_KINDS, choosable } from "@/lib/company-profile/core";
import { loadCompanyProfile } from "@/lib/company-profile/server";
import { loadInterview } from "@/lib/intake-server";
import { loadProfileState } from "@/lib/match/profile-server";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  THIN_THRESHOLDS_SLUG,
  parseThresholds,
  type Limit,
  type ThinThresholds,
  type TierTally,
} from "@/lib/match/tiers/thin";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** The thin-match thresholds (one setting for every client), or the defaults. */
export async function loadThinThresholds(supabase: ServiceClient): Promise<ThinThresholds> {
  const { data } = await supabase.from("form_templates").select("content").eq("slug", THIN_THRESHOLDS_SLUG).maybeSingle();
  return parseThresholds(data?.content ?? null);
}

export async function saveThinThresholds(supabase: ServiceClient, thresholds: ThinThresholds): Promise<Result<ThinThresholds>> {
  const { error } = await supabase.from("form_templates").upsert({
    slug: THIN_THRESHOLDS_SLUG,
    title: "Thin match thresholds",
    content: JSON.stringify(thresholds),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: thresholds };
}

export type SectorSetup = { primary: string; secondary: string[]; rationale: string };

const OPTIONS_TOOL = {
  name: "propose_setups",
  description: "Propose other sector setups for the company, using only the sector ids given.",
  input_schema: {
    type: "object",
    properties: {
      setups: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            primary: { type: "string", description: "A sector id from the list." },
            secondary: { type: "array", maxItems: MAX_SECONDARY, items: { type: "string" }, description: "Up to two sector ids from the list." },
            rationale: { type: "string", description: "One or two plain sentences." },
          },
          required: ["primary", "secondary", "rationale"],
        },
      },
    },
    required: ["setups"],
  },
};

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

/**
 * Asks the AI for other sector setups that honestly describe the company.
 * Only ids of choosable sectors are kept; the counts come from the engine.
 */
export async function suggestSectorSetups(
  supabase: ServiceClient,
  clientId: string,
  context: { tally: TierTally; limits: Limit[]; thresholds: ThinThresholds },
): Promise<Result<SectorSetup[]>> {
  const [client, interview, state] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
    loadInterview(supabase, clientId),
    loadProfileState(supabase, clientId),
  ]);
  if (client.error) return { ok: false, error: client.error.message };
  if (!client.data) return { ok: false, error: "Client not found." };
  if (!state.ok) return state;
  if (!state.value) return { ok: false, error: "Fill the company profile first." };
  const loaded = await loadCompanyProfile(supabase, clientId, state.value);
  if (!loaded.ok) return loaded;
  const { profile, index } = loaded.value;

  const prompt = await loadPrompt(supabase, "match_options", { clientId, purpose: "Thin match: sector options" });
  if (!prompt.ok) return prompt;

  const sectors = choosable(index, "sector", SECTOR_KINDS);
  const allowed = new Set(sectors.map((node) => node.id));
  const label = (id: string) => index.nodes.get(id)?.label ?? id;
  const row = client.data as Record<string, unknown>;
  const brief = interview.ok ? interview.interview?.admin_brief : null;
  const current = profile.sectors.map((sector) => `${sector.role}: ${label(sector.nodeId)} [${sector.nodeId}]`);
  const facts = [
    `Company: ${text(row.company_name)}`,
    text(row.company_description) ? `Description: ${text(row.company_description)}` : "",
    text(state.value.answers.one_liner) ? `One-liner: ${text(state.value.answers.one_liner)}` : "",
    profile.stage ? `Stage: ${label(profile.stage.nodeId)}` : "",
    brief?.summary ? `Intake brief:\n${brief.summary}` : "",
  ].filter(Boolean);
  const run = [
    `Funds per tier now: Core ${context.tally.core}, Sphere ${context.tally.sphere}, Tier 3 ${context.tally.tier3}, Tier 4 ${context.tally.tier4} (total ${context.tally.total}).`,
    `Wanted: at least ${context.thresholds.minCore} in Core and ${context.thresholds.minTotal} in all tiers.`,
    context.limits.length > 0
      ? `Why funds left the match (most common):\n${context.limits.map((limit) => `- ${limit.label}: ${limit.count}`).join("\n")}`
      : "",
  ].filter(Boolean);

  const result = await callClaudeTool<{ setups?: unknown }>({
    system: promptSystem(
      prompt.value,
      "## The company",
      facts.join("\n\n"),
      "## Current sector setup",
      current.length > 0 ? current.join("\n") : "None.",
      "## The match now",
      run.join("\n\n"),
      "## Sector categories you may use (id: label)",
      sectors.map((node) => `${node.id}: ${node.label}`).join("\n"),
    ),
    messages: [{ role: "user", content: `Propose the setups by calling the ${OPTIONS_TOOL.name} tool.` }],
    tool: OPTIONS_TOOL,
    maxTokens: 2000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const raw = Array.isArray(result.input.setups) ? result.input.setups : [];
  const setups: SectorSetup[] = [];
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const primary = text(entry.primary);
    if (!allowed.has(primary)) continue;
    const secondary = (Array.isArray(entry.secondary) ? entry.secondary : [])
      .map(text)
      .filter((id) => allowed.has(id) && id !== primary)
      .filter((id, i, all) => all.indexOf(id) === i)
      .slice(0, MAX_SECONDARY);
    setups.push({ primary, secondary, rationale: text(entry.rationale).slice(0, 600) });
  }
  return { ok: true, value: setups };
}
