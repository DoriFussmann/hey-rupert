import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { sendAdminEmail } from "@/lib/email";
import { selectAll } from "@/lib/match/db-server";
import { loadOutreachMessages } from "@/lib/outreach/core-server";
import {
  asReplyLabel,
  clientTotals,
  deliveryPatch,
  fundStage,
  replyLabelText,
  replyText,
  type PipelineStage,
  type ReplyLabel,
  type ReplyVisibility,
} from "@/lib/outreach/live";
import { PORTAL_URL } from "@/lib/portal-url";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (value: unknown, max = 20000) => (value == null ? "" : String(value)).slice(0, max);

// ---------------------------------------------------------------------------
// Webhook events

/**
 * One Instantly webhook delivery: logged, applied to the contact's delivery
 * fields, and for replies saved for Rupert's triage. Test campaigns are only logged.
 */
export async function handleInstantlyEvent(supabase: ServiceClient, payload: Record<string, unknown>): Promise<"ok" | "ignored" | "error"> {
  const eventType = str(payload.event_type, 100);
  const campaignId = str(payload.campaign_id, 100);
  // Only a UUID goes into the filter below.
  if (!eventType || !/^[0-9a-f-]{36}$/i.test(campaignId)) return "ignored";

  const { data: owner } = await supabase
    .from("outreach_campaigns")
    .select("client_id, instantly_campaign_id, test_campaign_id")
    .or(`instantly_campaign_id.eq.${campaignId},test_campaign_id.eq.${campaignId}`)
    .limit(1)
    .maybeSingle();
  const clientId = owner?.client_id ? String(owner.client_id) : null;
  const leadEmail = str(payload.lead_email, 320).trim().toLowerCase();
  const step = Number(payload.step) || null;
  const at = str(payload.timestamp, 60) || new Date().toISOString();

  const logged = await supabase.from("outreach_events").insert({
    client_id: clientId,
    instantly_campaign_id: campaignId,
    event_type: eventType,
    lead_email: leadEmail || null,
    step,
    payload,
  });
  if (logged.error) return "error";
  if (!clientId || owner?.instantly_campaign_id !== campaignId) return "ignored";

  const messages = await loadOutreachMessages(supabase, clientId);
  if (!messages.ok) return "error";
  const message = messages.value.find((m) => m.person.email.trim().toLowerCase() === leadEmail) ?? null;

  const patch = deliveryPatch(eventType, at, step);
  if (message && patch) {
    // First time only for opened/replied/bounced/meeting; sent keeps the latest step.
    const current = message as unknown as Record<string, unknown>;
    const update = Object.fromEntries(
      Object.entries(patch).filter(([key]) => key === "sent_at" || key === "last_step" || !current[key]),
    );
    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from("outreach_messages").update(update).eq("id", message.id);
      if (error) return "error";
    }
  }

  if (eventType === "reply_received" || eventType === "auto_reply_received") {
    const auto = eventType === "auto_reply_received";
    const emailId = str(payload.email_id, 200) || null;
    const body = replyText(str(payload.reply_text), str(payload.reply_html));
    const { error } = await supabase.from("outreach_replies").insert({
      client_id: clientId,
      message_id: message?.id ?? null,
      firm_id: message?.firm_id ?? "",
      fund_name: message?.fund_name ?? "",
      person_name: message?.person.name ?? "",
      lead_email: leadEmail,
      subject: str(payload.reply_subject, 500),
      body: body || str(payload.reply_text_snippet, 2000),
      auto_reply: auto,
      received_at: at,
      instantly_email_id: emailId,
      unibox_url: str(payload.unibox_url, 1000) || null,
      ...(auto ? { label: "out_of_office", summary: "Automatic reply.", labelled_at: new Date().toISOString() } : {}),
    });
    // A retried delivery hits the unique email id: already saved.
    if (error && error.code !== "23505") return "error";
    if (!error && !auto) {
      await sendAdminEmail(
        `Investor reply: ${message?.fund_name || leadEmail}`,
        [
          `${message?.person.name || leadEmail}${message?.fund_name ? ` (${message.fund_name})` : ""} replied.`,
          body.slice(0, 600),
          `Review and release it: ${PORTAL_URL}/admin/replies`,
        ].join("\n\n"),
      );
    }
  }
  return "ok";
}

// ---------------------------------------------------------------------------
// Rupert's triage

export type AdminReply = {
  id: string;
  client_id: string;
  client_name: string;
  fund_name: string;
  person_name: string;
  lead_email: string;
  subject: string;
  body: string;
  auto_reply: boolean;
  received_at: string;
  unibox_url: string | null;
  label: ReplyLabel | null;
  summary: string;
  visibility: ReplyVisibility;
  withheld_reason: string;
  decided_by: string | null;
  decided_at: string | null;
};

function asAdminReply(row: Record<string, unknown>, names: Map<string, string>): AdminReply {
  const visibility = row.visibility === "released" || row.visibility === "withheld" ? row.visibility : "pending";
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    client_name: names.get(String(row.client_id)) ?? "",
    fund_name: str(row.fund_name, 300),
    person_name: str(row.person_name, 200),
    lead_email: str(row.lead_email, 320),
    subject: str(row.subject, 500),
    body: str(row.body),
    auto_reply: Boolean(row.auto_reply),
    received_at: String(row.received_at),
    unibox_url: row.unibox_url ? String(row.unibox_url) : null,
    label: asReplyLabel(row.label),
    summary: str(row.summary, 1000),
    visibility,
    withheld_reason: str(row.withheld_reason, 500),
    decided_by: row.decided_by ? String(row.decided_by) : null,
    decided_at: row.decided_at ? String(row.decided_at) : null,
  };
}

export async function listAdminReplies(supabase: ServiceClient, filter: "pending" | "all"): Promise<Result<AdminReply[]>> {
  let query = supabase.from("outreach_replies").select("*").order("received_at", { ascending: false }).limit(300);
  if (filter === "pending") query = query.eq("visibility", "pending");
  const { data, error } = await query;
  if (error) return { ok: false, error: /outreach_replies/.test(error.message) ? "Run portal/supabase/outreach_live.sql in Supabase first." : error.message };
  const ids = Array.from(new Set((data ?? []).map((row) => String(row.client_id))));
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: clients } = await supabase.from("clients").select("id, company_name").in("id", ids);
    for (const c of clients ?? []) names.set(String(c.id), String(c.company_name ?? ""));
  }
  return { ok: true, value: (data ?? []).map((row) => asAdminReply(row, names)) };
}

/** Rupert releases a reply to the client, withholds it, or changes its label. */
export async function decideReply(
  supabase: ServiceClient,
  id: string,
  decision: { visibility?: ReplyVisibility; reason?: string; label?: string },
  actor: string | null,
): Promise<Result<null>> {
  const patch: Record<string, unknown> = {};
  if (decision.label !== undefined) {
    const label = asReplyLabel(decision.label);
    if (!label) return { ok: false, error: "Unknown label." };
    patch.label = label;
  }
  if (decision.visibility) {
    patch.visibility = decision.visibility;
    patch.withheld_reason = decision.visibility === "withheld" ? str(decision.reason, 500) : "";
    patch.decided_by = decision.visibility === "pending" ? null : actor;
    patch.decided_at = decision.visibility === "pending" ? null : new Date().toISOString();
  }
  const { error } = await supabase.from("outreach_replies").update(patch).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true, value: null };
}

/** Contacts that bounced or said they left, per client: candidates for a reserve. */
export async function bouncedContacts(supabase: ServiceClient) {
  const { data } = await supabase
    .from("outreach_messages")
    .select("client_id, fund_name, firm_id, person, bounced_at")
    .not("bounced_at", "is", null)
    .order("bounced_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((row) => ({
    client_id: String(row.client_id),
    fund_name: String(row.fund_name),
    name: String((row.person as { name?: string } | null)?.name ?? ""),
    email: String((row.person as { email?: string } | null)?.email ?? ""),
    bounced_at: String(row.bounced_at),
  }));
}

// ---------------------------------------------------------------------------
// What the client sees

export type ClientReply = {
  id: string;
  investor: string;
  fund: string;
  email: string;
  subject: string;
  preview: string;
  body: string;
  received_at: string;
  unread: boolean;
  label: string;
};

export async function releasedRepliesFor(supabase: ServiceClient, clientId: string): Promise<ClientReply[]> {
  const rows = await selectAll<Record<string, unknown>>((from, to) =>
    supabase
      .from("outreach_replies")
      .select("*")
      .eq("client_id", clientId)
      .eq("visibility", "released")
      .order("received_at", { ascending: false })
      .range(from, to),
  );
  if (!rows.ok) return [];
  return rows.rows.map((row) => {
    const body = str(row.body);
    return {
      id: String(row.id),
      investor: str(row.person_name, 200) || str(row.lead_email, 320),
      fund: str(row.fund_name, 300),
      email: str(row.lead_email, 320),
      subject: str(row.subject, 500) || "(no subject)",
      preview: body.slice(0, 160),
      body,
      received_at: String(row.received_at),
      unread: !row.client_read_at,
      label: replyLabelText(row.label as string | null),
    };
  });
}

export async function markRepliesRead(supabase: ServiceClient, clientId: string, ids: string[]) {
  if (ids.length === 0) return;
  await supabase
    .from("outreach_replies")
    .update({ client_read_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("visibility", "released")
    .in("id", ids.slice(0, 200))
    .is("client_read_at", null);
}

export type ClientFund = { firm_id: string; fund: string; contacts: string; tier: number; stage: PipelineStage };

/** The client's funds by stage, and totals. Only released replies count. */
export async function clientLiveData(supabase: ServiceClient, clientId: string) {
  const messages = await loadOutreachMessages(supabase, clientId);
  if (!messages.ok) return { funds: [] as ClientFund[], totals: clientTotals([], []) };
  const active = messages.value.filter((m) => m.slot === "active");
  const released = await supabase.from("outreach_replies").select("firm_id, label").eq("client_id", clientId).eq("visibility", "released");
  const releasedRows = (released.data ?? []).map((row) => ({ firm_id: String(row.firm_id), label: row.label ? String(row.label) : null }));
  const byFirm = new Map<string, typeof active>();
  for (const m of active) byFirm.set(m.firm_id, [...(byFirm.get(m.firm_id) ?? []), m]);
  const funds: ClientFund[] = [];
  byFirm.forEach((rows, firmId) => {
    const stage = fundStage(rows, releasedRows.filter((reply) => reply.firm_id === firmId));
    if (!stage) return;
    funds.push({
      firm_id: firmId,
      fund: rows[0].fund_name,
      contacts: rows.map((r) => r.person.name).filter(Boolean).join(", "),
      tier: rows[0].tier,
      stage,
    });
  });
  return { funds, totals: clientTotals(active, releasedRows) };
}
