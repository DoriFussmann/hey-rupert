// Campaign capacity: how many unique investor firms the sending inboxes can
// work through in a campaign. Pure module (no server code): it runs in the
// browser while the inputs change, and on the server when a plan is saved.
//
// The model is a day-by-day schedule, not a division:
//   - Day 0 is a Monday. The first `sendingDaysPerWeek` days of each week are
//     sending days (5 = Monday to Friday).
//   - The campaign lasts round(months × 365.25 / 12) calendar days.
//   - A sending day's capacity is inboxes × emails per inbox per day (at most
//     30 per inbox, follow-ups included). During the warm-up weeks it ramps up
//     evenly: the first warm-up week sends the warm-up percentage, each later
//     one steps up by the same amount towards full. With 2 warm-up weeks at
//     33% of 30: 10 a day in week 1, 20 in week 2, 30 from week 3 — the
//     same ramp the live campaign sends (lib/outreach/live.ts).
//   - A firm is started on a day by emailing each of its contacts (one
//     initial email per contact). Follow-up k goes `followUpDelayDays`
//     calendar days after the email before it, on the first sending day with
//     room for all of the firm's contacts; it waits when that day is full.
//   - Follow-ups are booked when the firm is started, so they always have room:
//     later initial emails only use what is left. A firm is started only when
//     every follow-up of every contact fits before the campaign ends, so the
//     plan never counts a sequence it can't finish.
//   - Firms are started as early as possible, as many per day as fit.
// Follow-ups are never counted as extra firms.

import { EMAIL_SEQUENCE_LABELS } from "../../setup.ts";

export const CAPACITY_MODEL_VERSION = "capacity-2026-10.2";

/** Never more than this many emails a day from one inbox (lib/outreach/live.ts MAX_DAILY_EMAILS). */
export const MAX_EMAILS_PER_INBOX = 30;

/** Outreach goes to each fund's Primary and Backup contact (the engine's sequence). */
export const SEQUENCE_CONTACTS = 2;

export type CapacityInputs = {
  inboxes: number;
  emailsPerInboxPerDay: number;
  warmupWeeks: number;
  /** The first warm-up week's capacity as a percentage of normal (0–100); later warm-up weeks step up evenly. */
  warmupPercent: number;
  sendingDaysPerWeek: number;
  months: number;
  contactsPerFirm: number;
  /** Follow-ups after the first email, per contact. */
  followUps: number;
  /** Calendar days between one email and the next follow-up. */
  followUpDelayDays: number;
};

export const INPUT_LIMITS: Record<keyof CapacityInputs, { min: number; max: number; label: string; whole: boolean }> = {
  inboxes: { min: 1, max: 100, label: "Sending inboxes", whole: true },
  emailsPerInboxPerDay: { min: 1, max: MAX_EMAILS_PER_INBOX, label: "Emails per inbox per sending day", whole: true },
  warmupWeeks: { min: 0, max: 12, label: "Warm-up weeks", whole: true },
  warmupPercent: { min: 0, max: 100, label: "First warm-up week (%)", whole: true },
  sendingDaysPerWeek: { min: 1, max: 7, label: "Sending days per week", whole: true },
  months: { min: 1, max: 12, label: "Campaign months", whole: true },
  contactsPerFirm: { min: 1, max: 10, label: "Contacts per firm", whole: true },
  followUps: { min: 0, max: 5, label: "Follow-ups per contact", whole: true },
  followUpDelayDays: { min: 1, max: 30, label: "Days between follow-ups", whole: true },
};

/**
 * Starting values, matching how the live campaign sends: the client's one
 * inbox, at most 30 emails a day (follow-ups included), ramping 10 → 20 → 30
 * over the first two weeks, Monday to Friday, follow-ups 5 days apart.
 * Contacts per firm and follow-ups come from the app: the engine's Primary +
 * Backup, and the Email Copy sequence (a first email and two follow-ups).
 */
export const DEFAULT_INPUTS: CapacityInputs = {
  inboxes: 1,
  emailsPerInboxPerDay: MAX_EMAILS_PER_INBOX,
  warmupWeeks: 2,
  warmupPercent: 33,
  sendingDaysPerWeek: 5,
  months: 3,
  contactsPerFirm: SEQUENCE_CONTACTS,
  followUps: EMAIL_SEQUENCE_LABELS.length - 1,
  followUpDelayDays: 5,
};

/** Problems with the inputs, in words. Empty when the schedule can run. */
export function inputProblems(inputs: CapacityInputs): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(INPUT_LIMITS) as (keyof CapacityInputs)[]) {
    const { min, max, label, whole } = INPUT_LIMITS[key];
    const value = inputs[key];
    if (typeof value !== "number" || !Number.isFinite(value)) problems.push(`${label}: enter a number.`);
    else if (whole && !Number.isInteger(value)) problems.push(`${label}: use a whole number.`);
    else if (value < min || value > max) problems.push(`${label}: between ${min} and ${max}.`);
  }
  if (problems.length > 0) return problems;
  const days = campaignDays(inputs.months);
  if (inputs.warmupWeeks * 7 >= days) problems.push("The warm-up lasts as long as the whole campaign: shorten it or lengthen the campaign.");
  if (inputs.warmupWeeks > 0 && inputs.warmupPercent === 0 && inputs.warmupWeeks * 7 >= days) problems.push("Nothing can be sent: the warm-up sends 0% for the whole campaign.");
  if (inputs.contactsPerFirm > dailyCapacity(inputs, false)) {
    problems.push(`One firm needs ${inputs.contactsPerFirm} emails on the same day, more than the inboxes send in a day (${dailyCapacity(inputs, false)}).`);
  }
  const sequenceDays = inputs.followUps * inputs.followUpDelayDays;
  if (sequenceDays >= days) problems.push(`One sequence takes ${sequenceDays} days, as long as the whole campaign (${days} days): fewer follow-ups or shorter delays.`);
  return problems;
}

/** Calendar days in a campaign of `months` months: round(months × 365.25 / 12). */
export function campaignDays(months: number) {
  return Math.round((months * 365.25) / 12);
}

function dailyCapacity(inputs: CapacityInputs, warmup: boolean, warmupWeek = 0) {
  const normal = inputs.inboxes * inputs.emailsPerInboxPerDay;
  if (!warmup || inputs.warmupWeeks === 0) return normal;
  const percent = inputs.warmupPercent + ((100 - inputs.warmupPercent) * warmupWeek) / inputs.warmupWeeks;
  return Math.min(normal, Math.round((normal * percent) / 100));
}

export type WeekRow = {
  week: number;
  capacity: number;
  initial: number;
  followUps: number;
  unused: number;
  firmsStarted: number;
  warmup: boolean;
};

export type CapacityResult = {
  modelVersion: string;
  days: number;
  sendingDays: number;
  warmupSendingDays: number;
  dailyNormal: number;
  /** The first warm-up week's daily capacity. */
  dailyWarmup: number;
  /** Sends the warm-up costs against full capacity. */
  warmupLost: number;
  /** Every email the inboxes could send in the campaign. */
  capacity: number;
  warmupCapacity: number;
  initialEmails: number;
  followUpEmails: number;
  /** initialEmails + followUpEmails. */
  scheduled: number;
  unused: number;
  /** scheduled / capacity, 0–1. */
  utilization: number;
  contactsReached: number;
  /** Unique firms whose full sequence fits in the campaign. */
  firms: number;
  emailsPerFirm: number;
  /** Calendar day of the last firm started (−1 when none). */
  lastStartDay: number;
  /** Capacity left in the days after the last start: too late to finish a sequence. */
  tailUnused: number;
  /** firms × emails per firm: what a plain division would assume, for comparison. */
  naiveFirms: number;
  weeks: WeekRow[];
  bottlenecks: string[];
};

/**
 * Builds the schedule. `stopAtFirms` stops starting firms once that many have
 * started (for a target); the capacity figures still cover the whole campaign.
 */
export function schedule(inputs: CapacityInputs, stopAtFirms = Number.POSITIVE_INFINITY): CapacityResult {
  const problems = inputProblems(inputs);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const days = campaignDays(inputs.months);
  const warmupDays = inputs.warmupWeeks * 7;
  const c = inputs.contactsPerFirm;
  const f = inputs.followUps;
  const delay = inputs.followUpDelayDays;

  const cap = new Array<number>(days).fill(0);
  const sending = new Array<boolean>(days).fill(false);
  for (let d = 0; d < days; d += 1) {
    sending[d] = d % 7 < inputs.sendingDaysPerWeek;
    if (sending[d]) cap[d] = dailyCapacity(inputs, d < warmupDays, Math.floor(d / 7));
  }
  const free = [...cap];
  const initialOn = new Array<number>(days).fill(0);
  const followOn = new Array<number>(days).fill(0);
  const startedOn = new Array<number>(days).fill(0);

  /** The first day from `from` with room for one firm's contacts, or −1. */
  const roomFrom = (from: number) => {
    for (let d = from; d < days; d += 1) if (free[d] >= c) return d;
    return -1;
  };

  let firms = 0;
  let lastStartDay = -1;
  for (let d = 0; d < days && firms < stopAtFirms; d += 1) {
    if (!sending[d]) continue;
    // Firms started on the same day share due dates: a cursor per follow-up
    // remembers how far the bookings of earlier firms that day have pushed.
    const cursor = new Array<number>(f).fill(0);
    while (firms < stopAtFirms && free[d] >= c) {
      const booked: number[] = [];
      let previous = d;
      let fits = true;
      for (let k = 0; k < f; k += 1) {
        const day = roomFrom(Math.max(previous + delay, cursor[k]));
        if (day < 0) {
          fits = false;
          break;
        }
        booked.push(day);
        free[day] -= c; // held now so the next follow-up can't take the same room
        previous = day;
      }
      if (!fits) {
        for (const day of booked) free[day] += c;
        break;
      }
      free[d] -= c;
      initialOn[d] += c;
      booked.forEach((day, k) => {
        followOn[day] += c;
        cursor[k] = day;
      });
      startedOn[d] += 1;
      firms += 1;
      lastStartDay = d;
    }
  }

  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const capacity = sum(cap);
  const initialEmails = sum(initialOn);
  const followUpEmails = sum(followOn);
  const scheduled = initialEmails + followUpEmails;
  const warmupCapacity = sum(cap.slice(0, Math.min(warmupDays, days)));
  const tailUnused = lastStartDay < 0 ? sum(free) : sum(free.slice(lastStartDay + 1));
  const emailsPerFirm = c * (1 + f);

  const weeks: WeekRow[] = [];
  for (let start = 0; start < days; start += 7) {
    const end = Math.min(start + 7, days);
    const slice = (values: number[]) => sum(values.slice(start, end));
    weeks.push({
      week: start / 7 + 1,
      capacity: slice(cap),
      initial: slice(initialOn),
      followUps: slice(followOn),
      unused: slice(free),
      firmsStarted: slice(startedOn),
      warmup: start < warmupDays,
    });
  }

  const result: CapacityResult = {
    modelVersion: CAPACITY_MODEL_VERSION,
    days,
    sendingDays: sending.filter(Boolean).length,
    warmupSendingDays: sending.slice(0, Math.min(warmupDays, days)).filter(Boolean).length,
    dailyNormal: dailyCapacity(inputs, false),
    dailyWarmup: warmupDays > 0 ? dailyCapacity(inputs, true, 0) : dailyCapacity(inputs, false),
    warmupLost: cap.slice(0, Math.min(warmupDays, days)).reduce((lost, value, d) => lost + (sending[d] ? dailyCapacity(inputs, false) - value : 0), 0),
    capacity,
    warmupCapacity,
    initialEmails,
    followUpEmails,
    scheduled,
    unused: capacity - scheduled,
    utilization: capacity > 0 ? scheduled / capacity : 0,
    contactsReached: firms * c,
    firms,
    emailsPerFirm,
    lastStartDay,
    tailUnused,
    naiveFirms: Math.floor(capacity / emailsPerFirm),
    weeks,
    bottlenecks: [],
  };
  result.bottlenecks = bottlenecksOf(inputs, result, stopAtFirms);
  return result;
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function bottlenecksOf(inputs: CapacityInputs, r: CapacityResult, stopAt: number): string[] {
  const notes: string[] = [];
  if (r.firms >= stopAt) {
    notes.push(`The target is reached by day ${r.lastStartDay + 1} of ${r.days}; the rest of the capacity is spare.`);
    return notes;
  }
  if (r.capacity === 0) return ["The inboxes send nothing in this campaign."];
  if (r.warmupCapacity > 0 || inputs.warmupWeeks > 0) {
    const lost = r.warmupLost;
    if (lost > 0) notes.push(`Warm-up: ${lost.toLocaleString("en-US")} sends fewer than at full capacity (${pct(lost / (r.capacity + lost))} of the campaign).`);
  }
  if (r.tailUnused > 0) {
    notes.push(
      `Follow-up timing: the last ${r.days - 1 - r.lastStartDay} days can't start new firms, because their follow-ups wouldn't finish before the campaign ends. ${r.tailUnused.toLocaleString("en-US")} sends (${pct(r.tailUnused / r.capacity)}) go unused.`,
    );
  }
  if (r.naiveFirms > r.firms) {
    notes.push(`Dividing capacity by ${r.emailsPerFirm} emails per firm would give ${r.naiveFirms.toLocaleString("en-US")} firms; the schedule fits ${r.firms.toLocaleString("en-US")}.`);
  }
  notes.push(`Inbox limit: ${r.dailyNormal.toLocaleString("en-US")} emails per sending day (${inputs.inboxes} × ${inputs.emailsPerInboxPerDay}). Each firm takes ${r.emailsPerFirm} emails.`);
  return notes;
}

/** Fewest inboxes (up to the limit) that fit `target` firms with the other inputs unchanged, or null. */
export function inboxesNeeded(inputs: CapacityInputs, target: number): number | null {
  const max = INPUT_LIMITS.inboxes.max;
  const fits = (inboxes: number) => {
    const next = { ...inputs, inboxes };
    return inputProblems(next).length === 0 && schedule(next, target).firms >= target;
  };
  if (!fits(max)) return null;
  let low = 1;
  let high = max;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** Planning benchmarks: reference targets only, never used as capacity. */
export const BENCHMARKS: { months: number; firms: number }[] = [
  { months: 1, firms: 90 },
  { months: 2, firms: 210 },
  { months: 3, firms: 330 },
  { months: 4, firms: 450 },
  { months: 5, firms: 570 },
  { months: 6, firms: 690 },
];

export function benchmarkFor(months: number) {
  return BENCHMARKS.find((b) => b.months === months)?.firms ?? null;
}

/** "under" when the calculated capacity is below the reference, "over" above, "on" within 5%. */
export function compareToBenchmark(calculated: number, reference: number): { status: "under" | "on" | "over"; difference: number } {
  const difference = calculated - reference;
  if (Math.abs(difference) <= reference * 0.05) return { status: "on", difference };
  return { status: difference < 0 ? "under" : "over", difference };
}
