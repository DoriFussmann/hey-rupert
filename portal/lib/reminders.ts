import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { loadEmailSettings } from "@/lib/email-settings";
import {
  REMINDER_STEPS,
  isReminderTurnKey,
  type ReminderTiming,
  type ReminderTurnKey,
} from "@/lib/email-templates";
import { clientDisplayName, formatDate } from "@/lib/format";
import {
  notifyAdmin,
  notifyAdminOnce,
  renderClientReminder,
  sendClientReminder,
  type PendingClientTurn,
} from "@/lib/notify";
import { isKickoffReady } from "@/lib/service-order";
import { getSetupItems, type SetupStepState } from "@/lib/setup";
import { loadSetupSteps } from "@/lib/setup-server";

type ServiceClient = ReturnType<typeof createServiceClient>;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Minimum gap between two reminders for the same turn, so a turn that was
 * already old when reminders started does not get several emails in a row.
 */
const MIN_GAP_HOURS = 20;

type Turn = PendingClientTurn & { key: ReminderTurnKey };

/** When the active Statement of Work / Service Order was pushed. */
export type ActiveSends = {
  sowSentAt?: string | null;
  serviceOrderSentAt?: string | null;
};

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

/**
 * Every turn currently waiting on the client: the Statement of Work and the
 * Service Order & Setup Fee before kick-off, then the NDA, the intake and
 * the Setup steps. Whether each one is reminded is set per step in
 * Forms → Emails.
 */
export function pendingClientTurns(
  row: Record<string, unknown> & { setup_steps?: SetupStepState[] },
  sends: ActiveSends = {},
): Turn[] {
  if (row.archived_at) return [];

  const turns: Turn[] = [];
  const orderAt = text(row.service_order_agreed_at);
  const paidAt = text(row.payment_received_at);
  const kickedOff = isKickoffReady({
    service_order_agreed_at: orderAt || null,
    payment_received_at: paidAt || null,
  });

  if (
    sends.sowSentAt &&
    text(row.statement_of_work_content) &&
    !text(row.sow_confirmed_at)
  ) {
    turns.push({
      key: "sow",
      task: "review and confirm your Statement of Work",
      path: "/portal/statement-of-work",
      since: sends.sowSentAt,
    });
  }

  if (sends.serviceOrderSentAt && text(row.service_order_content) && !kickedOff) {
    turns.push({
      key: "service_order",
      task:
        !orderAt && !paidAt
          ? "sign the Service Order and pay the Setup Fee"
          : !orderAt
            ? "sign the Service Order"
            : "pay the Setup Fee",
      path: "/portal/service-order",
      since: sends.serviceOrderSentAt,
    });
  }

  if (!kickedOff) return turns;

  const ndaSentAt = text(row.nda_sent_at);
  const ndaSignedAt = text(row.nda_signed_at);
  const intakeAt = text(row.intake_completed_at);

  if (ndaSentAt && !ndaSignedAt) {
    turns.push({
      key: "nda",
      task: "sign your NDA",
      path: "/portal/nda",
      since: ndaSentAt,
    });
  }

  if (ndaSignedAt && !intakeAt) {
    turns.push({
      key: "intake",
      task: "complete your intake interview with Rupert and share your deck",
      path: "/portal/intake",
      since: ndaSignedAt,
    });
  }

  if (intakeAt) {
    const materials = (row.setup_steps ?? []).find((item) => item.step === "materials");
    if (!materials || materials.status !== "submitted") {
      const sentBack = Boolean(materials && materials.version > 0 && materials.turn_since);
      turns.push({
        key: "setup:materials",
        task: "share your pitch deck and company materials",
        path: "/portal/materials",
        since: sentBack ? materials!.turn_since! : intakeAt,
      });
    }

    for (const item of getSetupItems({
      stage: text(row.stage) || null,
      intake_completed_at: intakeAt,
      setup_steps: row.setup_steps ?? [],
    })) {
      const key = `setup:${item.id}`;
      if (item.status !== "your_turn" || !item.since) continue;
      if (!isReminderTurnKey(key)) continue;
      turns.push({
        key,
        task: item.clientTask,
        path: item.href,
        since: item.since,
      });
    }
  }

  return turns;
}

type ReminderRecord = {
  turn_key: string;
  turn_since: string;
  sent_count: number;
  last_sent_at: string | null;
  stalled_alert_at: string | null;
};

function sameInstant(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  return Date.parse(a) === Date.parse(b);
}

/** When reminder number `count + 1` is due, in ms. */
export function reminderDueAt(sinceMs: number, count: number, timing: ReminderTiming) {
  return sinceMs + timing.first_after_days * DAY + timing.every_days * DAY * count;
}

export type ReminderRun = {
  checked: number;
  /** Always empty now: reminders wait for Rupert to send them. Kept for the run report. */
  emailed: { client: string; turns: string[] }[];
  /** Clients with a reminder ready to send under Nudge. */
  ready: { client: string; turns: string[] }[];
  stalled: { client: string; turns: string[] }[];
  errors: string[];
};

/** Active (not archived) send dates per client, from one sends table. */
export async function activeSendDates(
  supabase: ServiceClient,
  table: "statement_of_work_sends" | "service_order_sends",
  ids: string[],
  errors: string[],
) {
  const dates = new Map<string, string>();
  const { data, error } = await supabase
    .from(table)
    .select("client_id, sent_at")
    .in("client_id", ids)
    .is("archived_at", null);

  if (error) {
    errors.push(`Loading ${table} failed: ${error.message}`);
    return dates;
  }
  for (const row of data ?? []) {
    if (row.sent_at) dates.set(String(row.client_id), String(row.sent_at));
  }
  return dates;
}

type DueTurn = Turn & { count: number; max: number };

/** One client's reminders: the ones due now and the ones that ran out (for the stall alert). */
type ReminderPlan = {
  clientId: string;
  name: string;
  row: Record<string, unknown>;
  due: DueTurn[];
  stalled: (Turn & { max: number })[];
};

/**
 * Works out, for every active client (or one), which reminders are due now,
 * from each step's schedule in Forms → Emails (first reminder, repeat
 * interval, maximum). Clients with automatic emails paused are left out.
 */
async function planReminders(supabase: ServiceClient, now: Date, onlyClientId?: string) {
  const errors: string[] = [];
  const plans: ReminderPlan[] = [];

  let query = supabase.from("clients").select("*").is("archived_at", null);
  if (onlyClientId) query = query.eq("id", onlyClientId);
  const { data: clients, error } = await query;
  if (error) {
    errors.push(`Loading clients failed: ${error.message}`);
    return { plans, errors, settings: null };
  }

  const active = (clients ?? []).filter((client) => client.emails_paused !== true);
  const settings = await loadEmailSettings(supabase);
  if (settings.error) errors.push(`Email settings: ${settings.error}`);
  if (active.length === 0) return { plans, errors, settings };

  const ids = active.map((client) => String(client.id));
  const [setup, sowSends, orderSends] = await Promise.all([
    loadSetupSteps(supabase, ids),
    activeSendDates(supabase, "statement_of_work_sends", ids, errors),
    activeSendDates(supabase, "service_order_sends", ids, errors),
  ]);

  const { data: records, error: recordsError } = await supabase.from("turn_reminders").select("*").in("client_id", ids);
  if (recordsError) {
    errors.push(`Loading reminders failed: ${recordsError.message}. Run portal/supabase/setup_phase.sql in Supabase.`);
    return { plans, errors, settings };
  }

  const byClient = new Map<string, Map<string, ReminderRecord>>();
  for (const record of records ?? []) {
    const clientId = String(record.client_id);
    const map = byClient.get(clientId) ?? new Map<string, ReminderRecord>();
    map.set(String(record.turn_key), {
      turn_key: String(record.turn_key),
      turn_since: String(record.turn_since),
      sent_count: Number(record.sent_count) || 0,
      last_sent_at: record.last_sent_at ? String(record.last_sent_at) : null,
      stalled_alert_at: record.stalled_alert_at ? String(record.stalled_alert_at) : null,
    });
    byClient.set(clientId, map);
  }

  const nowMs = now.getTime();
  for (const client of active) {
    const clientId = String(client.id);
    const row = { ...(client as Record<string, unknown>), setup_steps: setup.get(clientId) ?? [] };
    const turns = pendingClientTurns(row, {
      sowSentAt: sowSends.get(clientId) ?? null,
      serviceOrderSentAt: orderSends.get(clientId) ?? null,
    }).filter((turn) => settings.timings[turn.key].enabled);
    if (turns.length === 0) continue;

    const recordsFor = byClient.get(clientId) ?? new Map<string, ReminderRecord>();
    const due: DueTurn[] = [];
    const stalled: (Turn & { max: number })[] = [];
    for (const turn of turns) {
      const timing = settings.timings[turn.key];
      const record = recordsFor.get(turn.key);
      const current = record && sameInstant(record.turn_since, turn.since);
      const count = current ? record.sent_count : 0;
      const lastSent = current ? record.last_sent_at : null;
      const sinceMs = Date.parse(turn.since);
      if (Number.isNaN(sinceMs)) continue;
      if (count < timing.max_reminders) {
        const gapOk = !lastSent || nowMs - Date.parse(lastSent) >= MIN_GAP_HOURS * HOUR;
        if (nowMs >= reminderDueAt(sinceMs, count, timing) && gapOk) due.push({ ...turn, count, max: timing.max_reminders });
      } else if (
        timing.stall_alert &&
        !(current && record.stalled_alert_at) &&
        lastSent &&
        nowMs - Date.parse(lastSent) >= timing.every_days * DAY
      ) {
        stalled.push({ ...turn, max: timing.max_reminders });
      }
    }
    plans.push({ clientId, name: clientDisplayName(row), row, due, stalled });
  }
  return { plans, errors, settings };
}

async function recordReminders(supabase: ServiceClient, clientId: string, due: DueTurn[], at: string) {
  const { error } = await supabase.from("turn_reminders").upsert(
    due.map((turn) => ({
      client_id: clientId,
      turn_key: turn.key,
      turn_since: turn.since,
      sent_count: turn.count + 1,
      last_sent_at: at,
      stalled_alert_at: null,
      updated_at: at,
    })),
    { onConflict: "client_id,turn_key" },
  );
  return error ? error.message : null;
}

/**
 * The daily check. Nothing goes to a client from here: reminders that are due
 * wait under Nudge → Ready to send until Rupert clicks Send. Rupert gets an
 * in-app notification when a client has one ready, and (unchanged) one
 * "stalled" alert once a step's reminders have run out.
 */
export async function runClientReminders(supabase: ServiceClient, now = new Date()): Promise<ReminderRun> {
  const run: ReminderRun = { checked: 0, emailed: [], ready: [], stalled: [], errors: [] };
  const planned = await planReminders(supabase, now);
  run.errors.push(...planned.errors);
  const nowIso = now.toISOString();

  for (const plan of planned.plans) {
    run.checked += 1;
    if (plan.due.length > 0) {
      run.ready.push({ client: plan.name, turns: plan.due.map((turn) => turn.task) });
      await notifyAdminOnce(supabase, plan.clientId, "nudge_ready", { email: false });
    }
    if (plan.stalled.length > 0) {
      const details = [
        "Still waiting after the last reminder:",
        ...plan.stalled.map(
          (turn) =>
            `- ${turn.task} (${turn.max} reminder${turn.max === 1 ? "" : "s"}, waiting since ${formatDate(turn.since)})`,
        ),
        "Consider a personal email or a call.",
      ].join("\n");
      await notifyAdmin(supabase, plan.clientId, "client_stalled", { email: true, details });
      run.stalled.push({ client: plan.name, turns: plan.stalled.map((turn) => turn.task) });
      const { error: stallError } = await supabase
        .from("turn_reminders")
        .update({ stalled_alert_at: nowIso, updated_at: nowIso })
        .eq("client_id", plan.clientId)
        .in(
          "turn_key",
          plan.stalled.map((turn) => turn.key),
        );
      if (stallError) run.errors.push(`${plan.name}: stalled flag failed: ${stallError.message}`);
    }
  }
  return run;
}

export type ReadyNudge = {
  clientId: string;
  name: string;
  company: string;
  steps: { label: string; task: string; since: string; reminder: number; max: number }[];
  /** The email as it will go out. */
  email: { to: string; subject: string; body: string } | null;
  problem: string | null;
};

/** Reminders due now, each ready to send with one click. */
export async function listReadyNudges(supabase: ServiceClient, now = new Date()) {
  const planned = await planReminders(supabase, now);
  const nudges: ReadyNudge[] = [];
  for (const plan of planned.plans) {
    if (plan.due.length === 0 || !planned.settings) continue;
    const rendered = renderClientReminder(planned.settings, plan.row, plan.due, {
      lastAttempt: plan.due.some((turn) => turn.count + 1 >= turn.max),
    });
    nudges.push({
      clientId: plan.clientId,
      name: plan.name,
      company: text(plan.row.company_name),
      steps: plan.due.map((turn) => ({
        label: REMINDER_STEPS.find((step) => step.key === turn.key)?.label ?? turn.key,
        task: turn.task,
        since: turn.since,
        reminder: turn.count + 1,
        max: turn.max,
      })),
      email: rendered.ok ? { to: rendered.to, subject: rendered.subject, body: rendered.body } : null,
      problem: rendered.ok ? null : rendered.reason,
    });
  }
  return { nudges, errors: planned.errors };
}

/**
 * Send (or skip) the reminder due now for one client. Worked out again at the
 * moment of the click, so it is never stale or sent twice. Skip counts it as
 * done without emailing: the next one follows on the step's schedule.
 */
export async function settleReadyNudge(
  supabase: ServiceClient,
  clientId: string,
  decision: "send" | "skip",
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const planned = await planReminders(supabase, now, clientId);
  const plan = planned.plans[0];
  if (!plan || plan.due.length === 0 || !planned.settings) {
    return { ok: false, error: planned.errors[0] ?? "Nothing is due for this client any more." };
  }
  if (decision === "send") {
    const sent = await sendClientReminder(supabase, planned.settings, plan.row, plan.due, {
      lastAttempt: plan.due.some((turn) => turn.count + 1 >= turn.max),
    });
    if (!sent.ok) return { ok: false, error: sent.reason };
  }
  const recordError = await recordReminders(supabase, clientId, plan.due, now.toISOString());
  await supabase.from("notifications").update({ read: true }).eq("client_id", clientId).eq("type", "nudge_ready");
  if (recordError) return { ok: false, error: `${decision === "send" ? "Sent, but not" : "Not"} recorded: ${recordError}` };
  return { ok: true };
}
