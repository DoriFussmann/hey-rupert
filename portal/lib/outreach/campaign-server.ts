import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { callClaudeAgent, type ClaudeTool } from "@/lib/anthropic";
import { outreachCompanyContext } from "@/lib/agents-server";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import {
  asWarmIntroStatus,
  buildBlockers,
  campaignSummary,
  exportRows,
  otherGroupFor,
  otherTierOf,
  planTierNumber,
  renderOtherEmails,
  renderSourceContact,
  tidyGreeting,
  type WarmIntroStatus,
} from "@/lib/outreach/campaign";
import { FALLBACK_OPT_OUT_LINE } from "@/lib/outreach/live";
import { copyReconfirmed, rebuildBlocker } from "@/lib/outreach/launch";
import { loadOutreachPlan } from "@/lib/outreach/source-server";
import type { SourceCopy } from "@/lib/outreach/source-copy";
import { contactStates, planFundPeople } from "@/lib/match/tiers/server";
import { peopleOf, type PersonRecord } from "@/lib/match/tiers/core";
import { verifyStateOf } from "@/lib/match/tiers/export";
import { copyTierOf, outreachRows, type TypedCopy } from "@/lib/outreach/copy";
import { asCorePerson, emailsHash, perFirmOf, selectCoreContacts } from "@/lib/outreach/core";
import { contactRow, loadOutreachMessages, pickContacts } from "@/lib/outreach/core-server";
import { loadKnownFundRows, loadOverrides } from "@/lib/outreach/known-server";
import { asEmailCopy, asInvestorList, type InvestorRow, type SetupStepState } from "@/lib/setup";
import { loadSetupSteps } from "@/lib/setup-server";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const OUTREACH_CAMPAIGN_MISSING =
  "The campaign tables are missing. Run portal/supabase/outreach_campaign.sql in the Supabase SQL editor, then try again.";

function tableError(message: string, code?: string) {
  return code === "42P01" || /outreach_campaigns|outreach_known_funds|outreach_messages/.test(message) || message.toLowerCase().includes("schema cache")
    ? OUTREACH_CAMPAIGN_MISSING
    : message;
}

type CampaignRow = {
  live_at: string | null;
  copy_version: number | null;
  run_id: string;
  built_at: string | null;
  built_by: string | null;
  summary: Record<string, unknown>;
  warm_intro_ask: string;
  warm_intro_blurb: string;
};

async function loadCampaignRow(supabase: ServiceClient, clientId: string): Promise<CampaignRow | null> {
  const { data } = await supabase.from("outreach_campaigns").select("*").eq("client_id", clientId).maybeSingle();
  if (!data) return null;
  return {
    live_at: data.live_at ? String(data.live_at) : null,
    copy_version: data.copy_version == null ? null : Number(data.copy_version),
    run_id: String(data.run_id ?? ""),
    built_at: data.built_at ? String(data.built_at) : null,
    built_by: data.built_by ? String(data.built_by) : null,
    summary: (data.summary ?? {}) as Record<string, unknown>,
    warm_intro_ask: String(data.warm_intro_ask ?? ""),
    warm_intro_blurb: String(data.warm_intro_blurb ?? ""),
  };
}

type Steps = {
  list: ReturnType<typeof asInvestorList> | null;
  listConfirmed: boolean;
  copyRow: SetupStepState | null;
  typed: TypedCopy | null;
  /** Copy by source (v3): the campaign is built from the confirmed Plan. */
  source: SourceCopy | null;
  /** The Plan of the current finalized matching, for copy by source. */
  planId: string | null;
};

/** The Plan of the client's current finalized matching, or null. */
async function currentPlanId(supabase: ServiceClient, clientId: string) {
  const { data } = await supabase
    .from("match_finalizations")
    .select("plan_id")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("finalized_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ plan_id: string | null }>();
  return data?.plan_id ?? null;
}

async function loadSteps(supabase: ServiceClient, clientId: string): Promise<Steps> {
  const grouped = await loadSetupSteps(supabase, [clientId]);
  const rows = grouped.get(clientId) ?? [];
  const listRow = rows.find((item) => item.step === "investor_list");
  const copyRow = rows.find((item) => item.step === "email_copy") ?? null;
  const published = asEmailCopy(copyRow?.published);
  const source = published.copy_version === 3 && published.by_source ? published.by_source : null;
  return {
    list: listRow ? asInvestorList(listRow.published) : null,
    listConfirmed: listRow?.status === "confirmed",
    copyRow,
    typed: published.copy_version === 2 && published.typed ? published.typed : null,
    source,
    planId: source ? await currentPlanId(supabase, clientId) : null,
  };
}

// ---------------------------------------------------------------------------
// Known funds (warm intros)

export type KnownFund = {
  firm_id: string;
  fund_name: string;
  fund_type: string;
  website: string;
  tier: number;
  contacts: { name: string; title: string }[];
  status: WarmIntroStatus;
  client_note: string;
  /** Rupert put it back into the campaign. */
  override: boolean;
};

/** Funds the client marked "I know them" on the confirmed list, with their contacts' names and progress. */
export async function loadKnownFunds(supabase: ServiceClient, clientId: string, steps?: Steps): Promise<Result<KnownFund[]>> {
  const loaded = steps ?? (await loadSteps(supabase, clientId));
  if (!loaded.list || !loaded.listConfirmed) return { ok: true, value: [] };
  const list = loaded.list;
  const flags = list.client_flags ?? {};
  const known = list.rows.filter((row) => !row.hidden_duplicate && flags[row.id]?.known && !flags[row.id]?.excluded);
  if (known.length === 0) return { ok: true, value: [] };
  const rows = await loadKnownFundRows(supabase, clientId);
  const byFirm = new Map(rows.map((row) => [row.firm_id, row]));
  let contacts = new Map<string, { name: string; title: string }[]>();
  if (list.run_id) {
    const picked = await pickContacts(supabase, clientId, list.run_id, known, perFirmOf(list));
    if (picked.ok) {
      contacts = new Map(
        Array.from(picked.value.entries()).map(([id, chosen]) => [
          id,
          chosen.active.map((person) => {
            const p = asCorePerson(person);
            return { name: p.name, title: p.title };
          }),
        ]),
      );
    }
  }
  return {
    ok: true,
    value: known.map((row) => {
      const saved = byFirm.get(row.id);
      return {
        firm_id: row.id,
        fund_name: row.fund_name,
        fund_type: row.fund_type ?? "",
        website: row.website ?? "",
        tier: copyTierOf(row),
        contacts: contacts.get(row.id) ?? [],
        status: saved?.status ?? "not_started",
        client_note: saved?.client_note ?? "",
        override: saved?.override ?? false,
      };
    }),
  };
}

async function upsertKnown(supabase: ServiceClient, clientId: string, firmId: string, fundName: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("outreach_known_funds").upsert(
    { client_id: clientId, firm_id: firmId, fund_name: fundName, ...patch, updated_at: new Date().toISOString() },
    { onConflict: "client_id,firm_id" },
  );
  return error ? { ok: false as const, error: tableError(error.message, error.code) } : { ok: true as const, value: null };
}

/** The client's progress on one known fund. Only funds they marked as known. */
export async function setWarmIntro(
  supabase: ServiceClient,
  clientId: string,
  firmId: string,
  status: unknown,
  note: unknown,
): Promise<Result<null>> {
  const known = await loadKnownFunds(supabase, clientId);
  if (!known.ok) return known;
  const fund = known.value.find((item) => item.firm_id === firmId);
  if (!fund) return { ok: false, error: "That fund isn't on your warm-intro list." };
  return upsertKnown(supabase, clientId, firmId, fund.fund_name, {
    status: asWarmIntroStatus(status),
    client_note: String(note ?? "").slice(0, 2000),
  });
}

/** Rupert puts a known fund back into the campaign, or takes it out again. */
export async function setOverride(
  supabase: ServiceClient,
  clientId: string,
  firmId: string,
  on: boolean,
  actor: string | null,
): Promise<Result<null>> {
  const known = await loadKnownFunds(supabase, clientId);
  if (!known.ok) return known;
  const fund = known.value.find((item) => item.firm_id === firmId);
  if (!fund) return { ok: false, error: "That fund isn't marked as known by the client." };
  return upsertKnown(supabase, clientId, firmId, fund.fund_name, {
    override: on,
    override_by: on ? actor : null,
    override_at: on ? new Date().toISOString() : null,
  });
}

// ---------------------------------------------------------------------------
// Warm-intro blurb

const BLURB_TOOL: ClaudeTool = {
  name: "submit_warm_intro",
  description: "Deliver the ask and the forwardable blurb.",
  input_schema: {
    type: "object",
    properties: {
      ask: { type: "string", description: "One or two sentences to the connector. {{fund_name}} allowed." },
      blurb: { type: "string", description: "The forwardable paragraph, 60 to 100 words." },
    },
    required: ["ask", "blurb"],
  },
};

export async function draftWarmIntroBlurb(supabase: ServiceClient, clientId: string): Promise<Result<{ ask: string; blurb: string }>> {
  const [company, prompt] = await Promise.all([
    outreachCompanyContext(supabase, clientId),
    loadPrompt(supabase, "warm_intro_blurb", { clientId, purpose: "Warm intro blurb" }),
  ]);
  if (!company.ok) return company;
  if (!prompt.ok) return prompt;
  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content: [{ type: "text", text: `${company.value.text}\n\nWrite the ask and the blurb, then call ${BLURB_TOOL.name}.` }],
    tool: BLURB_TOOL,
    maxTokens: 1500,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  const ask = String(result.input.ask ?? "").trim().slice(0, 1000);
  const blurb = String(result.input.blurb ?? "").trim().slice(0, 3000);
  if (!blurb) return { ok: false, error: "Claude returned an empty blurb. Nothing was saved." };
  return saveWarmIntroBlurb(supabase, clientId, ask, blurb);
}

export async function saveWarmIntroBlurb(supabase: ServiceClient, clientId: string, ask: string, blurb: string): Promise<Result<{ ask: string; blurb: string }>> {
  const clean = { ask: String(ask ?? "").trim().slice(0, 1000), blurb: String(blurb ?? "").trim().slice(0, 3000) };
  const { error } = await supabase.from("outreach_campaigns").upsert(
    { client_id: clientId, warm_intro_ask: clean.ask, warm_intro_blurb: clean.blurb, updated_at: new Date().toISOString() },
    { onConflict: "client_id" },
  );
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: clean };
}

export async function loadWarmIntroBlurb(supabase: ServiceClient, clientId: string) {
  const row = await loadCampaignRow(supabase, clientId);
  return { ask: row?.warm_intro_ask ?? "", blurb: row?.warm_intro_blurb ?? "" };
}

// ---------------------------------------------------------------------------
// The campaign

export type CampaignState = {
  /** Live in Instantly: the build and the Core emails are frozen. */
  live: boolean;
  built: boolean;
  builtAt: string | null;
  builtBy: string | null;
  /** The build no longer matches the confirmed copy or list. */
  stale: string | null;
  blockers: string[];
  summary: ReturnType<typeof campaignSummary> | null;
  /** Active contacts whose text changed since it was approved: left out of the export. */
  notApproved: number;
  /** Funds that could not be written (no copy group for their type). */
  unwritten: string[];
  known: KnownFund[];
  blurb: { ask: string; blurb: string };
};

/** Why a copy-by-source campaign can't be built yet. Empty: it can. */
function sourceBlockers(steps: Steps): string[] {
  const blockers: string[] = [];
  if (steps.copyRow?.status !== "confirmed") blockers.push("The client hasn't confirmed the email copy yet.");
  if (!steps.planId) blockers.push("The matching isn't finalized, or was reopened: finalize it again.");
  else if (steps.source?.plan_id && steps.source.plan_id !== steps.planId) {
    blockers.push("The email copy was written for an earlier Plan. Update the copy and send it to the client again.");
  }
  return blockers;
}

function staleReason(campaign: CampaignRow | null, steps: Steps) {
  if (!campaign?.built_at || campaign.live_at) return null;
  if (steps.copyRow?.status !== "confirmed") return "The email copy changed since the campaign was built and the client hasn't confirmed it again.";
  if (campaign.copy_version !== steps.copyRow.version) return "The client confirmed a newer version of the email copy. Build the campaign again.";
  if (steps.source) {
    if (steps.planId && campaign.run_id !== steps.planId) return "The Plan changed since the campaign was built. Build it again.";
    return null;
  }
  if (steps.list?.run_id && campaign.run_id !== steps.list.run_id) return "The investor list changed since the campaign was built. Build it again.";
  return null;
}

export async function loadCampaignState(supabase: ServiceClient, clientId: string): Promise<Result<CampaignState>> {
  const [steps, campaign, messages] = await Promise.all([
    loadSteps(supabase, clientId),
    loadCampaignRow(supabase, clientId),
    loadOutreachMessages(supabase, clientId),
  ]);
  if (!messages.ok) return { ok: false, error: messages.error };
  const known = await loadKnownFunds(supabase, clientId, steps);
  if (!known.ok) return known;
  const coreFunds = steps.list ? outreachRows(steps.list, await loadOverrides(supabase, clientId)).rows.filter((row) => copyTierOf(row) === 1).length : 0;
  const blockers = steps.source
    ? sourceBlockers(steps)
    : steps.listConfirmed
    ? buildBlockers({
        copyConfirmed: steps.copyRow?.status === "confirmed",
        copyByType: Boolean(steps.typed),
        coreFunds,
        core: messages.value.filter((m) => m.tier === 1),
      })
    : ["Confirm the investor list first."];
  const built = Boolean(campaign?.built_at);
  const summary = built ? campaignSummary(messages.value) : null;
  return {
    ok: true,
    value: {
      live: Boolean(campaign?.live_at),
      built,
      builtAt: campaign?.built_at ?? null,
      builtBy: campaign?.built_by ?? null,
      stale: staleReason(campaign, steps),
      blockers,
      summary,
      notApproved: summary ? summary.contacts - summary.approved : 0,
      unwritten: Array.isArray(campaign?.summary?.unwritten) ? (campaign!.summary.unwritten as string[]) : [],
      known: known.value,
      blurb: { ask: campaign?.warm_intro_ask ?? "", blurb: campaign?.warm_intro_blurb ?? "" },
    },
  };
}

/**
 * The client confirmed a newer version of the copy after the campaign was built (not live yet):
 * the build is out of date only because of that confirmation, so rebuild it now. Nothing else
 * changed, and waiting for the admin would leave both sides stuck ("waiting on client" in admin,
 * "Rupert is finishing your campaign" in the portal). Returns true when it rebuilt.
 */
export async function rebuildAfterCopyConfirmed(supabase: ServiceClient, clientId: string): Promise<boolean> {
  const [steps, campaign] = await Promise.all([loadSteps(supabase, clientId), loadCampaignRow(supabase, clientId)]);
  if (!copyReconfirmed(campaign, steps)) return false;
  const built = await buildCampaign(supabase, clientId, null);
  return built.ok;
}


/**
 * Builds the campaign from the confirmed copy: Core contacts keep the emails
 * Rupert approved; every Sphere, Tier 3 and Tier 4 fund gets its contacts (the plan's per fund)
 * and the emails of its type's sequence, filled in and approved by the
 * client's confirmation. Rebuilding replaces the non-Core rows.
 */
export async function buildCampaign(
  supabase: ServiceClient,
  clientId: string,
  actor: string | null,
): Promise<Result<{ contacts: number; unwritten: string[] }>> {
  const live = await supabase.from("outreach_campaigns").select("*").eq("client_id", clientId).maybeSingle();
  if (live.error) return { ok: false, error: tableError(live.error.message, live.error.code) };
  const launched = live.data
    ? rebuildBlocker({
        live_at: live.data.live_at ?? null,
        leads_adding_at: live.data.leads_adding_at ?? null,
        leads_added_at: live.data.leads_added_at ?? null,
        leads_added_count: live.data.leads_added_count ?? null,
        leads_add_note: live.data.leads_add_note ?? null,
      })
    : null;
  if (launched) return { ok: false, error: launched };
  const state = await loadCampaignState(supabase, clientId);
  if (!state.ok) return state;
  if (state.value.blockers.length > 0) return { ok: false, error: state.value.blockers.join(" ") };
  const steps = await loadSteps(supabase, clientId);
  if (steps.source && steps.copyRow && steps.planId) return buildFromPlan(supabase, clientId, actor, steps.source, steps.copyRow.version, steps.planId);
  if (!steps.list || !steps.list.run_id || !steps.typed || !steps.copyRow) return { ok: false, error: "The confirmed list or copy is missing." };
  const typed = steps.typed;
  const version = steps.copyRow.version;

  const overrides = await loadOverrides(supabase, clientId);
  const others = outreachRows(steps.list, overrides).rows.filter((row) => copyTierOf(row) !== 1);
  const picked = await pickContacts(supabase, clientId, steps.list.run_id, others, perFirmOf(steps.list));
  if (!picked.ok) return picked;

  const approvedBy = `client confirmation (copy v${version})`;
  const now = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];
  const unwritten: string[] = [];
  for (const row of others as InvestorRow[]) {
    const tier = otherTierOf(row);
    const chosen = picked.value.get(row.id);
    if (!tier || !chosen) continue;
    const group = otherGroupFor(typed, row.fund_type ?? "");
    if (!group) {
      unwritten.push(`${row.fund_name} (${row.fund_type || "Other"}: no copy for this type)`);
      continue;
    }
    for (const [slot, people] of [["active", chosen.active], ["reserve", chosen.reserve]] as const) {
      people.forEach((person, index) => {
        const base = contactRow(clientId, steps.list!.run_id!, row, person, slot, slot === "active" ? index : chosen.active.length + index, tier);
        const emails = tidyGreeting(renderOtherEmails(group, tier, asCorePerson(person), row.fund_name));
        inserts.push(
          slot === "active"
            ? { ...base, emails, status: "approved", approved_by: approvedBy, approved_at: now, approved_hash: emailsHash(emails) }
            : { ...base, emails },
        );
      });
    }
  }

  const removed = await supabase.from("outreach_messages").delete().eq("client_id", clientId).gt("tier", 1);
  if (removed.error) return { ok: false, error: tableError(removed.error.message, removed.error.code) };
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase.from("outreach_messages").insert(inserts.slice(i, i + 500));
    if (error) return { ok: false, error: tableError(error.message, error.code) };
  }
  const contacts = inserts.filter((row) => row.slot === "active").length;
  const { error } = await supabase.from("outreach_campaigns").upsert(
    {
      client_id: clientId,
      copy_version: version,
      run_id: steps.list.run_id,
      built_at: now,
      built_by: actor,
      summary: { unwritten, other_contacts: contacts },
      updated_at: now,
    },
    { onConflict: "client_id" },
  );
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: { contacts, unwritten } };
}

/**
 * Copy by source (v3): every fund of the confirmed Plan gets as many contacts
 * as the Plan gives it, picked from the fund's people as the engine ranks them
 * (Primary, Backup, then the rest), leaving out contacts verification found a
 * problem with or that Rupert removed. The next ones are reserves. Each gets
 * its group's emails, filled in and approved by the client's confirmation.
 * A fund is left out, and named, when its group has no copy, it has no usable
 * contact, or its emails would still hold an empty {{field}}.
 */
async function buildFromPlan(
  supabase: ServiceClient,
  clientId: string,
  actor: string | null,
  copy: SourceCopy,
  version: number,
  planId: string,
): Promise<Result<{ contacts: number; unwritten: string[] }>> {
  const [plan, people] = await Promise.all([loadOutreachPlan(supabase, clientId), planFundPeople(supabase, clientId)]);
  if (!plan.ok) return plan;
  if (!people.ok) return people;
  if (!people.value || people.value.planId !== planId || plan.value.planId !== planId) {
    return { ok: false, error: "The Plan changed while building. Try again." };
  }
  const byFirm = new Map(people.value.funds.map((fund) => [fund.firmId, fund]));
  const fids = Array.from(new Set(people.value.funds.flatMap((fund) => fund.ranked.map((c) => c.fid))));
  const states = await contactStates(supabase, clientId, fids);
  if (!states.ok) return states;
  const problems = new Set(["email_bad", "left_firm", "role_changed", "not_found"]);
  const blocked = (person: PersonRecord) => {
    const decision = states.value.get(`${person.fid}|${person.key}`)?.decision ?? null;
    return decision === "remove" || (problems.has(verifyStateOf(person, states.value)) && decision !== "keep");
  };
  const groups = new Map(copy.groups.map((group) => [group.bucket, group]));
  const approvedBy = `client confirmation (copy v${version})`;
  const now = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];
  const unwritten: string[] = [];

  for (const fund of plan.value.funds) {
    const group = groups.get(fund.bucket);
    if (!group || !group.emails.some((email) => email.body.trim())) {
      unwritten.push(`${fund.name} (no copy for its group)`);
      continue;
    }
    const found = byFirm.get(fund.firmId);
    // Advisors and ops never get the email, unless the engine made them the Primary or Backup.
    const ranked = (found?.ranked ?? []).filter((c) => c.email?.trim() && c.role !== "ops" && (c.seq || c.role !== "advisor"));
    const chosen = selectCoreContacts(peopleOf(ranked), (person) => blocked(person as PersonRecord), fund.contacts);
    if (chosen.active.length === 0) {
      unwritten.push(`${fund.name} (no usable contact${chosen.leftOut ? `: ${chosen.leftOut} left out after verification` : ""})`);
      continue;
    }
    const tier = planTierNumber(fund.tier);
    const row = { id: fund.firmId, fund_name: fund.name, fund_type: fund.type } as InvestorRow;
    const rendered = [...chosen.active, ...chosen.reserve].map((person, index) => ({
      person: person as PersonRecord,
      slot: index < chosen.active.length ? ("active" as const) : ("reserve" as const),
      index,
      ...renderSourceContact(group, fund, asCorePerson(person).first_name),
    }));
    const missing = rendered.find((item) => item.slot === "active" && item.missing.length)?.missing;
    if (missing) {
      unwritten.push(`${fund.name} (no value for ${missing.map((field) => `{{${field}}}`).join(", ")})`);
      continue;
    }
    for (const item of rendered) {
      const base = contactRow(clientId, planId, row, item.person, item.slot, item.index, tier);
      inserts.push(
        item.slot === "active"
          ? { ...base, emails: item.emails, status: "approved", approved_by: approvedBy, approved_at: now, approved_hash: emailsHash(item.emails) }
          : { ...base, emails: item.emails },
      );
    }
  }

  const removed = await supabase.from("outreach_messages").delete().eq("client_id", clientId);
  if (removed.error) return { ok: false, error: tableError(removed.error.message, removed.error.code) };
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase.from("outreach_messages").insert(inserts.slice(i, i + 500));
    if (error) return { ok: false, error: tableError(error.message, error.code) };
  }
  const contacts = inserts.filter((row) => row.slot === "active").length;
  const { error } = await supabase.from("outreach_campaigns").upsert(
    {
      client_id: clientId,
      copy_version: version,
      run_id: planId,
      built_at: now,
      built_by: actor,
      summary: { unwritten, other_contacts: contacts, opt_out_line: copy.opt_out_line.trim() || FALLBACK_OPT_OUT_LINE },
      updated_at: now,
    },
    { onConflict: "client_id" },
  );
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: { contacts, unwritten } };
}

/** The Instantly CSV rows. Refused while the build is missing or stale. */
export async function campaignExport(supabase: ServiceClient, clientId: string, wave: 1 | 2 | null) {
  const [steps, campaign, messages] = await Promise.all([
    loadSteps(supabase, clientId),
    loadCampaignRow(supabase, clientId),
    loadOutreachMessages(supabase, clientId),
  ]);
  if (!campaign?.built_at) return { ok: false as const, error: "Build the campaign first." };
  const stale = staleReason(campaign, steps);
  if (stale) return { ok: false as const, error: stale };
  if (!messages.ok) return { ok: false as const, error: messages.error };
  const optOut = steps.typed?.opt_out_line ?? (steps.source ? steps.source.opt_out_line.trim() || FALLBACK_OPT_OUT_LINE : null);
  if (optOut == null) return { ok: false as const, error: "The confirmed copy isn't written by fund type or by source." };
  return { ok: true as const, value: exportRows(messages.value, optOut, wave) };
}
