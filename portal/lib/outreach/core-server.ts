import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { callClaudeAgent, webSearchTool, type ClaudeTool } from "@/lib/anthropic";
import { outreachCompanyContext } from "@/lib/agents-server";
import { selectAll } from "@/lib/match/db-server";
import { reachablePeople } from "@/lib/match/tiers/client-list";
import { verifyStateOf } from "@/lib/match/tiers/export";
import { contactStates, loadTierRun } from "@/lib/match/tiers/server";
import type { PersonRecord } from "@/lib/match/tiers/core";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import {
  FUND_TYPES,
  SEQUENCE_LENGTH,
  copyTierOf,
  fundTypeKey,
  outreachRows,
  presetFor,
  styleInstructions,
  type TypedCopy,
  type TypedGroupCopy,
} from "@/lib/outreach/copy";
import {
  asCoreEmails,
  asCorePerson,
  asQuickFacts,
  coreMessageIssues,
  emailsHash,
  isApproved,
  personKey,
  researchIsFresh,
  perFirmOf,
  selectCoreContacts,
  templateFor,
  type ContactSlot,
  type CoreMessage,
  type CorePerson,
  type MessageStatus,
  type QuickFact,
} from "@/lib/outreach/core";
import { loadOutreachStyles } from "@/lib/outreach/settings-server";
import { loadOverrides } from "@/lib/outreach/known-server";
import { asEmailCopy, asInvestorList, type CopyEmail, type InvestorRow } from "@/lib/setup";
import { loadSetupSteps } from "@/lib/setup-server";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const OUTREACH_CORE_MISSING =
  "The Core outreach tables are missing. Run portal/supabase/outreach_core.sql in the Supabase SQL editor, then try again.";

function tableError(message: string, code?: string) {
  return code === "42P01" || /outreach_messages|fund_research/.test(message) || message.toLowerCase().includes("schema cache")
    ? OUTREACH_CORE_MISSING
    : message;
}

const RESEARCH_MAX_SEARCHES = 4;
const STEP_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Loading

function str(value: unknown, max = 2000) {
  return (typeof value === "string" ? value : "").slice(0, max);
}

function asPerson(value: unknown): CorePerson {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    fid: str(raw.fid, 200),
    name: str(raw.name, 200),
    first_name: str(raw.first_name, 100),
    title: str(raw.title, 200),
    email: str(raw.email, 254),
    seq: str(raw.seq, 20),
  };
}

const STATUSES = new Set<MessageStatus>(["pending", "drafted", "approved", "error"]);

function asMessage(row: Record<string, unknown>): CoreMessage {
  const status = String(row.status) as MessageStatus;
  return {
    id: String(row.id),
    firm_id: str(row.firm_id, 200),
    fund_name: str(row.fund_name, 300),
    fund_type: str(row.fund_type, 60),
    person_key: str(row.person_key, 500),
    person: asPerson(row.person),
    slot: row.slot === "reserve" ? "reserve" : "active",
    position: Number(row.position) || 0,
    quick_facts: asQuickFacts(row.quick_facts),
    emails: asCoreEmails(row.emails),
    status: STATUSES.has(status) ? status : "pending",
    error: row.error ? str(row.error, 1000) : null,
    approved_by: row.approved_by ? str(row.approved_by, 200) : null,
    approved_at: row.approved_at ? String(row.approved_at) : null,
    approved_hash: row.approved_hash ? String(row.approved_hash) : null,
    updated_at: String(row.updated_at ?? ""),
  };
}

export type CoreMessageView = CoreMessage & {
  conflict: string;
  note: string;
  /** Already added to the live Instantly campaign. */
  pushed: boolean;
};

function asView(row: Record<string, unknown>): CoreMessageView {
  return { ...asMessage(row), conflict: str(row.conflict, 500), note: str(row.note, 2000), pushed: Boolean(row.pushed_at) };
}

export type Delivery = {
  instantly_lead_id: string | null;
  pushed_at: string | null;
  sent_at: string | null;
  last_step: number | null;
  opened_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  unsubscribed_at: string | null;
  meeting_at: string | null;
};

export type OutreachMessageView = CoreMessageView & Delivery & { tier: number };

function deliveryOf(row: Record<string, unknown>): Delivery {
  const at = (value: unknown) => (value ? String(value) : null);
  return {
    instantly_lead_id: at(row.instantly_lead_id),
    pushed_at: at(row.pushed_at),
    sent_at: at(row.sent_at),
    last_step: row.last_step == null ? null : Number(row.last_step),
    opened_at: at(row.opened_at),
    replied_at: at(row.replied_at),
    bounced_at: at(row.bounced_at),
    unsubscribed_at: at(row.unsubscribed_at),
    meeting_at: at(row.meeting_at),
  };
}

/** Every contact row for a client, all tiers. */
export async function loadOutreachMessages(supabase: ServiceClient, clientId: string): Promise<Result<OutreachMessageView[]>> {
  const rows = await selectAll<Record<string, unknown>>((from, to) =>
    supabase
      .from("outreach_messages")
      .select("*")
      .eq("client_id", clientId)
      .order("tier")
      .order("fund_name")
      .order("position")
      .range(from, to),
  );
  if (!rows.ok) return { ok: false, error: tableError(rows.error) };
  return { ok: true, value: rows.rows.map((row) => ({ ...asView(row), ...deliveryOf(row), tier: Number(row.tier) || 1 })) };
}

export async function loadCoreMessages(supabase: ServiceClient, clientId: string): Promise<Result<CoreMessageView[]>> {
  const all = await loadOutreachMessages(supabase, clientId);
  return all.ok ? { ok: true, value: all.value.filter((message) => message.tier === 1) } : all;
}

/** The approved Core emails a client may look through. Nothing else about the contacts. */
export async function loadApprovedCoreForClient(supabase: ServiceClient, clientId: string) {
  const loaded = await loadCoreMessages(supabase, clientId);
  if (!loaded.ok) return [];
  return loaded.value
    .filter((message) => message.slot === "active" && isApproved(message))
    .map((message) => ({
      id: message.id,
      fund_name: message.fund_name,
      fund_type: message.fund_type,
      person_name: message.person.name,
      person_title: message.person.title,
      quick_facts: message.quick_facts,
      emails: message.emails,
    }));
}

export type ApprovedCoreEmail = Awaited<ReturnType<typeof loadApprovedCoreForClient>>[number];

type Basis = {
  list: ReturnType<typeof asInvestorList>;
  typed: TypedCopy | null;
  coreRows: InvestorRow[];
};

/** The confirmed list's Core funds, and the copy the Core emails are written from (the draft first). */
async function loadBasis(supabase: ServiceClient, clientId: string): Promise<Result<Basis>> {
  const grouped = await loadSetupSteps(supabase, [clientId]);
  const rows = grouped.get(clientId) ?? [];
  const listRow = rows.find((item) => item.step === "investor_list");
  if (listRow?.status !== "confirmed") return { ok: false, error: "Confirm the investor list first." };
  const list = asInvestorList(listRow.published);
  if (list.tier_scheme !== "four" || !list.run_id) {
    return { ok: false, error: "Core contacts need a four-tier list pushed from a saved match run." };
  }
  const emailRow = rows.find((item) => item.step === "email_copy");
  const draft = asEmailCopy(emailRow?.draft);
  const published = asEmailCopy(emailRow?.published);
  const typed = draft.copy_version === 2 && draft.typed ? draft.typed : published.copy_version === 2 ? published.typed ?? null : null;
  const overrides = await loadOverrides(supabase, clientId);
  const coreRows = outreachRows(list, overrides).rows.filter((row) => copyTierOf(row) === 1);
  return { ok: true, value: { list, typed, coreRows } };
}

export type CoreWorkspace = {
  messages: CoreMessageView[];
  /** Why writing can't start yet, when it can't. */
  blocker: string | null;
  /** Core fund types that have a template in the copy. */
  templates: string[];
  coreFunds: number;
  /** First-email word cap of the Core style, per fund type. */
  caps: Record<string, number>;
  /** Contacts emailed per fund, from the campaign plan on the confirmed list. */
  perFirm: number;
};

export async function loadCoreWorkspace(supabase: ServiceClient, clientId: string): Promise<Result<CoreWorkspace>> {
  const [basis, messages, styles] = await Promise.all([
    loadBasis(supabase, clientId),
    loadCoreMessages(supabase, clientId),
    loadOutreachStyles(supabase),
  ]);
  if (!messages.ok) return messages;
  const caps = Object.fromEntries(FUND_TYPES.map((type) => [type, presetFor(styles.styles, "core", type).max_words]));
  if (!basis.ok) return { ok: true, value: { messages: messages.value, blocker: basis.error, templates: [], coreFunds: 0, caps, perFirm: 2 } };
  const templates = (basis.value.typed?.core ?? []).filter((group) => group.emails[0]?.body.trim()).map((group) => group.type);
  return {
    ok: true,
    value: {
      messages: messages.value,
      blocker: templates.length === 0 ? "Draft the Core copy by fund type first: each contact's emails are written from it." : null,
      templates,
      coreFunds: basis.value.coreRows.length,
      caps,
      perFirm: perFirmOf(basis.value.list),
    },
  };
}

// ---------------------------------------------------------------------------
// Sync: the contacts at each Core fund

const PROBLEMS = new Set(["email_bad", "left_firm", "role_changed", "not_found"]);

/** Live in Instantly: what was pushed can't change from here. */
async function isLive(supabase: ServiceClient, clientId: string) {
  const { data } = await supabase.from("outreach_campaigns").select("*").eq("client_id", clientId).maybeSingle();
  return Boolean(data?.live_at);
}

const PUSHED_ERROR = "This contact is already in the live campaign. Its emails can't change here.";

export type PickedContacts = { active: PersonRecord[]; reserve: PersonRecord[]; leftOut: number };

/**
 * The contacts at each listed fund, from the list's saved run: 2 active, the
 * rest reserves. Contacts verification flagged, or Rupert removed for this
 * client, are left out.
 */
export async function pickContacts(
  supabase: ServiceClient,
  clientId: string,
  runId: string,
  rows: InvestorRow[],
  /** Contacts emailed per fund (the list's, from its campaign plan). */
  perFirm: number,
): Promise<Result<Map<string, PickedContacts>>> {
  const run = await loadTierRun(supabase, clientId, runId);
  if (!run.ok) return run;
  const stored = new Map(run.value.rows.map((row) => [row.firmId.trim().slice(0, 200), row]));
  const firmIds = Array.from(
    new Set(rows.flatMap((row) => {
      const result = stored.get(row.id);
      return result ? reachablePeople(result).map((person) => person.fid) : [];
    })),
  );
  const states = await contactStates(supabase, clientId, firmIds);
  if (!states.ok) return states;
  const out = new Map<string, PickedContacts>();
  for (const row of rows) {
    const result = stored.get(row.id);
    if (!result) continue;
    const people = reachablePeople(result) as PersonRecord[];
    const chosen = selectCoreContacts(people, (person) => {
      const state = verifyStateOf(person as PersonRecord, states.value);
      const decision = states.value.get(`${person.fid}|${person.key}`)?.decision ?? null;
      return decision === "remove" || (PROBLEMS.has(state) && decision !== "keep");
    }, perFirm);
    out.set(row.id, { active: chosen.active as PersonRecord[], reserve: chosen.reserve as PersonRecord[], leftOut: chosen.leftOut });
  }
  return { ok: true, value: out };
}

/** A new outreach_messages row. */
export function contactRow(
  clientId: string,
  runId: string,
  row: InvestorRow,
  person: PersonRecord,
  slot: ContactSlot,
  position: number,
  tier: number,
) {
  return {
    client_id: clientId,
    run_id: runId,
    firm_id: row.id,
    fund_name: row.fund_name,
    fund_type: fundTypeKey(row.fund_type),
    tier,
    person_key: personKey(person),
    person: asCorePerson(person),
    slot,
    position,
    status: "pending",
  };
}

/**
 * Lines up the contacts of the confirmed list's Core funds from its saved run:
 * 2 active per fund, the rest reserves. New contacts are added; contacts Rupert
 * already has keep their slot, facts and emails. Funds no longer in Core are removed.
 */
export async function syncCoreContacts(
  supabase: ServiceClient,
  clientId: string,
): Promise<Result<{ funds: number; added: number; removed: number; leftOut: number }>> {
  if (await isLive(supabase, clientId)) return { ok: false, error: "The campaign is live. Contacts can't change now." };
  const basis = await loadBasis(supabase, clientId);
  if (!basis.ok) return basis;
  const { list, coreRows } = basis.value;
  const picked = await pickContacts(supabase, clientId, list.run_id!, coreRows, perFirmOf(list));
  if (!picked.ok) return picked;
  const existing = await loadCoreMessages(supabase, clientId);
  if (!existing.ok) return existing;
  const have = new Set(existing.value.map((message) => `${message.firm_id}#${message.person_key}`));

  const inserts: Record<string, unknown>[] = [];
  let leftOut = 0;
  for (const row of coreRows) {
    const chosen = picked.value.get(row.id);
    if (!chosen) continue;
    leftOut += chosen.leftOut;
    for (const [slot, people] of [["active", chosen.active], ["reserve", chosen.reserve]] as const) {
      people.forEach((person, index) => {
        const key = personKey(person);
        if (have.has(`${row.id}#${key}`)) return;
        inserts.push(contactRow(clientId, list.run_id!, row, person, slot, slot === "active" ? index : chosen.active.length + index, 1));
      });
    }
  }

  const coreIds = new Set(coreRows.map((row) => row.id));
  const gone = existing.value.filter((message) => !coreIds.has(message.firm_id)).map((message) => message.id);
  if (gone.length > 0) {
    const { error } = await supabase.from("outreach_messages").delete().in("id", gone);
    if (error) return { ok: false, error: tableError(error.message, error.code) };
  }
  if (inserts.length > 0) {
    const { error } = await supabase.from("outreach_messages").insert(inserts);
    if (error) return { ok: false, error: tableError(error.message, error.code) };
  }
  return { ok: true, value: { funds: coreRows.length, added: inserts.length, removed: gone.length, leftOut } };
}

// ---------------------------------------------------------------------------
// Research: Quick Facts

const FACTS_TOOL: ClaudeTool = {
  name: "report_quick_facts",
  description: "Report the Quick Facts found, each with the page it came from.",
  input_schema: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            fact: { type: "string", description: "One plain sentence." },
            url: { type: "string", description: "The page in your search results that states it." },
            about: { type: "string", enum: ["fund", "person"] },
          },
          required: ["fact", "url", "about"],
        },
      },
      conflict: { type: "string", description: "A direct competitor of the company the fund backed, or empty." },
    },
    required: ["facts", "conflict"],
  },
};

type ResearchRow = { person_key: string; facts: unknown; conflict: string | null; researched_at: string };

async function research(
  supabase: ServiceClient,
  clientId: string,
  message: CoreMessage,
  fund: InvestorRow | undefined,
  companyLine: string,
  refresh: boolean,
): Promise<Result<{ facts: QuickFact[]; conflict: string }>> {
  const { data, error } = await supabase
    .from("fund_research")
    .select("person_key, facts, conflict, researched_at")
    .eq("firm_id", message.firm_id)
    .in("person_key", ["", message.person_key]);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  const rows = (data ?? []) as ResearchRow[];
  const fundRow = rows.find((row) => row.person_key === "" && researchIsFresh(row.researched_at));
  const personRow = rows.find((row) => row.person_key === message.person_key && researchIsFresh(row.researched_at));
  const fundFacts = fundRow ? asQuickFacts(fundRow.facts) : [];

  if (!refresh && fundRow && personRow) {
    return {
      ok: true,
      value: { facts: asQuickFacts([...asQuickFacts(personRow.facts), ...fundFacts]), conflict: fundRow.conflict ?? "" },
    };
  }

  const prompt = await loadPrompt(supabase, "core_quick_facts", { clientId, purpose: `Core Quick Facts: ${message.fund_name}` });
  if (!prompt.ok) return prompt;
  const context = [
    "## The fund",
    `Name: ${message.fund_name}`,
    fund?.website ? `Website: ${fund.website}` : "",
    fund?.fund_type ? `Type: ${fund.fund_type}` : "",
    fund?.sector_focus ? `Stated sectors: ${fund.sector_focus}` : "",
    fund?.stage_focus ? `Stated stages: ${fund.stage_focus}` : "",
    fund?.geography_focus ? `Stated geography: ${fund.geography_focus}` : "",
    fundFacts.length && !refresh ? `Fund facts already found:\n${fundFacts.map((f) => `- ${f.fact} (${f.url})`).join("\n")}` : "",
    "## The person",
    `${message.person.name || "(name unknown)"}${message.person.title ? `, ${message.person.title}` : ""}`,
    "## The company being pitched",
    companyLine,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content: [{ type: "text", text: `${context}\n\nSearch, then call ${FACTS_TOOL.name}.` }],
    tool: FACTS_TOOL,
    serverTools: [webSearchTool(RESEARCH_MAX_SEARCHES)],
    maxTokens: 3000,
    timeoutMs: STEP_TIMEOUT_MS,
  });
  if (!result.ok) return { ok: false, error: `Research failed: ${result.reason}` };

  const found = asQuickFacts(result.input.facts);
  const conflict = str(result.input.conflict, 300).trim();
  const newFund = found.filter((fact) => fact.about === "fund");
  const newPerson = found.filter((fact) => fact.about === "person");
  const fundToKeep = newFund.length > 0 ? newFund : fundFacts;
  const now = new Date().toISOString();
  const upserts = [
    { firm_id: message.firm_id, person_key: message.person_key, facts: newPerson, conflict: "", researched_at: now, searches: result.usage.webSearches },
  ];
  if (refresh || !fundRow || newFund.length > 0) {
    upserts.push({ firm_id: message.firm_id, person_key: "", facts: fundToKeep, conflict, researched_at: now, searches: 0 });
  }
  const saved = await supabase.from("fund_research").upsert(upserts, { onConflict: "firm_id,person_key" });
  if (saved.error) return { ok: false, error: tableError(saved.error.message, saved.error.code) };
  return {
    ok: true,
    value: { facts: asQuickFacts([...newPerson, ...fundToKeep]), conflict: conflict || (fundRow?.conflict ?? "") },
  };
}

// ---------------------------------------------------------------------------
// Writing one contact's emails

const EMAILS_TOOL: ClaudeTool = {
  name: "submit_contact_emails",
  description: "Deliver this person's three emails.",
  input_schema: {
    type: "object",
    properties: {
      emails: {
        type: "array",
        minItems: SEQUENCE_LENGTH,
        maxItems: SEQUENCE_LENGTH,
        items: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Plain subject. Blank on a follow-up means the same thread." },
            body: { type: "string", description: "The full email, written for this person. Sign with the founder's first name." },
          },
          required: ["subject", "body"],
        },
      },
    },
    required: ["emails"],
  },
};

function templateText(group: TypedGroupCopy) {
  return [
    `Approach: ${group.approach}`,
    ...group.emails.map(
      (email, index) => `### Email ${index + 1}${email.subject ? `\nSubject: ${email.subject}` : "\n(same thread)"}\n${email.body}`,
    ),
  ].join("\n\n");
}

async function saveMessage(supabase: ServiceClient, id: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("outreach_messages")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false as const, error: tableError(error.message, error.code) };
  if (!data) return { ok: false as const, error: "That contact no longer exists. Reload the page." };
  return { ok: true as const, value: asView(data) };
}

async function loadMessage(supabase: ServiceClient, clientId: string, id: string): Promise<Result<CoreMessageView>> {
  const { data, error } = await supabase.from("outreach_messages").select("*").eq("id", id).eq("client_id", clientId).maybeSingle();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data) return { ok: false, error: "That contact no longer exists. Reload the page." };
  return { ok: true, value: asView(data) };
}

/**
 * Researches (unless facts are fresh, or `research` is "skip") and writes one
 * active contact's emails from the Core template. Clears any approval.
 */
export async function writeCoreContact(
  supabase: ServiceClient,
  clientId: string,
  id: string,
  options: { research: "auto" | "refresh" | "skip" },
): Promise<Result<CoreMessageView>> {
  const message = await loadMessage(supabase, clientId, id);
  if (!message.ok) return message;
  if (message.value.slot !== "active") return { ok: false, error: "Activate this contact first." };
  if (message.value.pushed) return { ok: false, error: PUSHED_ERROR };
  if (!message.value.person.email) return { ok: false, error: "This contact has no email." };

  const [basis, company, styles] = await Promise.all([
    loadBasis(supabase, clientId),
    outreachCompanyContext(supabase, clientId),
    loadOutreachStyles(supabase),
  ]);
  if (!basis.ok) return basis;
  if (!company.ok) return company;
  const template = templateFor(basis.value.typed, message.value.fund_type);
  if (!template || !template.emails[0]?.body.trim()) {
    return { ok: false, error: "There is no Core template for this fund type yet. Draft the Core copy by fund type first." };
  }
  const fund = basis.value.list.rows.find((row) => row.id === message.value.firm_id);

  let facts = message.value.quick_facts;
  let conflict = message.value.conflict;
  if (options.research !== "skip" || facts.length === 0) {
    const companyLine = `${company.value.company}. ${company.value.intake.slice(0, 1500)}`;
    const found = await research(supabase, clientId, message.value, fund, companyLine, options.research === "refresh");
    if (!found.ok) {
      await saveMessage(supabase, id, { status: "error", error: found.error });
      return found;
    }
    facts = found.value.facts;
    conflict = found.value.conflict;
  }

  const prompt = await loadPrompt(supabase, "core_email", { clientId, purpose: `Core email: ${message.value.fund_name}` });
  if (!prompt.ok) return prompt;
  const preset =
    styles.styles.presets.find((item) => item.id === template.style.id) ?? presetFor(styles.styles, "core", template.type);
  const person = message.value.person;
  const context = [
    company.value.text,
    "# The Core template for this fund type",
    templateText(template),
    "# The style",
    styleInstructions(preset),
    "# Who you are writing to",
    `${person.name || "(name unknown)"}${person.title ? `, ${person.title}` : ""} at ${message.value.fund_name}`,
    `First name to use: ${person.first_name || "(unknown: open without a name, e.g. \"Hi,\")"}`,
    fund?.sector_focus ? `The fund's stated sectors: ${fund.sector_focus}` : "",
    fund?.stage_focus ? `The fund's stated stages: ${fund.stage_focus}` : "",
    "# Quick Facts",
    facts.length ? facts.map((fact) => `- (${fact.about}) ${fact.fact} [${fact.url}]`).join("\n") : "None found.",
    message.value.note ? `# Rupert's note for this contact\n${message.value.note}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callClaudeAgent<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    content: [{ type: "text", text: `${context}\n\nWrite the three emails and call ${EMAILS_TOOL.name}.` }],
    tool: EMAILS_TOOL,
    maxTokens: 3000,
    timeoutMs: STEP_TIMEOUT_MS,
  });
  if (!result.ok) {
    await saveMessage(supabase, id, { status: "error", error: `Writing failed: ${result.reason}`, quick_facts: facts, conflict });
    return { ok: false, error: `Writing failed: ${result.reason}` };
  }
  const emails = asCoreEmails(result.input.emails);
  if (emails.some((email) => !email.body.trim())) {
    await saveMessage(supabase, id, { status: "error", error: "Claude returned an incomplete sequence.", quick_facts: facts, conflict });
    return { ok: false, error: "Claude returned an incomplete sequence." };
  }
  return saveMessage(supabase, id, {
    emails,
    quick_facts: facts,
    conflict,
    status: "drafted",
    error: null,
    approved_by: null,
    approved_at: null,
    approved_hash: null,
  });
}

// ---------------------------------------------------------------------------
// Rupert's edits and approvals

export async function editCoreMessage(
  supabase: ServiceClient,
  clientId: string,
  id: string,
  edit: { emails?: CopyEmail[]; note?: string },
): Promise<Result<CoreMessageView>> {
  const message = await loadMessage(supabase, clientId, id);
  if (!message.ok) return message;
  if (message.value.pushed && edit.emails) return { ok: false, error: PUSHED_ERROR };
  const patch: Record<string, unknown> = {};
  if (edit.note !== undefined) patch.note = String(edit.note).slice(0, 2000);
  if (edit.emails) {
    const emails = asCoreEmails(edit.emails);
    patch.emails = emails;
    if (emailsHash(emails) !== emailsHash(message.value.emails)) {
      // Edited text needs approving again.
      Object.assign(patch, { status: emails.some((e) => e.body.trim()) ? "drafted" : "pending", approved_by: null, approved_at: null, approved_hash: null });
    }
  }
  return saveMessage(supabase, id, patch);
}

export async function approveCoreMessages(
  supabase: ServiceClient,
  clientId: string,
  ids: string[],
  actor: string | null,
): Promise<Result<{ approved: string[]; skipped: { id: string; reason: string }[] }>> {
  const loaded = await loadCoreMessages(supabase, clientId);
  if (!loaded.ok) return loaded;
  const styles = await loadOutreachStyles(supabase);
  const byId = new Map(loaded.value.map((message) => [message.id, message]));
  const approved: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const message = byId.get(id);
    if (!message) {
      skipped.push({ id, reason: "not found" });
      continue;
    }
    if (message.slot !== "active" || (message.status !== "drafted" && message.status !== "approved")) {
      skipped.push({ id, reason: "not written yet" });
      continue;
    }
    const cap = presetFor(styles.styles, "core", fundTypeKey(message.fund_type)).max_words;
    if (coreMessageIssues(message.emails, cap).some((issue) => issue.level === "error")) {
      skipped.push({ id, reason: "has problems to fix" });
      continue;
    }
    const saved = await saveMessage(supabase, id, {
      status: "approved",
      approved_by: actor,
      approved_at: new Date().toISOString(),
      approved_hash: emailsHash(message.emails),
    });
    if (saved.ok) approved.push(id);
    else skipped.push({ id, reason: saved.error });
  }
  return { ok: true, value: { approved, skipped } };
}

/** Moves a contact between active and reserve. A reserve made active starts unwritten. */
export async function setCoreSlot(supabase: ServiceClient, clientId: string, id: string, slot: ContactSlot): Promise<Result<CoreMessageView>> {
  const message = await loadMessage(supabase, clientId, id);
  if (!message.ok) return message;
  if (message.value.pushed) return { ok: false, error: PUSHED_ERROR };
  if (message.value.slot === slot) return message;
  return saveMessage(supabase, id, {
    slot,
    ...(slot === "reserve" ? { status: message.value.emails.some((e) => e.body.trim()) ? "drafted" : "pending", approved_by: null, approved_at: null, approved_hash: null } : {}),
  });
}
