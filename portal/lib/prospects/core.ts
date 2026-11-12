// Prospects: founders who booked a call on Cal.com, before they are clients.
// Pure module, safe in the browser: reading Cal.com's webhook, the prep brief
// and Dry Match estimate shapes, when the emails go out, and their text.
// The server side (database, Claude, Resend) is in ./server.ts.

// ---------------------------------------------------------------------------
// Cal.com webhook

/** Triggers that carry a full booking. Anything else is logged and ignored. */
export const BOOKING_TRIGGERS = [
  "BOOKING_CREATED",
  "BOOKING_REQUESTED",
  "BOOKING_RESCHEDULED",
  "BOOKING_CANCELLED",
  "BOOKING_REJECTED",
  "BOOKING_PAID",
  "BOOKING_LOCATION_UPDATED",
  "BOOKING_TITLE_UPDATED",
  "BOOKING_REASSIGNED",
] as const;
export type BookingTrigger = (typeof BOOKING_TRIGGERS)[number];

/** A booking-form answer, as stored: the field's label and its value. */
export type FormAnswer = { label: string; value: unknown };

export type ParsedBooking = {
  trigger: BookingTrigger;
  uid: string;
  bookingId: number | null;
  status: string;
  eventTitle: string | null;
  title: string | null;
  start: string | null;
  end: string | null;
  location: string | null;
  videoUrl: string | null;
  name: string;
  email: string;
  timeZone: string | null;
  guests: string[];
  notes: string | null;
  companyName: string | null;
  heardFrom: string | null;
  utm: Record<string, string> | null;
  responses: Record<string, FormAnswer>;
  rescheduledFromUid: string | null;
  cancellationReason: string | null;
  bookedAt: string | null;
};

export type ParsedEvent =
  | { kind: "booking"; trigger: BookingTrigger; booking: ParsedBooking }
  | { kind: "ignored"; trigger: string; uid: string | null; reason: string };

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const iso = (value: unknown) => {
  const text = str(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** The value of a booking-form answer as text: strings, lists, and { value, optionValue } objects. */
export function answerText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(answerText).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join(", ") : null;
  }
  if (isObj(value)) return answerText(value.optionValue) ?? answerText(value.value);
  return null;
}

/** Field names, lowercased with only letters and digits, for matching custom questions. */
const fieldKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function findAnswer(responses: Record<string, FormAnswer>, test: (key: string, label: string) => boolean) {
  for (const [name, answer] of Object.entries(responses)) {
    if (test(fieldKey(name), fieldKey(answer.label))) {
      const text = answerText(answer.value);
      if (text) return text;
    }
  }
  return null;
}

/** Cal.com sends answers as { field: { label, value } } (webhook) or { field: value } (its own API). */
export function normalizeResponses(raw: unknown): Record<string, FormAnswer> {
  if (!isObj(raw)) return {};
  const out: Record<string, FormAnswer> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (isObj(entry) && ("value" in entry || "label" in entry)) {
      if (entry.isHidden === true && answerText(entry.value) == null) continue;
      out[name] = { label: str(entry.label) ?? name, value: entry.value ?? null };
    } else {
      out[name] = { label: name, value: entry ?? null };
    }
  }
  return out;
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

export function parseCalEvent(body: unknown): ParsedEvent {
  if (!isObj(body)) return { kind: "ignored", trigger: "UNKNOWN", uid: null, reason: "not an object" };
  const trigger = str(body.triggerEvent) ?? "UNKNOWN";
  const p = isObj(body.payload) ? body.payload : body;
  const uid = str(p.uid) ?? str(p.bookingUid);
  if (!(BOOKING_TRIGGERS as readonly string[]).includes(trigger)) {
    return { kind: "ignored", trigger, uid, reason: "not a booking event" };
  }
  if (!uid) return { kind: "ignored", trigger, uid: null, reason: "no booking uid" };

  const responses = normalizeResponses(p.responses);
  const attendees = Array.isArray(p.attendees) ? p.attendees.filter(isObj) : [];
  const attendee = attendees[0] ?? {};
  const email = (answerText(responses.email?.value) ?? str(attendee.email) ?? "").toLowerCase();
  const name = answerText(responses.name?.value) ?? str(attendee.name) ?? "";
  const guestsRaw = responses.guests?.value;
  const guests = Array.isArray(guestsRaw) ? guestsRaw.map(answerText).filter((g): g is string => Boolean(g)) : [];

  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = findAnswer(responses, (k) => k === fieldKey(key));
    if (value) utm[key] = value;
  }
  const metadata = isObj(p.metadata) ? p.metadata : {};
  const typed = trigger as BookingTrigger;
  const status =
    typed === "BOOKING_REQUESTED" ? "PENDING"
    : typed === "BOOKING_CANCELLED" ? "CANCELLED"
    : typed === "BOOKING_REJECTED" ? "REJECTED"
    : str(p.status)?.toUpperCase() ?? "ACCEPTED";

  return {
    kind: "booking",
    trigger: typed,
    booking: {
      trigger: typed,
      uid,
      bookingId: Number.isFinite(Number(p.bookingId)) && p.bookingId != null ? Number(p.bookingId) : null,
      status,
      eventTitle: str(p.eventTitle) ?? str(p.type),
      title: str(p.title),
      start: iso(p.startTime),
      end: iso(p.endTime),
      location: answerText(p.location) ?? answerText(responses.location?.value),
      videoUrl: str(metadata.videoCallUrl),
      name,
      email,
      timeZone: str(attendee.timeZone),
      guests,
      notes: answerText(responses.notes?.value) ?? str(p.additionalNotes),
      companyName: findAnswer(responses, (k, l) => k.includes("company") || l.includes("company")),
      heardFrom: findAnswer(responses, (k, l) => k.includes("hear") || l.includes("hear") || k.includes("referr") || l.includes("referr")),
      utm: Object.keys(utm).length ? utm : null,
      responses,
      rescheduledFromUid: typed === "BOOKING_RESCHEDULED" ? str(p.rescheduleUid) ?? str(p.fromReschedule) : null,
      cancellationReason: typed === "BOOKING_CANCELLED" ? str(p.cancellationReason) : null,
      bookedAt: ["BOOKING_CREATED", "BOOKING_REQUESTED", "BOOKING_RESCHEDULED"].includes(typed) ? iso(body.createdAt) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Small facts

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com",
  "zoho.com", "yandex.com", "hey.com", "fastmail.com", "qq.com", "163.com",
]);

/** The company website guessed from a work email (none for Gmail and the like). */
export function websiteFromEmail(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain || !domain.includes(".") || PERSONAL_DOMAINS.has(domain)) return null;
  return `https://${domain}`;
}

export function firstName(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export const PROSPECT_STATUSES = ["call_booked", "call_done", "follow_up", "not_a_fit", "no_show", "cancelled", "converted"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const STATUS_LABEL: Record<ProspectStatus, string> = {
  call_booked: "Call booked",
  call_done: "Call done",
  follow_up: "Follow up",
  not_a_fit: "Not a fit",
  no_show: "No-show",
  cancelled: "Cancelled",
  converted: "Client",
};

/** The outcomes you log after the call. */
export const OUTCOMES: { value: ProspectStatus; label: string }[] = [
  { value: "follow_up", label: "Good fit: follow up" },
  { value: "call_done", label: "Call done, undecided" },
  { value: "not_a_fit", label: "Not a fit" },
  { value: "no_show", label: "No-show" },
];

export function isProspectStatus(value: unknown): value is ProspectStatus {
  return typeof value === "string" && (PROSPECT_STATUSES as readonly string[]).includes(value);
}

/** Status after a new or moved booking: a decided prospect keeps its status; a client stays a client. */
export function statusAfterBooking(current: ProspectStatus | null): ProspectStatus {
  if (current === "converted") return "converted";
  return "call_booked";
}

// ---------------------------------------------------------------------------
// The brief and the estimate

export type BriefRound = { round: string; amount: string; date: string; investors: string };

export type ProspectBrief = {
  person: { summary: string; facts: string[] };
  company: {
    oneLiner: string;
    what: string;
    hqCountry: string;
    founded: string;
    website: string;
    rounds: BriefRound[];
  };
  raise: { stage: string; amount: string };
  signals: string[];
  /** Option ids of the Dry Match steps, checked against the live options. */
  fit: { financing: string[]; stage: string[]; geography: string[]; sector: string[]; note: string };
  questions: string[];
  watchOuts: string[];
  sources: { title: string; url: string }[];
};

const strings = (value: unknown, max: number) =>
  (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type FitOptions = Record<"financing" | "stage" | "geography" | "sector", { id: string; label: string }[]>;

/** Keeps only option ids that exist; a label is accepted in place of its id. */
function pick(values: unknown, options: { id: string; label: string }[], max: number) {
  const out: string[] = [];
  for (const raw of strings(values, 10)) {
    const hit = options.find((o) => o.id === raw) ?? options.find((o) => o.label.toLowerCase() === raw.toLowerCase());
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out.slice(0, max);
}

/** Claude's answer, checked: every field has its type, lists are capped, the fit uses real options only. */
export function cleanBrief(input: unknown, options: FitOptions): ProspectBrief {
  const o = isObj(input) ? input : {};
  const person = isObj(o.person) ? o.person : {};
  const company = isObj(o.company) ? o.company : {};
  const raise = isObj(o.raise) ? o.raise : {};
  const fit = isObj(o.fit) ? o.fit : {};
  const rounds = (Array.isArray(company.rounds) ? company.rounds : [])
    .filter(isObj)
    .map((r) => ({ round: text(r.round), amount: text(r.amount), date: text(r.date), investors: text(r.investors) }))
    .filter((r) => r.round || r.amount || r.investors)
    .slice(0, 8);
  const sources = (Array.isArray(o.sources) ? o.sources : [])
    .filter(isObj)
    .map((s) => ({ title: text(s.title), url: text(s.url) }))
    .filter((s) => /^https?:\/\//i.test(s.url) && !/linkedin\.com/i.test(s.url))
    .slice(0, 10);
  return {
    person: { summary: text(person.summary), facts: strings(person.facts, 3) },
    company: {
      oneLiner: text(company.one_liner ?? company.oneLiner),
      what: text(company.what),
      hqCountry: text(company.hq_country ?? company.hqCountry),
      founded: text(company.founded),
      website: text(company.website),
      rounds,
    },
    raise: { stage: text(raise.stage), amount: text(raise.amount) },
    signals: strings(o.signals, 4),
    fit: {
      financing: pick(fit.financing, options.financing, 2),
      stage: pick(fit.stage, options.stage, 3),
      geography: pick(fit.geography, options.geography, 3),
      sector: pick(fit.sector, options.sector, 2),
      note: text(fit.note),
    },
    questions: strings(o.questions, 3),
    watchOuts: strings(o.watch_outs ?? o.watchOuts, 3),
    sources,
  };
}

export type EstimateStep = { step: string; label: string; chosen: string[]; left: number };
export type ExampleFund = { name: string; type: string; place: string; website: string };

export type MatchEstimate = {
  /** Funds in the database before any filter (with the debt-only funds held outside it). */
  total: number;
  steps: EstimateStep[];
  /** Funds left after every step with a choice. */
  count: number;
  examples: ExampleFund[];
  /** Steps left open because the brief had no choice for them. */
  open: string[];
  fundDbVersion: string;
  at: string;
};

export type FundForExample = {
  name: string;
  generalist: boolean;
  groups: number;
  stages: number;
  type: string;
  place: string;
  website: string;
  contacts: number;
};

/** A few funds to name: specialists before generalists, the most focused first, with someone to contact. */
export function exampleFunds(funds: FundForExample[], max = 5): ExampleFund[] {
  return [...funds]
    .filter((f) => f.contacts > 0)
    .sort(
      (a, b) =>
        Number(a.generalist) - Number(b.generalist) ||
        (a.groups || 99) - (b.groups || 99) ||
        (a.stages || 99) - (b.stages || 99) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, max)
    .map(({ name, type, place, website }) => ({ name, type, place, website }));
}

/** The three steps an estimate needs. Without all of them the count means nothing, so none is shown. */
export const ESTIMATE_NEEDS = [
  { step: "stage", label: "stage" },
  { step: "geography", label: "geography" },
  { step: "sector", label: "sector" },
] as const;

/** What the estimate still lacks: [] when it is a real estimate. */
export function estimateMissing(estimate: MatchEstimate | null): string[] {
  return ESTIMATE_NEEDS.filter((n) => !estimate?.steps.some((s) => s.step === n.step && s.chosen.length)).map((n) => n.label);
}

export function estimateReady(estimate: MatchEstimate | null): estimate is MatchEstimate {
  return Boolean(estimate) && estimateMissing(estimate).length === 0;
}

/** "stage and sector", "stage, geography and sector" */
export function missingText(missing: string[]) {
  return missing.length <= 1 ? missing.join("") : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
}

/** "Equity · Pre-Seed, Seed · United States · Software & IT" */
export function filtersLine(estimate: MatchEstimate) {
  return estimate.steps.map((s) => s.chosen.join(", ")).filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// When the emails go out

const MINUTE = 60_000;
/** Resend schedules up to 30 days ahead; keep a margin. */
export const SCHEDULE_HORIZON_MS = 29 * 24 * 60 * MINUTE;
export const PREP_LEAD_MS = 30 * MINUTE;
export const CHECKIN_AFTER_MS = 15 * MINUTE;
/** Follow-up reminder: this long after the outcome, when they haven't become a client. */
export const REMINDER_AFTER_MS = 3 * 24 * 60 * MINUTE;

export type SendAt = { at: string; now: boolean } | { at: null; reason: string };

/** The prep email: 30 minutes before the call, now if that has passed, nothing once the call is over. */
export function prepSendAt(start: string | null, end: string | null, nowMs: number): SendAt {
  if (!start) return { at: null, reason: "The booking has no start time." };
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : startMs + 30 * MINUTE;
  if (endMs <= nowMs) return { at: null, reason: "The call is over." };
  const sendMs = startMs - PREP_LEAD_MS;
  if (sendMs - nowMs > SCHEDULE_HORIZON_MS) return { at: null, reason: "More than 29 days ahead; the daily check schedules it later." };
  if (sendMs <= nowMs + MINUTE) return { at: new Date(nowMs).toISOString(), now: true };
  return { at: new Date(sendMs).toISOString(), now: false };
}

/** The check-in to log the outcome: 15 minutes after the call ends. */
export function checkinSendAt(start: string | null, end: string | null, nowMs: number): SendAt {
  const endMs = end ? Date.parse(end) : start ? Date.parse(start) + 30 * MINUTE : NaN;
  if (Number.isNaN(endMs)) return { at: null, reason: "The booking has no time." };
  const sendMs = endMs + CHECKIN_AFTER_MS;
  if (sendMs - nowMs > SCHEDULE_HORIZON_MS) return { at: null, reason: "More than 29 days ahead; the daily check schedules it later." };
  if (sendMs <= nowMs + MINUTE) return { at: null, reason: "The call ended a while ago." };
  return { at: new Date(sendMs).toISOString(), now: false };
}

// ---------------------------------------------------------------------------
// Email text

export type EmailParts = { subject: string; text: string; html: string };

export type ProspectForEmail = {
  name: string;
  email: string;
  companyName: string | null;
  heardFrom: string | null;
  website: string | null;
  brief: ProspectBrief | null;
  briefError: string | null;
  match: MatchEstimate | null;
};

export type CallForEmail = {
  start: string | null;
  end: string | null;
  timeZone: string;
  videoUrl: string | null;
  location: string | null;
  notes: string | null;
  guests: string[];
  extraAnswers: { label: string; value: string }[];
};

export function formatWhen(startIso: string | null, endIso: string | null, timeZone: string) {
  if (!startIso) return "Time not set";
  const start = new Date(startIso);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(start);
  const time = (d: Date) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(d);
  const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone }).formatToParts(start).find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${day}, ${time(start)}${endIso ? `–${time(new Date(endIso))}` : ""} ${zone}`.trim();
}

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT = "font-family:Inter,Helvetica,Arial,sans-serif";
const INK = "#2D2D2D";
const MUTED = "#6B6B6B";
const ACCENT = "#5C7A5E";

function section(title: string, inner: string) {
  if (!inner.trim()) return "";
  return `<tr><td style="padding:20px 28px 0"><p style="margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${esc(title)}</p>${inner}</td></tr>`;
}
const para = (value: string) => (value ? `<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:${INK}">${value}</p>` : "");
const list = (items: string[]) =>
  items.length ? `<ul style="margin:0 0 8px;padding-left:18px;font-size:15px;line-height:1.55;color:${INK}">${items.map((i) => `<li style="margin:0 0 4px">${i}</li>`).join("")}</ul>` : "";
const link = (href: string, label: string) => `<a href="${esc(href)}" style="color:${ACCENT}">${esc(label)}</a>`;
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-size:14px;padding:10px 16px;border-radius:6px;margin:0 8px 8px 0">${esc(label)}</a>`;

function shell(preheader: string, rows: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#FAF9F5;${FONT}"><span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #E7E4DC;border-radius:10px"><tbody>${rows}<tr><td style="padding:24px 28px 28px"></td></tr></tbody></table></body></html>`;
}

const roundLine = (r: BriefRound) => [r.round, r.amount, r.date].filter(Boolean).join(", ") + (r.investors ? `: ${r.investors}` : "");

/** The email that lands 30 minutes before the call. */
export function prepEmail(prospect: ProspectForEmail, call: CallForEmail, pageUrl: string): EmailParts {
  const b = prospect.brief;
  const m = prospect.match;
  const company = prospect.companyName || b?.company.website || "their company";
  const raise = [b?.raise.stage, b?.raise.amount].filter(Boolean).join(", ");
  const when = formatWhen(call.start, call.end, call.timeZone);
  const subject = `In 30 min: ${prospect.name || prospect.email}, ${company}${raise ? ` (${raise})` : ""}`.slice(0, 140);

  const lines: string[] = [];
  lines.push(`${prospect.name} <${prospect.email}>, ${company}`, when);
  if (call.videoUrl) lines.push(`Join: ${call.videoUrl}`);
  lines.push(`Prospect page: ${pageUrl}`, "");
  const said = [call.notes ? `Notes: ${call.notes}` : "", ...call.extraAnswers.map((a) => `${a.label}: ${a.value}`), prospect.heardFrom ? `Heard about us: ${prospect.heardFrom}` : "", call.guests.length ? `Guests: ${call.guests.join(", ")}` : ""].filter(Boolean);
  if (said.length) lines.push("WHAT THEY TOLD US", ...said, "");
  if (b) {
    if (b.person.summary || b.person.facts.length) lines.push("THE FOUNDER", b.person.summary, ...b.person.facts.map((f) => `- ${f}`), "");
    lines.push("THE COMPANY", [b.company.oneLiner, b.company.what].filter(Boolean).join(" "));
    const facts = [b.company.hqCountry && `HQ: ${b.company.hqCountry}`, b.company.founded && `Founded: ${b.company.founded}`, b.company.website].filter(Boolean);
    if (facts.length) lines.push(facts.join(" · "));
    if (b.company.rounds.length) lines.push("Rounds:", ...b.company.rounds.map((r) => `- ${roundLine(r)}`));
    if (raise) lines.push(`Raising now: ${raise}`);
    if (b.signals.length) lines.push(...b.signals.map((s) => `- ${s}`));
    lines.push("");
  } else {
    lines.push(prospect.briefError ? `No brief: ${prospect.briefError}` : "The brief isn't ready.", "");
  }
  const missing = estimateMissing(m);
  if (estimateReady(m)) {
    lines.push("INVESTOR FIT (FIRST ESTIMATE)", `About ${m.count.toLocaleString("en-US")} of ${m.total.toLocaleString("en-US")} funds: ${filtersLine(m)}`);
    lines.push(...m.examples.map((f) => `- ${f.name}${f.type ? ` (${f.type})` : ""}${f.place ? `, ${f.place}` : ""}`), "");
  } else if (b || m) {
    lines.push("INVESTOR FIT", `No estimate: ${missingText(missing)} not known yet. Ask on the call, then set them on the prospect page.`, "");
  }
  if (b?.questions.length) lines.push("ASK", ...b.questions.map((q, i) => `${i + 1}. ${q}`), "");
  if (b?.watchOuts.length) lines.push("WATCH OUT", ...b.watchOuts.map((w) => `- ${w}`), "");
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const header = `<tr><td style="padding:24px 28px 0"><p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${ACCENT}">Call in 30 minutes</p><h1 style="margin:6px 0 4px;font-size:22px;font-weight:600;color:${INK}">${esc(prospect.name || prospect.email)} · ${esc(company)}</h1><p style="margin:0 0 14px;font-size:14px;color:${MUTED}">${esc(when)}${raise ? ` · Raising ${esc(raise)}` : ""}</p>${call.videoUrl ? button(call.videoUrl, "Join the call") : ""}${button(pageUrl, "Open prospect page")}</td></tr>`;

  const told = list(said.map(esc));
  const founder = b ? para(esc(b.person.summary)) + list(b.person.facts.map(esc)) : "";
  const companyHtml = b
    ? para(esc([b.company.oneLiner, b.company.what].filter(Boolean).join(" "))) +
      para(`<span style="color:${MUTED}">${esc([b.company.hqCountry && `HQ ${b.company.hqCountry}`, b.company.founded && `Founded ${b.company.founded}`].filter(Boolean).join(" · "))}</span>${b.company.website ? ` ${link(b.company.website, b.company.website.replace(/^https?:\/\//, ""))}` : ""}`) +
      (b.company.rounds.length ? para(`<strong>Rounds</strong>`) + list(b.company.rounds.map((r) => esc(roundLine(r)))) : "") +
      list(b.signals.map(esc))
    : para(esc(prospect.briefError ? `No brief: ${prospect.briefError}` : "The brief isn't ready yet; it's on the prospect page when it is."));
  const fit = !estimateReady(m)
    ? b || m
      ? para(`<span style="color:${MUTED}">No estimate: ${esc(missingText(missing))} not known yet. Ask on the call, then set them on the prospect page.</span>`)
      : ""
    : `<p style="margin:0 0 2px;font-size:28px;font-weight:600;color:${INK}">~${m.count.toLocaleString("en-US")} <span style="font-size:15px;font-weight:400;color:${MUTED}">of ${m.total.toLocaleString("en-US")} funds fit</span></p>` +
      para(`<span style="color:${MUTED}">${esc(filtersLine(m))}</span>`) +
      list(m.examples.map((f) => `${f.website ? link(f.website, f.name) : esc(f.name)}${f.type || f.place ? ` <span style="color:${MUTED}">${esc([f.type, f.place].filter(Boolean).join(", "))}</span>` : ""}`));
  const ask = b?.questions.length
    ? `<ol style="margin:0 0 8px;padding-left:20px;font-size:15px;line-height:1.55;color:${INK}">${b.questions.map((q) => `<li style="margin:0 0 4px">${esc(q)}</li>`).join("")}</ol>`
    : "";
  const html = shell(
    `${when}. ${b?.company.oneLiner ?? ""}`,
    header +
      section("What they told us", told) +
      section("The founder", founder) +
      section("The company", companyHtml) +
      section("Investor fit · first estimate", fit) +
      section("Ask", ask) +
      section("Watch out", list((b?.watchOuts ?? []).map(esc))),
  );
  return { subject, text, html };
}

/** The check-in after the call: log how it went. */
export function checkinEmail(prospect: { name: string; companyName: string | null }, pageUrl: string): EmailParts {
  const who = prospect.name || "the founder";
  const subject = `How did the call with ${who}${prospect.companyName ? ` (${prospect.companyName})` : ""} go?`;
  const text = [
    `Log the outcome while it's fresh: good fit, undecided, not a fit, or no-show, with a few notes.`,
    `Then draft the follow-up email from your notes, or convert them to a client.`,
    "",
    pageUrl,
  ].join("\n");
  const html = shell(
    subject,
    `<tr><td style="padding:24px 28px 0"><h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:${INK}">${esc(subject)}</h1>${para("Log the outcome while it's fresh, with a few notes. Then draft the follow-up email from them, or convert them to a client.")}${button(pageUrl, "Log the outcome")}</td></tr>`,
  );
  return { subject, text, html };
}

/** The reminder when a good-fit prospect hasn't become a client a few days after the call. */
export function reminderEmail(prospects: { name: string; companyName: string | null; url: string; days: number }[]): EmailParts {
  const subject = prospects.length === 1 ? `Follow up: ${prospects[0].name}${prospects[0].companyName ? `, ${prospects[0].companyName}` : ""}` : `Follow up: ${prospects.length} prospects`;
  const rows = prospects.map((p) => `${p.name}${p.companyName ? `, ${p.companyName}` : ""}: call ${p.days} days ago, not a client yet. ${p.url}`);
  const text = ["Good-fit prospects waiting on a next step:", "", ...rows.map((r) => `- ${r}`)].join("\n");
  const html = shell(
    subject,
    `<tr><td style="padding:24px 28px 0"><h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:${INK}">${esc(subject)}</h1>${para("Good-fit prospects waiting on a next step:")}${list(prospects.map((p) => `${link(p.url, p.name)}${p.companyName ? `, ${esc(p.companyName)}` : ""} <span style="color:${MUTED}">· call ${p.days} days ago</span>`))}</td></tr>`,
  );
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Convert to client

/** The client form's stage values, from the first text that names one. */
export function raiseStageOf(...texts: (string | null | undefined)[]): string {
  for (const raw of texts) {
    const text = (raw ?? "").toLowerCase();
    if (/series\s*a\b/.test(text)) return "Series A";
    if (/\bseed\b/.test(text.replace(/pre[\s-]?seed/g, ""))) return "Seed";
    if (/pre[\s-]?seed/.test(text)) return "Pre-seed";
  }
  return "";
}

/** The Add Client form, filled in from what the prospect told us and the brief. */
export function clientPrefill(prospect: {
  name: string | null;
  email: string;
  company_name: string | null;
  website: string | null;
  brief: ProspectBrief | null;
  match: MatchEstimate | null;
  outcome_notes: string | null;
}) {
  const [first = "", ...rest] = (prospect.name ?? "").trim().split(/\s+/);
  const b = prospect.brief;
  const step = (key: string) => prospect.match?.steps.find((s) => s.step === key)?.chosen.join(", ") ?? "";
  return {
    first_name: first,
    last_name: rest.join(" "),
    email: prospect.email,
    company_name: prospect.company_name ?? "",
    company_website: (prospect.website ?? b?.company.website ?? "").replace(/^https?:\/\//i, "").replace(/\/$/, ""),
    raise_amount: b?.raise.amount ?? "",
    raise_stage: raiseStageOf(b?.raise.stage, step("stage")),
    vertical: step("sector"),
    geography: b?.company.hqCountry || step("geography"),
    admin_notes: prospect.outcome_notes ? `From the intro call:\n${prospect.outcome_notes}` : "",
  };
}
