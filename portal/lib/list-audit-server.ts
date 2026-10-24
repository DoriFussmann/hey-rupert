import "server-only";
import { callClaudeAgent, webFetchTool, type ClaudeTool } from "@/lib/anthropic";
import { answerList } from "@/lib/company-profile/core";
import { buildClientContext, loadInterview } from "@/lib/intake-server";
import {
  asListAudit,
  type AuditFund,
  type AuditSampleFund,
  type AuditSummary,
  type ListAudit,
  asAuditSummary,
  readBatch,
} from "@/lib/list-audit";
import { loadProfileState } from "@/lib/match/profile-server";
import { promptSystem, type ActivePrompt } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import { fitTiersFor, tierLabel, withoutGenericWhy, type InvestorListPayload, type InvestorRow } from "@/lib/setup";
import type { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const AUDIT_MIGRATION_MISSING =
  "The investor list audit is not set up in the database yet. Run portal/supabase/list_audit.sql in Supabase.";

function tableError(message: string, code?: string) {
  if (code === "42P01" || code === "PGRST205" || /investor_list_audits/.test(message)) return AUDIT_MIGRATION_MISSING;
  return message;
}

/** The client's newest audit, or null. */
export async function latestAudit(supabase: ServiceClient, clientId: string): Promise<Result<ListAudit | null>> {
  const { data, error } = await supabase
    .from("investor_list_audits")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: data ? asListAudit(data as Record<string, unknown>) : null };
}

export async function loadAudit(supabase: ServiceClient, clientId: string, auditId: string): Promise<Result<ListAudit>> {
  const { data, error } = await supabase
    .from("investor_list_audits")
    .select("*")
    .eq("client_id", clientId)
    .eq("id", auditId)
    .maybeSingle();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data) return { ok: false, error: "That audit no longer exists. Run the audit again." };
  return { ok: true, value: asListAudit(data as Record<string, unknown>) };
}

export async function createAudit(
  supabase: ServiceClient,
  input: { clientId: string; fingerprint: string; runId: string | null; sample: AuditSampleFund[]; actor: string | null },
): Promise<Result<ListAudit>> {
  const { data, error } = await supabase
    .from("investor_list_audits")
    .insert({
      client_id: input.clientId,
      list_fingerprint: input.fingerprint,
      run_id: input.runId,
      sample: input.sample,
      created_by: input.actor,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: tableError(error?.message ?? "The audit was not started.", error?.code) };
  return { ok: true, value: asListAudit(data as Record<string, unknown>) };
}

/**
 * Saves a change to an audit, only if nobody else saved it since it was
 * read (two tabs, or a retried request).
 */
export async function saveAudit(
  supabase: ServiceClient,
  audit: ListAudit,
  patch: { funds?: AuditFund[]; summary?: AuditSummary; status?: "complete" },
): Promise<Result<ListAudit>> {
  const { data, error } = await supabase
    .from("investor_list_audits")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", audit.id)
    .eq("updated_at", audit.updated_at)
    .select("*");
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data || data.length === 0) return { ok: false, error: "The audit changed in another window. Reload the page." };
  return { ok: true, value: asListAudit(data[0] as Record<string, unknown>) };
}

// ---------------------------------------------------------------------------
// The AI reading

/** What the founder knows about their own company, for the AI playing them. */
async function founderContext(supabase: ServiceClient, clientId: string): Promise<Result<string>> {
  const [client, interview, state] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
    loadInterview(supabase, clientId),
    loadProfileState(supabase, clientId),
  ]);
  if (client.error) return { ok: false, error: client.error.message };
  if (!client.data) return { ok: false, error: "Client not found." };
  const answers = state.ok && state.value ? state.value.answers : {};
  const brief = interview.ok ? interview.interview?.admin_brief?.summary?.trim() : "";
  const listOf = (id: string, title: string) => {
    const items = answerList(answers[id]);
    return items.length > 0 ? `${title}: ${items.join("; ")}` : "";
  };
  const lines = [
    buildClientContext(client.data as Record<string, unknown>),
    brief ? `What Rupert learned in the intake:\n${brief}` : "",
    listOf("existing_investors", "Existing investors"),
    listOf("already_pitched", "Investors already pitched"),
    listOf("competitors", "Direct competitors"),
    listOf("no_go", "Investors never to contact"),
  ].filter(Boolean);
  return { ok: true, value: lines.join("\n\n") };
}

function fundLines(row: InvestorRow, list: InvestorListPayload) {
  const why = withoutGenericWhy(row.why);
  return [
    `[${row.id}] ${row.fund_name} · ${row.broad ? "Broad investors (not a tier)" : tierLabel(row.tier, list.tier_scheme)}`,
    row.website ? `Website: ${row.website}` : "Website: none on record",
    row.fund_type ? `Type: ${row.fund_type}` : "",
    row.location ? `Location: ${row.location}` : "",
    row.stage_focus ? `Stages: ${row.stage_focus}` : "",
    row.sector_focus ? `Sectors: ${row.sector_focus}` : "",
    row.geography_focus ? `Invests in: ${row.geography_focus}` : "",
    row.check_size ? `Check size: ${row.check_size}` : "",
    row.reasons && row.reasons.length > 0 ? `Why it is on the list: ${row.reasons.join(", ")}` : "",
    why ? `Note: ${why}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function tiersLine(list: InvestorListPayload) {
  const rows = list.rows.filter((row) => !row.hidden_duplicate);
  const parts = fitTiersFor(list.tier_scheme).map(({ tier, label }) => {
    const count = rows.filter((row) => row.tier === tier && !row.broad).length;
    return `${label}: ${count}`;
  });
  const broad = rows.filter((row) => row.broad).length;
  return `${rows.length} funds. ${parts.join(", ")}${broad > 0 ? `, Broad investors: ${broad}` : ""}.`;
}

function tierGuide(list: InvestorListPayload) {
  return fitTiersFor(list.tier_scheme)
    .map(({ label, detail }) => `- ${label}: ${detail}`)
    .join("\n");
}

const FUNDS_TOOL: ClaudeTool = {
  name: "report_funds",
  description: "Report your verdict on every fund you were asked to review.",
  input_schema: {
    type: "object",
    properties: {
      funds: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "The id in square brackets, exactly as given." },
            verdict: { type: "string", enum: ["ok", "flag", "remove"] },
            reason: { type: "string", description: "One sentence grounded in what you saw." },
            founder_question: { type: "string", description: "What you would ask Rupert about this fund; empty if nothing." },
            website: {
              type: "string",
              enum: ["opened", "problem", "not_opened"],
              description: "opened: you read it; problem: dead, parked or not loading; not_opened: no link or not tried.",
            },
          },
          required: ["id", "verdict", "reason", "founder_question", "website"],
        },
      },
    },
    required: ["funds"],
  },
};

const SUMMARY_TOOL: ClaudeTool = {
  name: "report_summary",
  description: "Deliver your overall read of the list as the founder.",
  input_schema: {
    type: "object",
    properties: {
      overview: { type: "string", description: "How the list lands with you, in a few sentences." },
      questions: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question as you would ask it." },
            why: { type: "string", description: "What prompts it." },
            answer: { type: "string", description: "The short answer Rupert should be ready to give, from the facts given." },
          },
          required: ["question", "why", "answer"],
        },
      },
      concerns: { type: "array", maxItems: 8, items: { type: "string" }, description: "What would bother you." },
    },
    required: ["overview", "questions", "concerns"],
  },
};

async function auditPrompt(supabase: ServiceClient, clientId: string, purpose: string): Promise<Result<ActivePrompt>> {
  const prompt = await loadPrompt(supabase, "list_audit", { clientId, purpose });
  return prompt.ok ? { ok: true, value: prompt.value } : prompt;
}

/** The AI, as the founder, reviews a few funds and opens their websites. */
export async function reviewFunds(
  supabase: ServiceClient,
  clientId: string,
  list: InvestorListPayload,
  asked: AuditSampleFund[],
): Promise<Result<AuditFund[]>> {
  const [context, prompt] = await Promise.all([founderContext(supabase, clientId), auditPrompt(supabase, clientId, "Investor list audit: funds")]);
  if (!context.ok) return context;
  if (!prompt.ok) return prompt;
  const rows = asked
    .map((fund) => list.rows.find((row) => row.id === fund.id))
    .filter((row): row is InvestorRow => Boolean(row));
  const withSites = rows.filter((row) => row.website).length;

  const result = await callClaudeAgent<{ funds?: unknown }>({
    system: promptSystem(
      prompt.value,
      "## Your company",
      context.value,
      "## The list",
      tiersLine(list),
      "## What the tiers mean",
      tierGuide(list),
    ),
    content: [
      {
        type: "text",
        text: `Review these funds. Open each website with web_fetch when one is given (and no other links).\n\n${rows.map((row) => fundLines(row, list)).join("\n\n")}\n\nReport every fund by calling the ${FUNDS_TOOL.name} tool.`,
      },
    ],
    tool: FUNDS_TOOL,
    serverTools: withSites > 0 ? [webFetchTool(withSites + 2)] : [],
    maxTokens: 6000,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const funds = readBatch(asked, result.input.funds);
  // Without web fetch on the account, no website was opened, whatever the answer says.
  return { ok: true, value: result.serverToolsSkipped ? funds.map((fund) => ({ ...fund, website: "not_opened" as const })) : funds };
}

/** The founder's overall read: the questions they will ask, with the answers to have ready. */
export async function summarizeAudit(
  supabase: ServiceClient,
  clientId: string,
  list: InvestorListPayload,
  funds: AuditFund[],
): Promise<Result<AuditSummary>> {
  const [context, prompt] = await Promise.all([founderContext(supabase, clientId), auditPrompt(supabase, clientId, "Investor list audit: overall read")]);
  if (!context.ok) return context;
  if (!prompt.ok) return prompt;
  const reviewed = funds
    .map((fund) => {
      const row = list.rows.find((item) => item.id === fund.id);
      const reasons = row?.reasons && row.reasons.length > 0 ? ` (on the list for: ${row.reasons.join(", ")})` : "";
      return `- ${fund.fund_name}, ${fund.broad ? "Broad investors" : tierLabel(fund.tier, list.tier_scheme)}${reasons}: ${fund.verdict}. ${fund.reason}${fund.founder_question ? ` Question: ${fund.founder_question}` : ""}`;
    })
    .join("\n");

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(
      prompt.value,
      "## Your company",
      context.value,
      "## The list",
      tiersLine(list),
      "## What the tiers mean",
      tierGuide(list),
      list.summary ? "## Fund types per tier" : null,
      list.summary
        ? list.summary.tiers
            .map((tier) => `- ${tierLabel(tier.tier, list.tier_scheme)}: ${tier.by_type.map((type) => `${type.label} ${type.funds}`).join(", ") || "none"}`)
            .join("\n")
        : null,
    ),
    content: [
      {
        type: "text",
        text: `The funds you reviewed (the first in each tier):\n${reviewed || "None."}\n\nWrite your overall read by calling the ${SUMMARY_TOOL.name} tool.`,
      },
    ],
    tool: SUMMARY_TOOL,
    maxTokens: 4000,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const summary = asAuditSummary(result.input);
  if (!summary) return { ok: false, error: "Claude returned an empty read. Nothing was saved. Try again." };
  return { ok: true, value: summary };
}
