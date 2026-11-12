import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { PORTAL_URL } from "@/lib/portal-url";
import type { FormAnswer, MatchEstimate, ProspectBrief, ProspectStatus } from "@/lib/prospects/core";

// Prospect rows and reads, shared by the AI side (./ai-server.ts) and the
// side that stores bookings and sends email (./server.ts). Sends nothing.

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export const PROSPECTS_MIGRATION =
  "Prospects are not set up in the database yet. Run portal/supabase/prospects.sql in the Supabase SQL editor.";

export function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205" || /prospect|cal_webhook_events/.test(message) ? PROSPECTS_MIGRATION : message;
}

/** Times in emails and on the pages are shown in Rupert's own time zone. */
export const ADMIN_TIME_ZONE = process.env.ADMIN_TIME_ZONE || "America/Los_Angeles";

export const prospectUrl = (id: string) => `${PORTAL_URL}/admin/prospects/${id}`;

export const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Rows

export type ProspectRow = {
  id: string;
  email: string;
  name: string | null;
  company_name: string | null;
  website: string | null;
  heard_from: string | null;
  utm: Record<string, string> | null;
  status: ProspectStatus;
  brief: ProspectBrief | null;
  brief_status: "pending" | "running" | "ready" | "failed";
  brief_error: string | null;
  brief_at: string | null;
  match: MatchEstimate | null;
  match_at: string | null;
  outcome_notes: string | null;
  outcome_at: string | null;
  outcome_by: string | null;
  follow_up: { subject: string; body: string; draftedAt: string } | null;
  follow_up_sent_at: string | null;
  reminder_sent_at: string | null;
  client_id: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CallRow = {
  id: string;
  prospect_id: string;
  cal_uid: string;
  status: string;
  last_event: string | null;
  event_title: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  video_url: string | null;
  guests: string[];
  notes: string | null;
  responses: Record<string, FormAnswer> | null;
  rescheduled_from_uid: string | null;
  cancellation_reason: string | null;
  booked_at: string | null;
  prep_email_id: string | null;
  prep_email_at: string | null;
  prep_email_status: "scheduled" | "sent" | "failed" | "cancelled" | null;
  prep_email_error: string | null;
  checkin_email_id: string | null;
  checkin_email_at: string | null;
  checkin_email_status: "scheduled" | "sent" | "failed" | "cancelled" | null;
  created_at: string;
};

export const PROSPECT_COLUMNS =
  "id, email, name, company_name, website, heard_from, utm, status, brief, brief_status, brief_error, brief_at, match, match_at, outcome_notes, outcome_at, outcome_by, follow_up, follow_up_sent_at, reminder_sent_at, client_id, converted_at, created_at, updated_at";
export const CALL_COLUMNS =
  "id, prospect_id, cal_uid, status, last_event, event_title, start_time, end_time, location, video_url, guests, notes, responses, rescheduled_from_uid, cancellation_reason, booked_at, prep_email_id, prep_email_at, prep_email_status, prep_email_error, checkin_email_id, checkin_email_at, checkin_email_status, created_at";

export async function getProspectRow(supabase: ServiceClient, id: string): Promise<Result<{ prospect: ProspectRow }>> {
  const { data, error } = await supabase.from("prospects").select(PROSPECT_COLUMNS).eq("id", id).maybeSingle<ProspectRow>();
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  if (!data) return { ok: false, error: "Prospect not found." };
  return { ok: true, prospect: data };
}

export async function callsOf(supabase: ServiceClient, prospectId: string): Promise<Result<{ calls: CallRow[] }>> {
  const { data, error } = await supabase
    .from("prospect_calls")
    .select(CALL_COLUMNS)
    .eq("prospect_id", prospectId)
    .order("start_time", { ascending: false });
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true, calls: (data ?? []) as CallRow[] };
}

export type ProspectListItem = ProspectRow & { nextCall: CallRow | null; lastCall: CallRow | null };

/** Every prospect that isn't a client yet, with its next (or last) call. */
export async function listProspects(supabase: ServiceClient): Promise<Result<{ prospects: ProspectListItem[] }>> {
  const { data, error } = await supabase
    .from("prospects")
    .select(PROSPECT_COLUMNS)
    .is("client_id", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  const rows = (data ?? []) as ProspectRow[];
  if (!rows.length) return { ok: true, prospects: [] };
  const { data: calls, error: callError } = await supabase
    .from("prospect_calls")
    .select(CALL_COLUMNS)
    .in("prospect_id", rows.map((r) => r.id))
    .order("start_time", { ascending: true });
  if (callError) return { ok: false, error: tableError(callError.message, callError.code) };
  const t = Date.now();
  return {
    ok: true,
    prospects: rows.map((row) => {
      const mine = ((calls ?? []) as CallRow[]).filter((c) => c.prospect_id === row.id && c.status !== "RESCHEDULED");
      const live = mine.filter((c) => c.status === "ACCEPTED" || c.status === "PENDING");
      return {
        ...row,
        nextCall: live.find((c) => c.end_time && Date.parse(c.end_time) > t) ?? null,
        lastCall: mine[mine.length - 1] ?? null,
      };
    }),
  };
}

export async function loadProspect(supabase: ServiceClient, id: string): Promise<Result<{ prospect: ProspectRow; calls: CallRow[] }>> {
  const p = await getProspectRow(supabase, id);
  if (!p.ok) return p;
  const c = await callsOf(supabase, id);
  if (!c.ok) return c;
  return { ok: true, prospect: p.prospect, calls: c.calls };
}

