// Pre-send email check: the rules, kept pure so they can be tested.
//
// Every evening before a Business Day, the contacts the next morning's batch
// will add are checked. Only a contact that passes is added to Instantly.
// Layers, cheapest first; each runs only when the ones before didn't settle it:
//   1. Proof from our own sends: replied, or delivered in the last 180 days.
//      A bounce is a fail.
//   2. Rupert's own decision for this client (keep / remove).
//   3. A check in the last 180 days (shared by every client).
//   4. Web search: the person's name with the exact address (a page showing
//      it passes), still at the fund (left or a non-investing role fails),
//      and the firm's address format.
//   5. Hunter's mailbox check, only when the search found no page with the
//      exact address. Valid passes; invalid fails; a server that accepts
//      every address passes only when the firm's format matches.

import { emailConfirmed, VERIFY_FRESH_DAYS, type CheckSteps } from "../match/verify.ts";
import { federalHolidayOn } from "./holidays.ts";
import { addDays, localDate } from "./live.ts";

const DAY_MS = 86_400_000;
export const FRESH_MS = VERIFY_FRESH_DAYS * DAY_MS;
/** Sent and no bounce for this long: delivered. */
export const DELIVERED_AFTER_MS = 72 * 60 * 60 * 1000;
/** The morning push (vercel.json, /api/cron/outreach) runs at this UTC hour. */
export const PUSH_HOUR_UTC = 15;

export type DeliveryProof = {
  last_sent_at: string | null;
  delivered_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
};

export type StoredCheck = {
  status: string | null;
  steps: CheckSteps;
  checked_at: string | null;
  had_error: boolean;
};

export type Verdict =
  | { kind: "pass"; reason: string; source: "delivered" | "replied" | "kept" | "check" }
  | { kind: "fail"; reason: string }
  /** Run the web search (and Hunter if it doesn't settle it). `mailbox`: a fresh Hunter result to reuse. */
  | { kind: "check"; reuseMailbox: boolean };

const ms = (at: string | null | undefined) => (at ? Date.parse(at) : NaN);
const within = (at: string | null | undefined, now: number, span: number) => {
  const t = ms(at);
  return Number.isFinite(t) && now - t <= span;
};

/** What the steps of a finished check say. Null: they don't settle it. */
export function stepsVerdict(steps: CheckSteps): { pass: boolean; reason: string } | null {
  const role = steps.role?.result;
  if (role === "left_firm") {
    const now = steps.role?.newFirm ? ` (now at ${steps.role.newFirm})` : "";
    return { pass: false, reason: `Left the fund${now}.` };
  }
  if (role === "role_changed") {
    return { pass: false, reason: steps.role?.currentTitle ? `Now ${steps.role.currentTitle}, not an investing role.` : "Not in an investing role." };
  }
  if (steps.public?.result === "found") return { pass: true, reason: "A page shows this exact address for this person." };
  const mailbox = steps.mailbox?.result;
  if (mailbox === "invalid") return { pass: false, reason: "Hunter: the mailbox does not exist." };
  if (mailbox === "disposable") return { pass: false, reason: "Hunter: a disposable address." };
  if (mailbox === "valid") return { pass: true, reason: "Hunter: the mailbox accepts mail." };
  if (emailConfirmed(steps)) {
    return { pass: true, reason: `The server accepts every address; the firm's published addresses use the same format (${steps.pattern?.pattern || "same format"}).` };
  }
  if (mailbox === "accept_all") {
    return {
      pass: false,
      reason:
        steps.pattern?.result === "differs"
          ? "The server accepts every address and the firm's published addresses use a different format."
          : "The server accepts every address, and nothing shows this one is right.",
    };
  }
  if (mailbox === "webmail") return { pass: false, reason: "A personal webmail address that can't be tied to the fund." };
  if (mailbox === "unknown") return { pass: false, reason: "Neither the web search nor Hunter could confirm the address." };
  return null;
}

/**
 * The verdict before any new search. `decision` is Rupert's for this client.
 * A check counts while it is under 180 days old and had no failed step.
 */
export function presendVerdict(input: {
  delivery: DeliveryProof | null;
  check: StoredCheck | null;
  decision: "keep" | "remove" | null;
  now: number;
}): Verdict {
  const { delivery, check, decision, now } = input;
  if (decision === "remove") return { kind: "fail", reason: "Removed by Rupert." };
  if (delivery) {
    const bounced = ms(delivery.bounced_at);
    const proven = Math.max(ms(delivery.delivered_at) || 0, ms(delivery.replied_at) || 0);
    if (Number.isFinite(bounced) && bounced >= proven) return { kind: "fail", reason: "An earlier email to this address bounced." };
    if (within(delivery.replied_at, now, FRESH_MS)) return { kind: "pass", reason: "Replied to an earlier email.", source: "replied" };
    if (within(delivery.delivered_at, now, FRESH_MS)) return { kind: "pass", reason: "An earlier email was delivered.", source: "delivered" };
  }
  if (decision === "keep") return { kind: "pass", reason: "Kept by Rupert.", source: "kept" };
  if (check && check.checked_at && !check.had_error && within(check.checked_at, now, FRESH_MS)) {
    const steps = check.steps ?? {};
    const settled = stepsVerdict(steps);
    if (settled?.pass) return { kind: "pass", reason: settled.reason, source: "check" };
    const hard =
      steps.role?.result === "left_firm" ||
      steps.role?.result === "role_changed" ||
      steps.mailbox?.result === "invalid" ||
      steps.mailbox?.result === "disposable";
    if (settled && hard) return { kind: "fail", reason: settled.reason };
    // A fresh check that never searched for the exact address (Verify Emails) gets that search, reusing its Hunter result.
    if (!steps.public) return { kind: "check", reuseMailbox: Boolean(steps.mailbox && steps.mailbox.result !== "error") };
    return { kind: "fail", reason: settled?.reason ?? "Not confirmed by the last check." };
  }
  return { kind: "check", reuseMailbox: false };
}

/** Business Day: Monday to Friday, not a US federal holiday. */
export function isBusinessDay(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !federalHolidayOn(day);
}

export function nextBusinessDay(day: string) {
  let next = day;
  do next = addDays(next, 1);
  while (!isBusinessDay(next));
  return next;
}

/**
 * The day of the next morning push this check is for, in the campaign's
 * timezone: the next push at PUSH_HOUR_UTC, moved to a Business Day.
 */
export function targetSendDay(now: number, timeZone: string) {
  const d = new Date(now);
  const pushToday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), PUSH_HOUR_UTC);
  const push = now < pushToday ? pushToday : pushToday + DAY_MS;
  const day = localDate(push, timeZone);
  return isBusinessDay(day) ? day : nextBusinessDay(day);
}

/** The push instant on a day, for the queue's "now". */
export function pushInstant(day: string) {
  return Date.parse(`${day}T${String(PUSH_HOUR_UTC).padStart(2, "0")}:00:00Z`);
}

/** Spare contacts checked beyond the day's room, so a failure doesn't leave the day short. */
export function spareFor(room: number) {
  return room <= 0 ? 0 : Math.max(3, Math.ceil(room * 0.3));
}

/**
 * Add Leads opens when the next batch is complete: full (every place taken by a contact that passed
 * the check), or as full as the list allows (some passed and nothing is left to check for that day).
 */
export function batchComplete(batch: { room: number; ready: number; unchecked: number }) {
  return batch.room > 0 && (batch.ready >= batch.room || (batch.ready > 0 && batch.unchecked === 0));
}
