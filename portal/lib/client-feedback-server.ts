import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { FEEDBACK_ABOUT, type ClientFeedback, type FeedbackAbout } from "@/lib/client-feedback";
import { FEEDBACK_CHANNELS, type FeedbackChannel } from "@/lib/setup";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const FEEDBACK_MIGRATION = "The client feedback table is missing. Run portal/supabase/client_feedback.sql in the Supabase SQL editor.";

function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /client_feedback/.test(message) || message.toLowerCase().includes("schema cache") ? FEEDBACK_MIGRATION : message;
}

type Row = {
  id: string;
  about: string;
  channel: string;
  said_on: string;
  original: string;
  summary: string | null;
  logged_by: string | null;
  created_at: string;
};

function fromRow(r: Row): ClientFeedback {
  return {
    id: r.id,
    about: (FEEDBACK_ABOUT as readonly string[]).includes(r.about) ? (r.about as FeedbackAbout) : "general",
    channel: (FEEDBACK_CHANNELS as readonly string[]).includes(r.channel) ? (r.channel as FeedbackChannel) : "email",
    on: String(r.said_on).slice(0, 10),
    original: r.original,
    summary: r.summary,
    loggedBy: r.logged_by,
    createdAt: r.created_at,
  };
}

/** The client's feedback, newest first. A missing table reads as none. */
export async function loadClientFeedback(supabase: ServiceClient, clientId: string): Promise<Result<ClientFeedback[]>> {
  const { data, error } = await supabase
    .from("client_feedback")
    .select("id, about, channel, said_on, original, summary, logged_by, created_at")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("said_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    const message = tableError(error.message, error.code);
    return message === FEEDBACK_MIGRATION ? { ok: true, value: [] } : { ok: false, error: message };
  }
  return { ok: true, value: ((data ?? []) as Row[]).map(fromRow) };
}

export async function insertClientFeedback(
  supabase: ServiceClient,
  clientId: string,
  f: { id: string; about: FeedbackAbout; channel: FeedbackChannel; on: string; original: string; summary: string | null; by: string | null },
): Promise<Result<null>> {
  const { error } = await supabase.from("client_feedback").insert({
    id: f.id,
    client_id: clientId,
    about: f.about,
    channel: f.channel,
    said_on: f.on,
    original: f.original,
    summary: f.summary,
    logged_by: f.by,
  });
  return error ? { ok: false, error: tableError(error.message, error.code) } : { ok: true, value: null };
}

export async function updateFeedbackSummary(supabase: ServiceClient, clientId: string, id: string, summary: string): Promise<Result<ClientFeedback | null>> {
  const { data, error } = await supabase
    .from("client_feedback")
    .update({ summary: summary || null, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, about, channel, said_on, original, summary, logged_by, created_at")
    .maybeSingle<Row>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, value: data ? fromRow(data) : null };
}

export async function deleteClientFeedback(supabase: ServiceClient, clientId: string, id: string): Promise<Result<null>> {
  const { error } = await supabase.from("client_feedback").update({ deleted_at: new Date().toISOString() }).eq("client_id", clientId).eq("id", id);
  return error ? { ok: false, error: tableError(error.message, error.code) } : { ok: true, value: null };
}
