import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { loadEmailSettings } from "@/lib/email-settings";
import {
  isReminderTurnKey,
  type ReminderTiming,
  type ReminderTurnKey,
} from "@/lib/email-templates";
import { clientDisplayName, formatDate } from "@/lib/format";
import {
  notifyAdmin,
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
      task: "complete your intake interview with Rupert",
      path: "/portal/intake",
      since: ndaSignedAt,
    });
  }

  if (intakeAt) {
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
  emailed: { client: string; turns: string[] }[];
  stalled: { client: string; turns: string[] }[];
  errors: string[];
};

/** Active (not archived) send dates per client, from one sends table. */
async function activeSendDates(
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

/**
 * Sends due reminders. Safe to run as often as you like (hourly or daily):
 * each step follows its own schedule from Forms → Emails (first reminder,
 * repeat interval, maximum), then optionally one "stalled" alert to Rupert.
 * A client with several waiting steps gets one combined email. Clients with
 * automatic emails paused are skipped.
 */
export async function runClientReminders(
  supabase: ServiceClient,
  now = new Date(),
): Promise<ReminderRun> {
  const run: ReminderRun = { checked: 0, emailed: [], stalled: [], errors: [] };

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .is("archived_at", null);

  if (error) {
    run.errors.push(`Loading clients failed: ${error.message}`);
    return run;
  }

  const active = (clients ?? []).filter((client) => client.emails_paused !== true);
  if (active.length === 0) return run;

  const settings = await loadEmailSettings(supabase);
  if (settings.error) run.errors.push(`Email settings: ${settings.error}`);

  const ids = active.map((client) => String(client.id));
  const [setup, sowSends, orderSends] = await Promise.all([
    loadSetupSteps(supabase, ids),
    activeSendDates(supabase, "statement_of_work_sends", ids, run.errors),
    activeSendDates(supabase, "service_order_sends", ids, run.errors),
  ]);

  const { data: records, error: recordsError } = await supabase
    .from("turn_reminders")
    .select("*")
    .in("client_id", ids);

  if (recordsError) {
    run.errors.push(
      `Loading reminders failed: ${recordsError.message}. Run portal/supabase/setup_phase.sql in Supabase.`,
    );
    return run;
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
      stalled_alert_at: record.stalled_alert_at
        ? String(record.stalled_alert_at)
        : null,
    });
    byClient.set(clientId, map);
  }

  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  for (const client of active) {
    const clientId = String(client.id);
    const row = {
      ...(client as Record<string, unknown>),
      setup_steps: setup.get(clientId) ?? [],
    };
    const turns = pendingClientTurns(row, {
      sowSentAt: sowSends.get(clientId) ?? null,
      serviceOrderSentAt: orderSends.get(clientId) ?? null,
    }).filter((turn) => settings.timings[turn.key].enabled);
    if (turns.length === 0) continue;
    run.checked += 1;

    const records = byClient.get(clientId) ?? new Map<string, ReminderRecord>();
    const due: (Turn & { count: number; max: number })[] = [];
    const stalled: (Turn & { max: number })[] = [];

    for (const turn of turns) {
      const timing = settings.timings[turn.key];
      const record = records.get(turn.key);
      const current = record && sameInstant(record.turn_since, turn.since);
      const count = current ? record.sent_count : 0;
      const lastSent = current ? record.last_sent_at : null;
      const sinceMs = Date.parse(turn.since);
      if (Number.isNaN(sinceMs)) continue;

      if (count < timing.max_reminders) {
        const gapOk =
          !lastSent || nowMs - Date.parse(lastSent) >= MIN_GAP_HOURS * HOUR;
        if (nowMs >= reminderDueAt(sinceMs, count, timing) && gapOk) {
          due.push({ ...turn, count, max: timing.max_reminders });
        }
      } else if (
        timing.stall_alert &&
        !(current && record.stalled_alert_at) &&
        lastSent &&
        nowMs - Date.parse(lastSent) >= timing.every_days * DAY
      ) {
        stalled.push({ ...turn, max: timing.max_reminders });
      }
    }

    const name = clientDisplayName(row);

    if (due.length > 0) {
      const result = await sendClientReminder(supabase, settings, row, due, {
        lastAttempt: due.some((turn) => turn.count + 1 >= turn.max),
      });
      if (!result.ok) {
        run.errors.push(`${name}: ${result.reason}`);
      } else {
        run.emailed.push({ client: name, turns: due.map((turn) => turn.task) });
        const { error: upsertError } = await supabase.from("turn_reminders").upsert(
          due.map((turn) => ({
            client_id: clientId,
            turn_key: turn.key,
            turn_since: turn.since,
            sent_count: turn.count + 1,
            last_sent_at: nowIso,
            stalled_alert_at: null,
            updated_at: nowIso,
          })),
          { onConflict: "client_id,turn_key" },
        );
        if (upsertError) {
          run.errors.push(`${name}: reminder log failed: ${upsertError.message}`);
        }
      }
    }

    if (stalled.length > 0) {
      const details = [
        "Still waiting after the last reminder:",
        ...stalled.map(
          (turn) =>
            `- ${turn.task} (${turn.max} reminder${turn.max === 1 ? "" : "s"}, waiting since ${formatDate(turn.since)})`,
        ),
        "Consider a personal email or a call.",
      ].join("\n");
      await notifyAdmin(supabase, clientId, "client_stalled", {
        email: true,
        details,
      });
      run.stalled.push({ client: name, turns: stalled.map((turn) => turn.task) });
      const { error: stallError } = await supabase
        .from("turn_reminders")
        .update({ stalled_alert_at: nowIso, updated_at: nowIso })
        .eq("client_id", clientId)
        .in(
          "turn_key",
          stalled.map((turn) => turn.key),
        );
      if (stallError) {
        run.errors.push(`${name}: stalled flag failed: ${stallError.message}`);
      }
    }
  }

  return run;
}
