import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { isClaudeConfigured } from "@/lib/anthropic";
import { draftNudgeMiddle } from "@/lib/agents-server";
import type { PromptOverride } from "@/lib/prompts";
import type { EmailResult } from "@/lib/email";
import { listEmailLog, sendClientEmail, type EmailLogEntry } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import { REMINDER_STEPS, renderEmail, tidyBody, type ReminderTurnKey } from "@/lib/email-templates";
import { clientDisplayName, formatDateAtTime } from "@/lib/format";
import { clientAddress, firstNameOf, greetingFor } from "@/lib/notify";
import {
  daysSince,
  nudgeTemplateKey,
  type NudgeClientSummary,
  type NudgeDetail,
  type NudgeHistoryEntry,
  type NudgeOurItem,
  type NudgeTurn,
} from "@/lib/nudge";
import { ONBOARDING_STEPS, getOnboardingItems } from "@/lib/onboarding";
import { PORTAL_URL } from "@/lib/portal-url";
import { nextTurn, type ProgressSource } from "@/lib/progress";
import { activeSendDates, pendingClientTurns } from "@/lib/reminders";
import {
  EMAIL_BODY_MAX,
  EMAIL_SUBJECT_MAX,
  getSetupItems,
  isSetupStepId,
  type ClientEmailDraft,
  type SetupStepState,
} from "@/lib/setup";
import { loadSetupSteps } from "@/lib/setup-server";
import { ENGAGEMENT_STAGES } from "@/lib/types";

type ServiceClient = ReturnType<typeof createServiceClient>;
type ClientRow = Record<string, unknown> & { setup_steps: SetupStepState[] };
type Sends = { sowSentAt: string | null; serviceOrderSentAt: string | null };

export type NudgeResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export const NUDGE_PAUSED_NOTE =
  "Automatic emails are paused for this client. A nudge still goes out, because you send it yourself.";

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

function stageLabel(stage: string) {
  return ENGAGEMENT_STAGES.find((item) => item.value === stage)?.label ?? (stage || "—");
}

function turnLabel(key: ReminderTurnKey) {
  return REMINDER_STEPS.find((step) => step.key === key)?.label ?? key;
}

/** Facts about a Setup step the client has in front of them. */
function setupFacts(row: SetupStepState | undefined) {
  if (!row || row.version === 0) return [];
  const facts = [
    `Version ${row.version}${row.published_at ? ` shared ${formatDateAtTime(row.published_at)}` : ""}`,
    row.client_viewed_at
      ? `opened ${formatDateAtTime(row.client_viewed_at)}`
      : "not opened yet",
  ];
  const previous = row.history.find((entry) => entry.version === row.version - 1);
  if (previous?.response?.decision === "changes_requested") {
    facts.push("this version answers the changes they asked for");
  }
  return facts;
}

function summarize(row: ClientRow, sends: Sends, now: Date): NudgeClientSummary {
  const clientTurns: NudgeTurn[] = pendingClientTurns(row, sends).map((turn) => {
    const step = turn.key.startsWith("setup:") ? turn.key.slice("setup:".length) : "";
    const setupRow = isSetupStepId(step)
      ? row.setup_steps.find((item) => item.step === step)
      : undefined;
    return {
      key: turn.key,
      label: turnLabel(turn.key),
      task: turn.task,
      path: turn.path,
      since: turn.since,
      days: daysSince(turn.since, now) ?? 0,
      facts: setupFacts(setupRow),
    };
  });

  const ourItems: NudgeOurItem[] = [];
  for (const item of getOnboardingItems(row)) {
    if (item.status === "waiting") {
      ourItems.push({ action: ONBOARDING_STEPS[item.id].adminAction, since: null, days: null });
    }
  }
  for (const item of getSetupItems(row)) {
    if (item.status === "waiting") {
      ourItems.push({ action: item.adminAction, since: item.since, days: daysSince(item.since, now) });
    }
  }
  if (ourItems.length === 0) {
    const turn = nextTurn(row as ProgressSource);
    if (turn.owner === "admin") ourItems.push({ action: turn.action, since: null, days: null });
  }

  return {
    id: text(row.id),
    name: clientDisplayName(row),
    company: text(row.company_name),
    stageLabel: stageLabel(text(row.stage)),
    clientTurns,
    ourItems,
  };
}

/** Active clients (not archived, not the Match Sandbox) with their Setup rows and send dates. */
async function loadClients(supabase: ServiceClient, clientId?: string) {
  let query = supabase.from("clients").select("*").is("archived_at", null);
  if (clientId) query = query.eq("id", clientId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return { ok: false as const, error: error.message };

  const clients = (data ?? []).filter(
    (row) => (row as Record<string, unknown>).is_match_sandbox !== true,
  ) as Record<string, unknown>[];
  const ids = clients.map((row) => text(row.id));
  const errors: string[] = [];
  const [setup, sowSends, orderSends] = await Promise.all([
    loadSetupSteps(supabase, ids),
    activeSendDates(supabase, "statement_of_work_sends", ids, errors),
    activeSendDates(supabase, "service_order_sends", ids, errors),
  ]);

  return {
    ok: true as const,
    errors,
    clients: clients.map((row) => {
      const id = text(row.id);
      return {
        row: { ...row, setup_steps: setup.get(id) ?? [] } as ClientRow,
        sends: { sowSentAt: sowSends.get(id) ?? null, serviceOrderSentAt: orderSends.get(id) ?? null },
      };
    }),
  };
}

/** Every active client: whose turn it is, longest client wait first. */
export async function loadNudgeOverview(
  supabase: ServiceClient,
): Promise<NudgeResult<{ clients: NudgeClientSummary[]; warnings: string[] }>> {
  const loaded = await loadClients(supabase);
  if (!loaded.ok) return loaded;
  const now = new Date();
  const longestWait = (client: NudgeClientSummary) =>
    Math.max(-1, ...client.clientTurns.map((turn) => turn.days));
  const clients = loaded.clients
    .map(({ row, sends }) => summarize(row, sends, now))
    .sort((a, b) => {
      const wait = longestWait(b) - longestWait(a);
      if (wait !== 0) return wait;
      if (a.ourItems.length !== b.ourItems.length) return b.ourItems.length - a.ourItems.length;
      return a.name.localeCompare(b.name);
    });
  return { ok: true, clients, warnings: loaded.errors };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Nudges for this step, and automatic reminders that linked to it (the
 * reminder email lists each waiting step with its portal link).
 */
function historyFor(turn: NudgeTurn, entries: EmailLogEntry[]): NudgeHistoryEntry[] {
  const link = new RegExp(`${escapeRegExp(`${PORTAL_URL}${turn.path}`)}(?![\\w/#-])`);
  const since = Date.parse(turn.since);
  return entries
    .filter(
      (entry) =>
        entry.template_key === nudgeTemplateKey(turn.key) ||
        (entry.kind === "reminder" && link.test(entry.body)),
    )
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind === "reminder" ? ("reminder" as const) : ("nudge" as const),
      subject: entry.subject,
      body: entry.body,
      status: entry.status,
      created_at: entry.created_at,
      thisRound: !Number.isNaN(since) && Date.parse(entry.created_at) >= since,
    }));
}

export async function loadNudgeDetail(
  supabase: ServiceClient,
  clientId: string,
): Promise<NudgeResult<{ detail: NudgeDetail }>> {
  const loaded = await loadClients(supabase, clientId);
  if (!loaded.ok) return loaded;
  const found = loaded.clients[0];
  if (!found) return { ok: false, error: "Client not found, or archived." };

  const summary = summarize(found.row, found.sends, new Date());
  const log = summary.clientTurns.length > 0 ? await listEmailLog(supabase, clientId, 300) : null;
  const history: Record<string, NudgeHistoryEntry[]> = {};
  for (const turn of summary.clientTurns) {
    history[turn.key] = log?.ok ? historyFor(turn, log.entries) : [];
  }

  return {
    ok: true,
    detail: {
      ...summary,
      email: clientAddress(found.row),
      firstName: firstNameOf(found.row),
      paused: found.row.emails_paused === true,
      history,
      historyError: log && !log.ok ? log.error : null,
    },
  };
}

async function waitingTurn(supabase: ServiceClient, clientId: string, key: string) {
  const loaded = await loadNudgeDetail(supabase, clientId);
  if (!loaded.ok) return loaded;
  const turn = loaded.detail.clientTurns.find((item) => item.key === key);
  if (!turn) {
    return {
      ok: false as const,
      error: "This step is no longer waiting on the client. Refresh the page.",
    };
  }
  return { ok: true as const, detail: loaded.detail, turn };
}

function historyText(entries: NudgeHistoryEntry[]) {
  const sent = entries.filter((entry) => entry.status === "sent");
  if (sent.length === 0) return "None. This is the first nudge for this step.";
  const lines = sent.map(
    (entry) =>
      `- ${entry.kind === "nudge" ? "Personal nudge from Rupert" : "Automatic reminder"}, ${formatDateAtTime(entry.created_at)}${entry.thisRound ? "" : " (an earlier round of this step)"}`,
  );
  return [
    `${sent.length} sent so far:`,
    ...lines,
    `The most recent one said:\n${sent[0].body.slice(0, 1500)}`,
  ].join("\n");
}

/**
 * A nudge for one waiting step: the middle by Claude (or the reminder wording
 * from Forms → Emails when Claude is not set up), with the greeting, portal
 * link and signature around it.
 */
export async function draftNudge(
  supabase: ServiceClient,
  clientId: string,
  key: string,
  override?: PromptOverride | null,
): Promise<NudgeResult<{ email: ClientEmailDraft; pausedNote: string | null }>> {
  const found = await waitingTurn(supabase, clientId, key);
  if (!found.ok) return found;
  const { detail, turn } = found;
  if (!detail.email) return { ok: false, error: "This client has no email address." };

  const settings = await loadEmailSettings(supabase);
  const portalLink = `${PORTAL_URL}${turn.path}`;
  const pausedNote = detail.paused ? NUDGE_PAUSED_NOTE : null;
  const row = { first_name: detail.firstName };

  if (!isClaudeConfigured()) {
    const rendered = renderEmail(settings.templates.reminder, {
      greeting: greetingFor(row),
      first_name: detail.firstName,
      company: detail.company,
      task_summary: turn.task,
      task_links: `Open your portal: ${portalLink}`,
      closing: "If something is holding you up, just reply to this email or book a call — happy to help.",
      signature: settings.signature,
    });
    return { ok: true, email: { subject: rendered.subject, body: rendered.body }, pausedNote };
  }

  const others = detail.clientTurns.filter((item) => item.key !== turn.key);
  const context = [
    `Founder: ${detail.firstName || "unknown"}`,
    `Company: ${detail.company}`,
    `Stage: ${detail.stageLabel}`,
    "## Waiting on the founder",
    `${turn.label}: they need to ${turn.task}.`,
    `Waiting since ${formatDateAtTime(turn.since)} (${turn.days} day${turn.days === 1 ? "" : "s"}).`,
    turn.facts.length > 0 ? `Status: ${turn.facts.join("; ")}.` : "",
    "## Nudges and reminders already sent for this step",
    historyText(detail.history[turn.key] ?? []),
    others.length > 0
      ? `## Also waiting on them (mention only in passing, if at all)\n${others.map((item) => `- ${item.label}: ${item.task}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const drafted = await draftNudgeMiddle(supabase, clientId, context, override);
  if (!drafted.ok) return drafted;

  return {
    ok: true,
    pausedNote,
    email: {
      subject: drafted.value.subject.trim() || `${turn.label}: waiting on you`,
      body: tidyBody(
        [
          greetingFor(row),
          drafted.value.body,
          `Open your portal: ${portalLink}`,
          settings.signature,
        ].join("\n\n"),
      ),
    },
  };
}

/**
 * Sends the nudge as Rupert wrote it, logs it in the client's email history
 * and counts it as a reminder for the step, so the automatic reminder does
 * not follow a day later.
 */
export async function sendNudge(
  supabase: ServiceClient,
  clientId: string,
  key: string,
  email: ClientEmailDraft,
): Promise<NudgeResult<{ sent: EmailResult; warning: string | null }>> {
  const subject = text(email?.subject).replace(/\s+/g, " ");
  const body = text(email?.body);
  if (!subject) return { ok: false, error: "Add a subject." };
  if (!body) return { ok: false, error: "Write the email first." };
  if (subject.length > EMAIL_SUBJECT_MAX || body.length > EMAIL_BODY_MAX) {
    return { ok: false, error: "The email is too long." };
  }

  const found = await waitingTurn(supabase, clientId, key);
  if (!found.ok) return found;
  const { detail, turn } = found;
  if (!detail.email) return { ok: false, error: "This client has no email address." };

  const sent = await sendClientEmail(supabase, {
    clientId,
    kind: "manual",
    templateKey: nudgeTemplateKey(turn.key),
    to: [detail.email],
    subject,
    text: body,
  });
  if (!sent.ok) return { ok: true, sent, warning: null };

  return { ok: true, sent, warning: await countAsReminder(supabase, clientId, turn) };
}

/** Records the nudge on the step's reminder schedule. Returns a warning on failure. */
async function countAsReminder(supabase: ServiceClient, clientId: string, turn: NudgeTurn) {
  const at = new Date().toISOString();
  const { data, error } = await supabase
    .from("turn_reminders")
    .select("turn_since, sent_count, stalled_alert_at")
    .eq("client_id", clientId)
    .eq("turn_key", turn.key)
    .maybeSingle();
  if (error) {
    return `Sent, but the reminder schedule was not updated: ${error.message}`;
  }
  const sameRound = data && Date.parse(String(data.turn_since)) === Date.parse(turn.since);
  const { error: saveError } = await supabase.from("turn_reminders").upsert(
    {
      client_id: clientId,
      turn_key: turn.key,
      turn_since: turn.since,
      sent_count: (sameRound ? Number(data.sent_count) || 0 : 0) + 1,
      last_sent_at: at,
      stalled_alert_at: sameRound ? (data.stalled_alert_at ?? null) : null,
      updated_at: at,
    },
    { onConflict: "client_id,turn_key" },
  );
  return saveError
    ? `Sent, but the reminder schedule was not updated: ${saveError.message}`
    : null;
}
