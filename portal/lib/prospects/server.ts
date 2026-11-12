import "server-only";
import { adminAddresses, cancelScheduledEmail, sendEmail } from "@/lib/email";
import type { createServiceClient } from "@/lib/supabase/admin";
import { buildBriefAndEstimate } from "@/lib/prospects/ai-server";
import {
  REMINDER_AFTER_MS,
  answerText,
  checkinEmail,
  checkinSendAt,
  isProspectStatus,
  prepEmail,
  prepSendAt,
  reminderEmail,
  statusAfterBooking,
  websiteFromEmail,
  type CallForEmail,
  type ParsedBooking,
  type ProspectStatus,
} from "@/lib/prospects/core";
import {
  ADMIN_TIME_ZONE,
  CALL_COLUMNS,
  callsOf,
  getProspectRow,
  loadProspect,
  now,
  prospectUrl,
  tableError,
  type CallRow,
  type ProspectRow,
} from "@/lib/prospects/data-server";

// Prospects: storing Cal.com bookings, the emails around each call (Resend,
// scheduled), the follow-up send and the daily check. The AI drafts are in
// ./ai-server.ts; nothing written by AI is sent from there.

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export { ADMIN_TIME_ZONE, listProspects, loadProspect, type CallRow, type ProspectListItem, type ProspectRow } from "@/lib/prospects/data-server";
export { buildBriefAndEstimate, draftFollowUp, estimateOptions, recomputeEstimate } from "@/lib/prospects/ai-server";

/** Answers that have their own place in the brief or the call, not "what they told us". */
const STANDARD_FIELDS = new Set(["name", "email", "notes", "guests", "location", "title", "attendeePhoneNumber", "rescheduleReason"]);

// ---------------------------------------------------------------------------
// The webhook

export type WebhookOutcome = { outcome: string; prospectId?: string; prepare?: boolean };

/** Applies one booking event. Returns whether the brief and emails should be prepared next. */
export async function applyBooking(supabase: ServiceClient, booking: ParsedBooking): Promise<Result<WebhookOutcome>> {
  if (!booking.email) return { ok: true, outcome: "ignored: no attendee email" };

  // The person: one prospect per email. Facts already there are kept.
  const { data: existing, error: findError } = await supabase
    .from("prospects")
    .select("id, name, company_name, website, heard_from, utm, status, client_id")
    .eq("email", booking.email)
    .maybeSingle<Pick<ProspectRow, "id" | "name" | "company_name" | "website" | "heard_from" | "utm" | "status" | "client_id">>();
  if (findError) return { ok: false, error: tableError(findError.message, findError.code) };

  const isNew = ["BOOKING_CREATED", "BOOKING_REQUESTED", "BOOKING_RESCHEDULED"].includes(booking.trigger);
  let prospectId = existing?.id ?? null;
  if (!prospectId) {
    const { data: created, error } = await supabase
      .from("prospects")
      .insert({
        email: booking.email,
        name: booking.name || null,
        company_name: booking.companyName,
        website: websiteFromEmail(booking.email),
        heard_from: booking.heardFrom,
        utm: booking.utm,
        status: booking.status === "CANCELLED" ? "cancelled" : "call_booked",
      })
      .select("id")
      .single<{ id: string }>();
    if (error) return { ok: false, error: tableError(error.message, error.code) };
    prospectId = created.id;
  } else {
    const patch: Record<string, unknown> = { updated_at: now() };
    if (!existing!.name && booking.name) patch.name = booking.name;
    if (!existing!.company_name && booking.companyName) patch.company_name = booking.companyName;
    if (!existing!.website) patch.website = websiteFromEmail(booking.email);
    if (!existing!.heard_from && booking.heardFrom) patch.heard_from = booking.heardFrom;
    if (!existing!.utm && booking.utm) patch.utm = booking.utm;
    if (isNew) patch.status = statusAfterBooking(isProspectStatus(existing!.status) ? existing!.status : null);
    const { error } = await supabase.from("prospects").update(patch).eq("id", prospectId);
    if (error) return { ok: false, error: tableError(error.message, error.code) };
  }

  // The call.
  const { data: before } = await supabase.from("prospect_calls").select(CALL_COLUMNS).eq("cal_uid", booking.uid).maybeSingle<CallRow>();
  const callPatch: Record<string, unknown> = {
    prospect_id: prospectId,
    cal_uid: booking.uid,
    cal_booking_id: booking.bookingId,
    status: booking.status,
    last_event: booking.trigger,
    event_title: booking.eventTitle,
    start_time: booking.start,
    end_time: booking.end,
    location: booking.location,
    video_url: booking.videoUrl,
    guests: booking.guests,
    notes: booking.notes,
    responses: booking.responses,
    raw: null,
    updated_at: now(),
  };
  if (booking.rescheduledFromUid) callPatch.rescheduled_from_uid = booking.rescheduledFromUid;
  if (booking.cancellationReason) callPatch.cancellation_reason = booking.cancellationReason;
  if (booking.bookedAt) callPatch.booked_at = booking.bookedAt;
  const { error: callError } = await supabase.from("prospect_calls").upsert(callPatch, { onConflict: "cal_uid" });
  if (callError) return { ok: false, error: tableError(callError.message, callError.code) };

  // A reschedule is a new booking: the old one is marked and its emails cancelled.
  if (booking.rescheduledFromUid) {
    const { data: old } = await supabase.from("prospect_calls").select(CALL_COLUMNS).eq("cal_uid", booking.rescheduledFromUid).maybeSingle<CallRow>();
    if (old) {
      await cancelCallEmails(supabase, old);
      await supabase.from("prospect_calls").update({ status: "RESCHEDULED", updated_at: now() }).eq("id", old.id);
    }
  }

  const timeChanged = before && (before.start_time !== booking.start || before.end_time !== booking.end);
  if (booking.status === "CANCELLED" || booking.status === "REJECTED") {
    if (before) await cancelCallEmails(supabase, before);
    // Cancelled with no other call ahead: the prospect is marked cancelled (unless already decided).
    const calls = await callsOf(supabase, prospectId);
    const ahead = calls.ok && calls.calls.some((c) => c.status === "ACCEPTED" && c.end_time && Date.parse(c.end_time) > Date.now());
    if (!ahead && (!existing || existing.status === "call_booked")) {
      await supabase.from("prospects").update({ status: "cancelled", updated_at: now() }).eq("id", prospectId);
    }
    return { ok: true, outcome: `cancelled ${booking.uid}`, prospectId };
  }
  if (timeChanged && before) await cancelCallEmails(supabase, before);
  return { ok: true, outcome: `${before ? "updated" : "stored"} ${booking.uid}`, prospectId, prepare: isNew || Boolean(timeChanged) };
}

export async function logWebhookEvent(supabase: ServiceClient, trigger: string, uid: string | null, outcome: string, payload: unknown) {
  const { error } = await supabase.from("cal_webhook_events").insert({ trigger_event: trigger, cal_uid: uid, outcome: outcome.slice(0, 500), payload });
  if (error) console.error(`Cal.com event not logged: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Emails around the call

function callForEmail(call: CallRow): CallForEmail {
  // Every other answer on the booking form (their company, custom questions); "how did you hear" has its own line.
  const extraAnswers = Object.entries(call.responses ?? {})
    .filter(([name]) => !STANDARD_FIELDS.has(name) && !/hear|referr/i.test(name))
    .map(([, a]) => ({ label: a.label, value: answerText(a.value) ?? "" }))
    .filter((a) => a.value);
  return {
    start: call.start_time,
    end: call.end_time,
    timeZone: ADMIN_TIME_ZONE,
    videoUrl: call.video_url,
    location: call.location,
    notes: call.notes,
    guests: call.guests ?? [],
    extraAnswers,
  };
}

export async function cancelCallEmails(supabase: ServiceClient, call: CallRow) {
  const patch: Record<string, unknown> = {};
  if (call.prep_email_id && call.prep_email_status === "scheduled") {
    const r = await cancelScheduledEmail(call.prep_email_id);
    patch.prep_email_status = r.ok ? "cancelled" : call.prep_email_status;
    if (!r.ok) patch.prep_email_error = r.reason;
  }
  if (call.checkin_email_id && call.checkin_email_status === "scheduled") {
    const r = await cancelScheduledEmail(call.checkin_email_id);
    patch.checkin_email_status = r.ok ? "cancelled" : call.checkin_email_status;
  }
  if (Object.keys(patch).length) {
    patch.updated_at = now();
    await supabase.from("prospect_calls").update(patch).eq("id", call.id);
  }
}

/**
 * Schedules the prep email (30 minutes before) and the check-in (15 minutes
 * after) for every upcoming call of the prospect that doesn't have them yet.
 * The prep email carries the brief as it is when it is scheduled.
 */
export async function scheduleCallEmails(supabase: ServiceClient, prospectId: string, { resend = false } = {}): Promise<Result<{ scheduled: number; notes: string[] }>> {
  const loaded = await loadProspect(supabase, prospectId);
  if (!loaded.ok) return loaded;
  const { prospect, calls } = loaded;
  const to = adminAddresses();
  if (!to.length) return { ok: false, error: "ADMIN_NOTIFY_EMAIL is not configured." };
  const url = prospectUrl(prospect.id);
  const t = Date.now();
  let scheduled = 0;
  const notes: string[] = [];

  for (const call of calls.filter((c) => c.status === "ACCEPTED" || c.status === "PENDING")) {
    // Prep email.
    // With `resend`, a waiting prep email is replaced and one already sent goes again now.
    const needsPrep = resend || !call.prep_email_status || call.prep_email_status === "failed" || call.prep_email_status === "cancelled";
    if (needsPrep) {
      const when = prepSendAt(call.start_time, call.end_time, t);
      if (when.at) {
        if (resend && call.prep_email_status === "scheduled") await cancelCallEmails(supabase, { ...call, checkin_email_status: null });
        const email = prepEmail(
          {
            name: prospect.name ?? "",
            email: prospect.email,
            companyName: prospect.company_name,
            heardFrom: prospect.heard_from,
            website: prospect.website,
            brief: prospect.brief,
            briefError: prospect.brief_status === "failed" ? prospect.brief_error : null,
            match: prospect.match,
          },
          callForEmail(call),
          url,
        );
        const sent = await sendEmail({ to, ...email, scheduledAt: when.now ? undefined : when.at });
        await supabase
          .from("prospect_calls")
          .update({
            prep_email_id: sent.ok ? sent.id ?? null : null,
            prep_email_at: when.at,
            prep_email_status: sent.ok ? (when.now ? "sent" : "scheduled") : "failed",
            prep_email_error: sent.ok ? null : sent.reason,
            updated_at: now(),
          })
          .eq("id", call.id);
        if (sent.ok) scheduled += 1;
        else notes.push(sent.reason);
      } else if ("reason" in when) notes.push(when.reason);
    }
    // Check-in after the call.
    if (!call.checkin_email_status || call.checkin_email_status === "failed") {
      const when = checkinSendAt(call.start_time, call.end_time, t);
      if (when.at) {
        const email = checkinEmail({ name: prospect.name ?? "", companyName: prospect.company_name }, url);
        const sent = await sendEmail({ to, ...email, scheduledAt: when.at });
        await supabase
          .from("prospect_calls")
          .update({
            checkin_email_id: sent.ok ? sent.id ?? null : null,
            checkin_email_at: when.at,
            checkin_email_status: sent.ok ? "scheduled" : "failed",
            updated_at: now(),
          })
          .eq("id", call.id);
        if (sent.ok) scheduled += 1;
        else notes.push(sent.reason);
      }
    }
  }
  return { ok: true, scheduled, notes };
}

/** A brief still being written: "running" for less than 10 minutes (longer means its run was cut off). */
function briefRunning(prospect: ProspectRow) {
  return prospect.brief_status === "running" && Date.now() - Date.parse(prospect.updated_at) < 10 * 60_000;
}

/** After a booking: the brief (first time only, or when it failed), then the emails. */
export async function prepareProspect(supabase: ServiceClient, prospectId: string) {
  const p = await getProspectRow(supabase, prospectId);
  if (!p.ok) return p;
  if (p.prospect.brief_status !== "ready" && !briefRunning(p.prospect)) {
    await buildBriefAndEstimate(supabase, prospectId);
  }
  return scheduleCallEmails(supabase, prospectId);
}

// ---------------------------------------------------------------------------
// After the call

export async function saveOutcome(supabase: ServiceClient, prospectId: string, status: ProspectStatus, notes: string, actor: string | null) {
  const { error } = await supabase
    .from("prospects")
    .update({ status, outcome_notes: notes.trim().slice(0, 8000) || null, outcome_at: now(), outcome_by: actor, reminder_sent_at: null, updated_at: now() })
    .eq("id", prospectId)
    .is("client_id", null);
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function sendFollowUp(supabase: ServiceClient, prospectId: string, subject: string, body: string): Promise<Result<object>> {
  const p = await getProspectRow(supabase, prospectId);
  if (!p.ok) return p;
  const s = subject.trim();
  const b = body.trim();
  if (!s || !b) return { ok: false, error: "The email needs a subject and a body." };
  // Rupert gets a copy, as with every email to a founder.
  const sent = await sendEmail({ to: [p.prospect.email], bcc: adminAddresses(), subject: s, text: b });
  if (!sent.ok) return { ok: false, error: sent.reason };
  await supabase
    .from("prospects")
    .update({ follow_up: { subject: s, body: b, draftedAt: p.prospect.follow_up?.draftedAt ?? now() }, follow_up_sent_at: now(), updated_at: now() })
    .eq("id", prospectId);
  return { ok: true };
}

/** A new client with the prospect's email: the prospect is marked converted. */
export async function linkProspectToClient(supabase: ServiceClient, email: string, clientId: string) {
  const { error } = await supabase
    .from("prospects")
    .update({ client_id: clientId, status: "converted", converted_at: now(), updated_at: now() })
    .eq("email", email.trim().toLowerCase())
    .is("client_id", null);
  if (error && !/prospects/.test(error.message)) console.error(`Prospect not linked to client: ${error.message}`);
}

// ---------------------------------------------------------------------------
// The daily check

/**
 * Once a day: emails for calls that were too far ahead to schedule, briefs
 * that failed, and one reminder about good-fit prospects 3+ days after the
 * call who aren't clients yet.
 */
export async function dailyProspectSweep(supabase: ServiceClient) {
  const out = { scheduled: 0, briefs: 0, reminded: 0, errors: [] as string[] };
  const t = Date.now();
  const { data: upcoming, error } = await supabase
    .from("prospect_calls")
    .select("prospect_id, prep_email_status, checkin_email_status, end_time")
    .in("status", ["ACCEPTED", "PENDING"])
    .gt("end_time", new Date(t).toISOString());
  if (error) return { ...out, errors: [tableError(error.message, error.code)] };
  const ids = Array.from(
    new Set((upcoming ?? []).filter((c) => !c.prep_email_status || c.prep_email_status === "failed" || !c.checkin_email_status || c.checkin_email_status === "failed").map((c) => String(c.prospect_id))),
  );
  for (const id of ids) {
    const p = await getProspectRow(supabase, id);
    if (p.ok && (p.prospect.brief_status === "failed" || (p.prospect.brief_status === "running" && !briefRunning(p.prospect)))) {
      const b = await buildBriefAndEstimate(supabase, id);
      if (b.ok) out.briefs += 1;
    }
    const r = await scheduleCallEmails(supabase, id);
    if (r.ok) out.scheduled += r.scheduled;
    else out.errors.push(r.error);
  }

  const cutoff = new Date(t - REMINDER_AFTER_MS).toISOString();
  const { data: waiting } = await supabase
    .from("prospects")
    .select("id, name, company_name, outcome_at")
    .eq("status", "follow_up")
    .is("client_id", null)
    .is("reminder_sent_at", null)
    .lt("outcome_at", cutoff);
  const due = (waiting ?? []) as { id: string; name: string | null; company_name: string | null; outcome_at: string }[];
  if (due.length && adminAddresses().length) {
    const email = reminderEmail(
      due.map((p) => ({ name: p.name ?? "Prospect", companyName: p.company_name, url: prospectUrl(p.id), days: Math.max(1, Math.round((t - Date.parse(p.outcome_at)) / 86_400_000)) })),
    );
    const sent = await sendEmail({ to: adminAddresses(), ...email });
    if (sent.ok) {
      await supabase.from("prospects").update({ reminder_sent_at: now() }).in("id", due.map((p) => p.id));
      out.reminded = due.length;
    } else out.errors.push(sent.reason);
  }
  return out;
}
