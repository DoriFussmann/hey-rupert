import "server-only";
import { callClaudeAgent, callClaudeTool, isClaudeConfigured, webSearchTool, type ClaudeTool } from "@/lib/anthropic";
import { DRY_STEPS, DRY_STEP_LABEL, allFunds, buildDryData, expandStage, passes, type DryData, type DryStep } from "@/lib/match/dry/core";
import { loadLiveDb } from "@/lib/match/db-server";
import { applyProven, loadProven } from "@/lib/match/proven/server";
import type { FundDb } from "@/lib/match/engine/index.mjs";
import { loadPrompt } from "@/lib/prompts-server";
import { promptSystem } from "@/lib/prompts";
import type { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { answerText, cleanBrief, exampleFunds, filtersLine, firstName, type FitOptions, type MatchEstimate, type ProspectBrief } from "@/lib/prospects/core";
import { PROSPECT_COLUMNS, getProspectRow, loadProspect, now, type CallRow, type ProspectRow } from "@/lib/prospects/data-server";

// The AI side of prospects: the prep brief (with the Dry Match estimate it
// feeds) and the follow-up draft. Writes drafts only; nothing here sends.

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const BRIEF_MAX_SEARCHES = 5;
const BRIEF_TIMEOUT_MS = 150_000;

// ---------------------------------------------------------------------------
// Dry Match data, without a client

async function dryDataForProspects(supabase: ServiceClient): Promise<Result<{ data: DryData; db: FundDb; version: string }>> {
  const [live, tax] = await Promise.all([loadLiveDb(supabase), loadTaxonomy(supabase)]);
  if (!live.ok) return { ok: false, error: live.error };
  if (!tax.ok) return { ok: false, error: tax.error };
  // What recorded investments prove joins the provider records, as in a client's run.
  const db = applyProven(live.value.db, tax.value, await loadProven(supabase)).db;
  const data = buildDryData(db, tax.value, { financing: [], stage: null, hqCountry: null, primarySector: null });
  return { ok: true, data, db, version: live.value.version.id };
}

function fitOptions(data: DryData): FitOptions {
  return {
    financing: data.options.financing,
    stage: data.options.stage,
    geography: data.options.geography,
    sector: data.options.sector,
  };
}

/** The estimate: every step the brief chose, applied in order; a step without a choice stays open. */
export function estimateFrom(data: DryData, db: FundDb, version: string, fit: ProspectBrief["fit"]): MatchEstimate {
  const chosen: Record<DryStep, string[]> = {
    financing: fit.financing.length ? fit.financing : ["financing.equity"],
    stage: fit.stage,
    geography: fit.geography,
    sector: fit.sector,
  };
  let left = data.funds;
  const steps: MatchEstimate["steps"] = [];
  const open: string[] = [];
  for (const step of DRY_STEPS) {
    const ids = chosen[step].filter((id) => data.options[step].some((o) => o.id === id));
    if (!ids.length) {
      open.push(DRY_STEP_LABEL[step]);
      continue;
    }
    left = left.filter((fund) => passes(data, fund, step, ids));
    const shown = step === "stage" ? expandStage(ids) : ids;
    steps.push({ step, label: DRY_STEP_LABEL[step], chosen: data.options[step].filter((o) => shown.includes(o.id)).map((o) => o.label), left: left.length });
  }
  const firms = new Map(db.firms.map((f) => [f.id, f]));
  const examples = exampleFunds(
    left.map((fund) => {
      const firm = firms.get(fund.id);
      return {
        name: fund.name,
        generalist: fund.generalist,
        groups: fund.group.length,
        stages: fund.stage.length,
        type: firm?.type ?? "",
        place: [firm?.city, firm?.country].filter(Boolean).join(", "),
        website: firm?.web ? (/^https?:\/\//i.test(firm.web) ? firm.web : `https://${firm.web}`) : "",
        contacts: firm?.nContacts ?? 0,
      };
    }),
  );
  return { total: allFunds(data), steps, count: left.length, examples, open, fundDbVersion: version, at: now() };
}

// ---------------------------------------------------------------------------
// The brief

const BRIEF_TOOL: ClaudeTool = {
  name: "save_prospect_brief",
  description: "Save the prep brief for the call.",
  input_schema: {
    type: "object",
    properties: {
      person: {
        type: "object",
        properties: { summary: { type: "string" }, facts: { type: "array", items: { type: "string" }, maxItems: 3 } },
        required: ["summary"],
      },
      company: {
        type: "object",
        properties: {
          one_liner: { type: "string" },
          what: { type: "string", description: "What it sells and to whom." },
          hq_country: { type: "string" },
          founded: { type: "string" },
          website: { type: "string" },
          rounds: {
            type: "array",
            items: {
              type: "object",
              properties: { round: { type: "string" }, amount: { type: "string" }, date: { type: "string" }, investors: { type: "string" } },
            },
          },
        },
        required: ["one_liner"],
      },
      raise: { type: "object", properties: { stage: { type: "string" }, amount: { type: "string" } } },
      signals: { type: "array", items: { type: "string" }, maxItems: 4 },
      fit: {
        type: "object",
        description: "Option ids from the lists given, nothing else.",
        properties: {
          financing: { type: "array", items: { type: "string" } },
          stage: { type: "array", items: { type: "string" } },
          geography: { type: "array", items: { type: "string" } },
          sector: { type: "array", items: { type: "string" }, maxItems: 2 },
          note: { type: "string", description: "One line on how sure the fit is." },
        },
        required: ["financing", "stage", "geography", "sector"],
      },
      questions: { type: "array", items: { type: "string" }, maxItems: 3 },
      watch_outs: { type: "array", items: { type: "string" }, maxItems: 3 },
      sources: {
        type: "array",
        items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } }, required: ["url"] },
      },
    },
    required: ["person", "company", "fit", "questions"],
  },
};

function bookingFacts(prospect: ProspectRow, call: CallRow | null) {
  const answers = Object.entries(call?.responses ?? {})
    .filter(([name]) => !["guests", "location", "title", "rescheduleReason"].includes(name))
    .map(([, a]) => [a.label, answerText(a.value)] as const)
    .filter(([, v]) => v);
  return [
    "## What the founder typed when booking",
    `Name: ${prospect.name ?? ""}`,
    `Email: ${prospect.email}`,
    prospect.company_name ? `Company: ${prospect.company_name}` : "",
    prospect.website ? `Website (from their email domain): ${prospect.website}` : "Website: not known (personal email address)",
    ...answers.map(([label, value]) => `${label}: ${value}`),
    call?.event_title ? `Call booked: ${call.event_title}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function optionsText(options: FitOptions) {
  const block = (title: string, list: { id: string; label: string }[]) => `${title}:\n${list.map((o) => `- ${o.id}: ${o.label}`).join("\n")}`;
  return [
    "## Labels for the fit (use the ids)",
    block("Financing type", options.financing),
    block("Stage (Pre-Seed and Seed count as one)", options.stage),
    block("Geography (where the company is based; a fund passes when it invests there)", options.geography),
    block("Sector group", options.sector),
  ].join("\n\n");
}

/** Writes the brief and the estimate for a prospect. Never throws; failures are saved on the prospect. */
export async function buildBriefAndEstimate(supabase: ServiceClient, prospectId: string, actor: string | null = null): Promise<Result<{ prospect: ProspectRow }>> {
  const loaded = await loadProspect(supabase, prospectId);
  if (!loaded.ok) return loaded;
  const { prospect, calls } = loaded;
  const call = calls.find((c) => c.status !== "RESCHEDULED") ?? calls[0] ?? null;

  const fail = async (message: string) => {
    await supabase.from("prospects").update({ brief_status: "failed", brief_error: message.slice(0, 500), updated_at: now() }).eq("id", prospectId);
    return { ok: false as const, error: message };
  };
  if (!isClaudeConfigured()) return fail("ANTHROPIC_API_KEY is not configured.");

  await supabase.from("prospects").update({ brief_status: "running", brief_error: null, updated_at: now() }).eq("id", prospectId);
  try {
    const dry = await dryDataForProspects(supabase);
    if (!dry.ok) return fail(`The fund data did not load: ${dry.error}`);
    const options = fitOptions(dry.data);

    const prompt = await loadPrompt(supabase, "prospect_brief", { purpose: `Prospect brief: ${prospect.name ?? prospect.email}`, actor });
    if (!prompt.ok) return fail(prompt.error);
    const result = await callClaudeAgent<Record<string, unknown>>({
      system: promptSystem(prompt.value),
      content: [{ type: "text", text: `${bookingFacts(prospect, call)}\n\n${optionsText(options)}\n\nResearch, then call ${BRIEF_TOOL.name}.` }],
      tool: BRIEF_TOOL,
      serverTools: [webSearchTool(BRIEF_MAX_SEARCHES)],
      maxTokens: 4000,
      timeoutMs: BRIEF_TIMEOUT_MS,
    });
    if (!result.ok) return fail(result.reason);
    const brief = cleanBrief(result.input, options);
    const match = estimateFrom(dry.data, dry.db, dry.version, brief.fit);
    const patch: Record<string, unknown> = {
      brief,
      brief_status: "ready",
      brief_error: null,
      brief_at: now(),
      match,
      match_at: match.at,
      updated_at: now(),
    };
    if (!prospect.website && /^https?:\/\//i.test(brief.company.website)) patch.website = brief.company.website;
    const { data, error } = await supabase.from("prospects").update(patch).eq("id", prospectId).select(PROSPECT_COLUMNS).single<ProspectRow>();
    if (error) return fail(error.message);
    return { ok: true, prospect: data };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The brief failed.");
  }
}

/** Recomputes the estimate from the brief's fit, or from filters chosen on the page. */
export async function recomputeEstimate(supabase: ServiceClient, prospectId: string, fit?: ProspectBrief["fit"]): Promise<Result<{ match: MatchEstimate }>> {
  const p = await getProspectRow(supabase, prospectId);
  if (!p.ok) return p;
  const dry = await dryDataForProspects(supabase);
  if (!dry.ok) return dry;
  const options = fitOptions(dry.data);
  const base = fit ?? p.prospect.brief?.fit ?? { financing: [], stage: [], geography: [], sector: [], note: "" };
  const clean = cleanBrief({ fit: base }, options).fit;
  const match = estimateFrom(dry.data, dry.db, dry.version, clean);
  const patch: Record<string, unknown> = { match, match_at: match.at, updated_at: now() };
  if (fit && p.prospect.brief) patch.brief = { ...p.prospect.brief, fit: { ...clean, note: p.prospect.brief.fit.note } };
  const { error } = await supabase.from("prospects").update(patch).eq("id", prospectId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, match };
}

/** The options for the filter pickers on the prospect page. */
export async function estimateOptions(supabase: ServiceClient): Promise<Result<{ options: FitOptions }>> {
  const dry = await dryDataForProspects(supabase);
  if (!dry.ok) return dry;
  return { ok: true, options: fitOptions(dry.data) };
}


// ---------------------------------------------------------------------------
// The follow-up draft

const FOLLOW_UP_TOOL: ClaudeTool = {
  name: "save_follow_up_email",
  description: "Save the follow-up email draft.",
  input_schema: {
    type: "object",
    properties: { subject: { type: "string" }, body: { type: "string" } },
    required: ["subject", "body"],
  },
};

export async function draftFollowUp(supabase: ServiceClient, prospectId: string, actor: string | null): Promise<Result<{ subject: string; body: string }>> {
  const p = await getProspectRow(supabase, prospectId);
  if (!p.ok) return p;
  const prospect = p.prospect;
  if (!prospect.outcome_notes?.trim()) return { ok: false, error: "Save your call notes first: the email is written from them." };
  const prompt = await loadPrompt(supabase, "prospect_follow_up", { purpose: `Prospect follow-up: ${prospect.name ?? prospect.email}`, actor });
  if (!prompt.ok) return { ok: false, error: prompt.error };
  const b = prospect.brief;
  const m = prospect.match;
  const facts = [
    "## The founder",
    `Name: ${prospect.name ?? ""} (first name: ${firstName(prospect.name)})`,
    prospect.company_name ? `Company: ${prospect.company_name}` : "",
    "## Outcome",
    prospect.status,
    "## Dori's call notes",
    prospect.outcome_notes,
    b ? `## Brief\n${[b.company.oneLiner, b.company.what].filter(Boolean).join(" ")}\nRaising: ${[b.raise.stage, b.raise.amount].filter(Boolean).join(", ") || "not known"}` : "",
    m ? `## Estimate\nAbout ${m.count} funds of ${m.total} fit: ${filtersLine(m)}\nExample funds: ${m.examples.map((f) => f.name).join(", ") || "none"}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const result = await callClaudeTool<{ subject?: unknown; body?: unknown }>({
    system: promptSystem(prompt.value),
    messages: [{ role: "user", content: `${facts}\n\nWrite the email, then call ${FOLLOW_UP_TOOL.name}.` }],
    tool: FOLLOW_UP_TOOL,
    maxTokens: 1200,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const subject = typeof result.input.subject === "string" ? result.input.subject.trim().slice(0, 200) : "";
  const body = typeof result.input.body === "string" ? result.input.body.trim() : "";
  if (!subject || !body) return { ok: false, error: "The draft came back empty. Try again." };
  await supabase.from("prospects").update({ follow_up: { subject, body, draftedAt: now() }, updated_at: now() }).eq("id", prospectId);
  return { ok: true, subject, body };
}

