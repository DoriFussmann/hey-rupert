import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
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

/** First reminder 24h after the turn starts, then every 24h. */
export const REMINDER_INTERVAL_HOURS = 24;
/** Reminders per turn before Rupert gets a "client stalled" alert instead. */
export const REMINDER_MAX = 3;
/**
 * Minimum gap between two reminders for the same turn, so a turn that was
 * already old when reminders started does not get several emails in a row.
 */
const MIN_GAP_HOURS = 20;

type Turn = PendingClientTurn & { key: string };

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

/**
 * Every turn currently waiting on the client, once kick-off has happened
 * (Service Order signed and Setup Fee paid). Before kick-off there are no
 * reminders.
 */
export function pendingClientTurns(
  row: Record<string, unknown> & { setup_steps?: SetupStepState[] },
): Turn[] {
  if (row.archived_at) return [];
  if (
    !isKickoffReady({
      service_order_agreed_at: text(row.service_order_agreed_at) || null,
      payment_received_at: text(row.payment_received_at) || null,
    })
  ) {
    return [];
  }

  const turns: Turn[] = [];
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
      if (item.status !== "your_turn" || !item.since) continue;
      turns.push({
        key: `setup:${item.id}`,
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

export type ReminderRun = {
  checked: number;
  emailed: { client: string; turns: string[] }[];
  stalled: { client: string; turns: string[] }[];
  errors: string[];
};

/**
 * Sends due reminders. Safe to run as often as you like (hourly or daily):
 * each turn gets at most REMINDER_MAX emails, spaced at least a day apart,
 * then one "stalled" alert to Rupert. A client with several waiting turns
 * gets one combined email.
 */
export async function runClientReminders(
  supabase: ServiceClient,
  now = new Date(),
): Promise<ReminderRun> {
  const run: ReminderRun = { checked: 0, emailed: [], stalled: [], errors: [] };

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .is("archived_at", null)
    .not("service_order_agreed_at", "is", null)
    .not("payment_received_at", "is", null);

  if (error) {
    run.errors.push(`Loading clients failed: ${error.message}`);
    return run;
  }
  if (!clients || clients.length === 0) return run;

  const ids = clients.map((client) => String(client.id));
  const setup = await loadSetupSteps(supabase, ids);

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

  for (const client of clients) {
    const clientId = String(client.id);
    const row = {
      ...(client as Record<string, unknown>),
      setup_steps: setup.get(clientId) ?? [],
    };
    const turns = pendingClientTurns(row);
    if (turns.length === 0) continue;
    run.checked += 1;

    const records = byClient.get(clientId) ?? new Map<string, ReminderRecord>();
    const due: (Turn & { count: number })[] = [];
    const stalled: Turn[] = [];

    for (const turn of turns) {
      const record = records.get(turn.key);
      const current = record && sameInstant(record.turn_since, turn.since);
      const count = current ? record.sent_count : 0;
      const lastSent = current ? record.last_sent_at : null;
      const sinceMs = Date.parse(turn.since);
      if (Number.isNaN(sinceMs)) continue;

      if (count < REMINDER_MAX) {
        const dueAt = sinceMs + REMINDER_INTERVAL_HOURS * HOUR * (count + 1);
        const gapOk =
          !lastSent || nowMs - Date.parse(lastSent) >= MIN_GAP_HOURS * HOUR;
        if (nowMs >= dueAt && gapOk) due.push({ ...turn, count });
      } else if (
        !(current && record.stalled_alert_at) &&
        lastSent &&
        nowMs - Date.parse(lastSent) >= REMINDER_INTERVAL_HOURS * HOUR
      ) {
        stalled.push(turn);
      }
    }

    const name = clientDisplayName(row);

    if (due.length > 0) {
      const attempt = Math.max(...due.map((turn) => turn.count)) + 1;
      const result = await sendClientReminder(row, due, {
        attempt,
        max: REMINDER_MAX,
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
        `Still waiting after ${REMINDER_MAX} reminders:`,
        ...stalled.map(
          (turn) => `- ${turn.task} (waiting since ${formatDate(turn.since)})`,
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
