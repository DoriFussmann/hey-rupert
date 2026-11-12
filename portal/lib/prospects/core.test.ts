import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PROMPTS } from "../prompts.ts";
import { calSignatureValid } from "./signature.ts";
import {
  checkinSendAt,
  cleanBrief,
  clientPrefill,
  estimateMissing,
  estimateReady,
  missingText,
  exampleFunds,
  parseCalEvent,
  prepEmail,
  prepSendAt,
  raiseStageOf,
  statusAfterBooking,
  websiteFromEmail,
  type FitOptions,
  type MatchEstimate,
} from "./core.ts";

const portal = join(import.meta.dirname, "..", "..");

// Today's real booking, shortened (2021-10-20 payload).
const created = {
  triggerEvent: "BOOKING_CREATED",
  createdAt: "2026-11-12T08:55:37.153Z",
  payload: {
    uid: "5hgN2LEbz71SSypHgopkJd",
    bookingId: 28684291,
    title: "30 Minutes Free Consultation Call w/ Dori Fussmann between Team Rupert and Naga Vinnakota",
    eventTitle: "30 Minutes Free Consultation Call w/ Dori Fussmann",
    startTime: "2026-11-12T19:30:00.000Z",
    endTime: "2026-11-12T20:00:00.000Z",
    location: "integrations:daily",
    status: "ACCEPTED",
    metadata: { videoCallUrl: "https://app.cal.com/video/5hgN2LEbz71SSypHgopkJd" },
    attendees: [{ name: "Naga Vinnakota", email: "Naga@Aegis360.space", timeZone: "America/New_York" }],
    responses: {
      name: { label: "your_name", value: "Naga Vinnakota" },
      email: { label: "email_address", value: "naga@aegis360.space" },
      notes: { label: "additional_notes", value: "Seed - 9.8M" },
      guests: { label: "additional_guests", value: ["ak@aegis360.space"] },
      location: { label: "location", value: { value: "integrations:daily", optionValue: "" } },
      "Company-Name": { label: "Company Name", value: "Aegis 360 Inc" },
      "How-did-you-hear-about-us": { label: "How did you hear about us?", value: "Google" },
      utm_source: { label: "utm_source", value: "linkedin", isHidden: true },
      attendeePhoneNumber: { label: "phone_number", isHidden: true },
    },
  },
};

test("Cal.com signature: HMAC-SHA256 of the raw body, hex; anything else fails", () => {
  const raw = JSON.stringify(created);
  const sig = createHmac("sha256", "s3cret").update(raw).digest("hex");
  assert.ok(calSignatureValid("s3cret", raw, sig));
  assert.ok(calSignatureValid("s3cret", raw, sig.toUpperCase()));
  assert.ok(!calSignatureValid("other", raw, sig));
  assert.ok(!calSignatureValid("s3cret", raw + " ", sig));
  assert.ok(!calSignatureValid("s3cret", raw, "no-secret-provided"));
  assert.ok(!calSignatureValid("s3cret", raw, null));
  assert.ok(!calSignatureValid("", raw, sig));
});

test("a booking: who, when, what they typed, how they heard about us", () => {
  const event = parseCalEvent(created);
  assert.equal(event.kind, "booking");
  if (event.kind !== "booking") return;
  const b = event.booking;
  assert.equal(b.email, "naga@aegis360.space");
  assert.equal(b.name, "Naga Vinnakota");
  assert.equal(b.companyName, "Aegis 360 Inc");
  assert.equal(b.heardFrom, "Google");
  assert.equal(b.notes, "Seed - 9.8M");
  assert.deepEqual(b.guests, ["ak@aegis360.space"]);
  assert.equal(b.start, "2026-11-12T19:30:00.000Z");
  assert.equal(b.videoUrl, "https://app.cal.com/video/5hgN2LEbz71SSypHgopkJd");
  assert.equal(b.location, "integrations:daily");
  assert.equal(b.status, "ACCEPTED");
  assert.equal(b.bookedAt, "2026-11-12T08:55:37.153Z");
  assert.deepEqual(b.utm, { utm_source: "linkedin" });
  // A hidden field with no answer is dropped; a hidden field with an answer (UTM) is kept.
  assert.ok(!("attendeePhoneNumber" in b.responses));
  assert.equal(b.responses["Company-Name"].label, "Company Name");
});

test("reschedules, cancellations and other events", () => {
  const moved = parseCalEvent({ ...created, triggerEvent: "BOOKING_RESCHEDULED", payload: { ...created.payload, uid: "new", rescheduleUid: "5hgN2LEbz71SSypHgopkJd" } });
  assert.ok(moved.kind === "booking" && moved.booking.rescheduledFromUid === "5hgN2LEbz71SSypHgopkJd");
  const cancelled = parseCalEvent({ ...created, triggerEvent: "BOOKING_CANCELLED", payload: { ...created.payload, status: "ACCEPTED", cancellationReason: "Conflict" } });
  assert.ok(cancelled.kind === "booking" && cancelled.booking.status === "CANCELLED" && cancelled.booking.cancellationReason === "Conflict");
  const requested = parseCalEvent({ ...created, triggerEvent: "BOOKING_REQUESTED" });
  assert.ok(requested.kind === "booking" && requested.booking.status === "PENDING");
  assert.equal(parseCalEvent({ triggerEvent: "PING", payload: {} }).kind, "ignored");
  assert.equal(parseCalEvent({ triggerEvent: "MEETING_ENDED", uid: "x" }).kind, "ignored");
  assert.equal(parseCalEvent({ triggerEvent: "BOOKING_CREATED", payload: {} }).kind, "ignored");
  assert.equal(parseCalEvent("nope").kind, "ignored");
});

test("website from a work email only; a client stays a client after a new booking", () => {
  assert.equal(websiteFromEmail("naga@aegis360.space"), "https://aegis360.space");
  assert.equal(websiteFromEmail("someone@gmail.com"), null);
  assert.equal(websiteFromEmail("broken"), null);
  assert.equal(statusAfterBooking("converted"), "converted");
  assert.equal(statusAfterBooking("not_a_fit"), "call_booked");
  assert.equal(statusAfterBooking(null), "call_booked");
});

const OPTIONS: FitOptions = {
  financing: [{ id: "financing.equity", label: "Equity" }, { id: "financing.debt", label: "Debt" }],
  stage: [{ id: "stage.seed", label: "Seed" }, { id: "stage.pre_seed", label: "Pre-Seed" }, { id: "stage.series_a", label: "Series A" }],
  geography: [{ id: "us", label: "United States" }, { id: "europe", label: "Europe" }],
  sector: [{ id: "sector.grp.deeptech", label: "Hardware & deep tech" }, { id: "sector.grp.software", label: "Software & IT" }, { id: "sector.grp.health", label: "Health & life sciences" }],
};

test("the brief keeps only real options (an id or its exact label) and drops LinkedIn sources", () => {
  const brief = cleanBrief(
    {
      person: { summary: "CEO.", facts: ["a", "b", "c", "d"] },
      company: { one_liner: "Space situational awareness.", rounds: [{ round: "Pre-seed", amount: "$1M" }, {}] },
      raise: { stage: "Seed", amount: "$9.8M" },
      fit: { financing: ["financing.equity"], stage: ["Seed", "stage.unknown"], geography: ["United States"], sector: ["sector.grp.deeptech", "Software & IT", "sector.grp.health"] },
      questions: ["q1", "q2", "q3", "q4"],
      sources: [{ url: "https://aegis360.space" }, { url: "https://www.linkedin.com/in/x" }, { url: "not a url" }],
    },
    OPTIONS,
  );
  assert.deepEqual(brief.fit.stage, ["stage.seed"]);
  assert.deepEqual(brief.fit.geography, ["us"]);
  assert.deepEqual(brief.fit.sector, ["sector.grp.deeptech", "sector.grp.software"]);
  assert.equal(brief.person.facts.length, 3);
  assert.equal(brief.questions.length, 3);
  assert.equal(brief.company.rounds.length, 1);
  assert.deepEqual(brief.sources.map((s) => s.url), ["https://aegis360.space"]);
  // Junk in, empty brief out: never throws.
  assert.equal(cleanBrief(null, OPTIONS).company.oneLiner, "");
});

test("example funds: specialists with contacts first, most focused first", () => {
  const f = (name: string, generalist: boolean, groups: number, contacts = 2) => ({ name, generalist, groups, stages: 2, type: "VC", place: "", website: "", contacts });
  const picked = exampleFunds([f("Broad", true, 1), f("Wide", false, 6), f("Focused", false, 1), f("Nobody", false, 1, 0), f("Also", false, 2)], 3);
  assert.deepEqual(picked.map((p) => p.name), ["Focused", "Also", "Wide"]);
});

test("the prep email goes 30 minutes before, now when that has passed, never after the call", () => {
  const start = "2026-11-12T19:30:00.000Z";
  const end = "2026-11-12T20:00:00.000Z";
  const at = (iso: string) => Date.parse(iso);
  assert.deepEqual(prepSendAt(start, end, at("2026-11-12T09:00:00Z")), { at: "2026-11-12T19:00:00.000Z", now: false });
  assert.deepEqual(prepSendAt(start, end, at("2026-11-12T19:10:00Z")), { at: "2026-11-12T19:10:00.000Z", now: true });
  assert.equal(prepSendAt(start, end, at("2026-11-12T20:05:00Z")).at, null);
  assert.equal(prepSendAt(start, end, at("2026-10-01T00:00:00Z")).at, null);
  assert.equal(prepSendAt(null, null, 0).at, null);
  assert.deepEqual(checkinSendAt(start, end, at("2026-11-12T09:00:00Z")), { at: "2026-11-12T20:15:00.000Z", now: false });
  assert.equal(checkinSendAt(start, end, at("2026-11-12T21:00:00Z")).at, null);
});

const estimate: MatchEstimate = {
  total: 9000,
  steps: [
    { step: "financing", label: "Financing type", chosen: ["Equity"], left: 6000 },
    { step: "stage", label: "Stage", chosen: ["Pre-Seed", "Seed"], left: 3000 },
    { step: "geography", label: "Geography", chosen: ["United States"], left: 1500 },
    { step: "sector", label: "Sector", chosen: ["Hardware & deep tech"], left: 412 },
  ],
  count: 412,
  examples: [{ name: "Space Capital", type: "VC", place: "New York, US", website: "https://spacecapital.com" }],
  open: [],
  fundDbVersion: "v1",
  at: "2026-11-12T10:00:00Z",
};

test("the prep email has the call, what they told us, the estimate and the links; HTML is escaped", () => {
  const email = prepEmail(
    {
      name: "Naga <Vinnakota>",
      email: "naga@aegis360.space",
      companyName: "Aegis 360 Inc",
      heardFrom: "Google",
      website: "https://aegis360.space",
      brief: cleanBrief({ company: { one_liner: "SSA for satellites." }, raise: { stage: "Seed", amount: "$9.8M" }, questions: ["Lead or follow?"] }, OPTIONS),
      briefError: null,
      match: estimate,
    },
    { start: "2026-11-12T19:30:00.000Z", end: "2026-11-12T20:00:00.000Z", timeZone: "America/Los_Angeles", videoUrl: "https://app.cal.com/video/x", location: null, notes: "Seed - 9.8M", guests: [], extraAnswers: [{ label: "Company Name", value: "Aegis 360 Inc" }] },
    "https://www.heyrupert.com/admin/prospects/1",
  );
  assert.equal(email.subject, "In 30 min: Naga <Vinnakota>, Aegis 360 Inc (Seed, $9.8M)");
  assert.match(email.text, /Thu, Nov 12, 11:30\s?AM–12:00\s?PM PST/);
  assert.match(email.text, /About 412 of 9,000 funds: Equity · Pre-Seed, Seed · United States · Hardware & deep tech/);
  assert.match(email.text, /Heard about us: Google/);
  assert.match(email.text, /1\. Lead or follow\?/);
  assert.match(email.html, /Naga &lt;Vinnakota&gt;/);
  assert.ok(!email.html.includes("<Vinnakota>"));
  assert.match(email.html, /href="https:\/\/app\.cal\.com\/video\/x"/);
  assert.match(email.html, /admin\/prospects\/1/);
  // Without a brief it still goes out and says why.
  const bare = prepEmail({ name: "N", email: "n@x.com", companyName: null, heardFrom: null, website: null, brief: null, briefError: "timed out", match: null }, { start: null, end: null, timeZone: "UTC", videoUrl: null, location: null, notes: null, guests: [], extraAnswers: [] }, "u");
  assert.match(bare.text, /No brief: timed out/);
});

test("Convert to client fills the Add Client form", () => {
  const form = clientPrefill({
    name: "Naga Rao Vinnakota",
    email: "naga@aegis360.space",
    company_name: "Aegis 360 Inc",
    website: "https://aegis360.space/",
    brief: cleanBrief({ raise: { stage: "Seed round", amount: "$9.8M" }, company: { hq_country: "United States" } }, OPTIONS),
    match: estimate,
    outcome_notes: "Wants a lead.",
  });
  assert.equal(form.first_name, "Naga");
  assert.equal(form.last_name, "Rao Vinnakota");
  assert.equal(form.company_website, "aegis360.space");
  assert.equal(form.raise_stage, "Seed");
  assert.equal(form.raise_amount, "$9.8M");
  assert.equal(form.vertical, "Hardware & deep tech");
  assert.equal(form.geography, "United States");
  assert.match(form.admin_notes, /Wants a lead/);
  assert.equal(raiseStageOf("pre-seed"), "Pre-seed");
  assert.equal(raiseStageOf("", "Pre-Seed, Seed"), "Seed");
  assert.equal(raiseStageOf("Series A extension"), "Series A");
  assert.equal(raiseStageOf("growth"), "");
});

test("prospects.sql seeds exactly the registry's text for both prospect prompts", () => {
  const sql = readFileSync(join(portal, "supabase/prospects.sql"), "utf8").replace(/\r\n/g, "\n");
  for (const key of ["prospect_brief", "prospect_follow_up"]) {
    const prompt = PROMPTS.find((p) => p.key === key)!;
    assert.ok(sql.includes(`'${prompt.slug}'`), prompt.slug);
    assert.ok(sql.includes(`$rupert_prompt$${prompt.defaultText}$rupert_prompt$`), `${key}: text differs from the registry`);
  }
});

test("prospects_fit_inference.sql moves the brief prompt to exactly the registry's text", () => {
  const sql = readFileSync(join(portal, "supabase/prospects_fit_inference.sql"), "utf8").replace(/\r\n/g, "\n");
  const prompt = PROMPTS.find((p) => p.key === "prospect_brief")!;
  assert.ok(sql.includes(`v_new text := $rupert_prompt$${prompt.defaultText}$rupert_prompt$`));
  assert.ok(sql.includes("btrim(v_active) = btrim(v_old)"), "an edited prompt is left alone");
});

test("no estimate until stage, geography and sector are all known", () => {
  const partial: MatchEstimate = { ...estimate, steps: estimate.steps.filter((s) => s.step !== "sector" && s.step !== "geography"), open: ["Geography", "Sector"] };
  assert.deepEqual(estimateMissing(partial), ["geography", "sector"]);
  assert.ok(!estimateReady(partial));
  assert.ok(!estimateReady(null));
  assert.equal(missingText(["stage", "geography", "sector"]), "stage, geography and sector");
  assert.ok(estimateReady(estimate));
  const email = prepEmail(
    { name: "N", email: "n@x.com", companyName: "X", heardFrom: null, website: null, brief: cleanBrief({}, OPTIONS), briefError: null, match: partial },
    { start: null, end: null, timeZone: "UTC", videoUrl: null, location: null, notes: null, guests: [], extraAnswers: [] },
    "u",
  );
  assert.match(email.text, /No estimate: geography and sector not known yet/);
  assert.ok(!email.text.includes("412"));
  assert.ok(!email.html.includes("funds fit"));
});
