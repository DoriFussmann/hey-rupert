import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { notifyAdminOnce } from "@/lib/notify";
import { summarizeEvents, type TrackingEvent, type TrackingEventType } from "@/lib/email-tracking";

type ServiceClient = ReturnType<typeof createServiceClient>;

export const EMAIL_TRACKING_MIGRATION = "Email tracking is not set up yet. Run portal/supabase/email_tracking.sql in the Supabase SQL editor.";

function tableMissing(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || code === "42703" || code === "PGRST204" || message.toLowerCase().includes("schema cache");
}

export type RecordOutcome =
  | { ok: true; outcome: "recorded" | "duplicate" | "no_matching_email" }
  | { ok: false; error: string; retry: boolean };

/**
 * Stores one Resend event and brings the email's row in the history up to
 * date. The row is always rebuilt from every stored event for that email, so
 * retries and out-of-order deliveries can't leave it wrong.
 */
export async function recordTrackingEvent(
  supabase: ServiceClient,
  webhookId: string,
  event: TrackingEvent,
  payload: unknown,
): Promise<RecordOutcome> {
  const inserted = await supabase.from("email_events").insert({
    webhook_id: webhookId,
    resend_id: event.emailId,
    type: event.type,
    occurred_at: event.at,
    link: event.link,
    payload,
  });
  if (inserted.error) {
    // The same delivery again (Svix retries): already counted.
    if (inserted.error.code === "23505") return { ok: true, outcome: "duplicate" };
    if (tableMissing(inserted.error.message, inserted.error.code)) return { ok: false, error: EMAIL_TRACKING_MIGRATION, retry: false };
    return { ok: false, error: inserted.error.message, retry: true };
  }

  const { data: email, error: emailError } = await supabase
    .from("email_log")
    .select("id, client_id, subject, bounced_at")
    .eq("resend_id", event.emailId)
    .maybeSingle<{ id: string; client_id: string | null; subject: string; bounced_at: string | null }>();
  if (emailError) return { ok: false, error: emailError.message, retry: !tableMissing(emailError.message, emailError.code) };
  // An email that isn't in a client's history (an admin alert, a prospect email): kept, nothing to update.
  if (!email) return { ok: true, outcome: "no_matching_email" };

  const { data: events, error: eventsError } = await supabase
    .from("email_events")
    .select("type, occurred_at")
    .eq("resend_id", event.emailId)
    .returns<{ type: TrackingEventType; occurred_at: string }[]>();
  if (eventsError) return { ok: false, error: eventsError.message, retry: true };

  const state = summarizeEvents((events ?? []).map((e) => ({ type: e.type, at: new Date(e.occurred_at).toISOString() })));
  const { error: updateError } = await supabase.from("email_log").update(state).eq("id", email.id);
  if (updateError) return { ok: false, error: updateError.message, retry: true };

  // A client email that didn't arrive is something to act on: tell Rupert once.
  if ((event.type === "bounced" || event.type === "complained") && !email.bounced_at && email.client_id) {
    await notifyAdminOnce(supabase, email.client_id, "email_bounced", {
      email: true,
      details: `"${email.subject}" ${event.type === "bounced" ? "bounced" : "was marked as spam"}. Check the client's email address.`,
    });
  }
  return { ok: true, outcome: "recorded" };
}
