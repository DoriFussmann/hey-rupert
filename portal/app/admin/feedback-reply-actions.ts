"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { sendClientEmail } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import { isServiceRoleConfigured } from "@/lib/env";
import {
  cleanReply,
  collectPoints,
  hasReply,
  isReplyStatus,
  isUnsent,
  replyEmail,
  type ReplyStatus,
} from "@/lib/feedback-points";
import { FEEDBACK_REPLIES_TABLE, listReplyRows } from "@/lib/feedback-points-server";
import { PORTAL_URL } from "@/lib/portal-url";
import { loadSetupStep } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  VIEWER_COMMENT_STEP_LABEL,
  VIEWER_COMMENT_STEP_PATH,
  isViewerCommentStep,
  type ViewerCommentStep,
} from "@/lib/viewer-comments";
import { listViewerComments } from "@/lib/viewer-comments-server";
import { listClientViewers } from "@/lib/viewers";

// Replies to feedback: Rupert answers each point of the client's feedback (and
// each viewer comment) on the client page, then sends them all with "Respond".

export type ReplyEdit = { pointId: string; reply: string; status: string };
export type ReplyActionResult = { ok: true; sent?: number; emailed?: boolean } | { ok: false; error: string };

type Service = ReturnType<typeof createServiceClient>;

async function requireAdminService() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false as const, error: "Service role key is not configured." };
  }
  return { ok: true as const, supabase: createServiceClient() };
}

function tableError(message: string, code?: string) {
  return code === "42P01" || code === "PGRST205"
    ? "Feedback replies are not set up yet: run portal/supabase/feedback_replies.sql."
    : message;
}

async function loadClient(supabase: Service, clientId: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("id, first_name, email")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client not found." };
  const row = data as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return {
    ok: true as const,
    firstName: text(row.first_name),
    email: text(row.email),
  };
}

/**
 * Saves Rupert's working replies. The points are read again on the server
 * (from the client's answer and the viewers' comments), so a reply can only
 * be attached to a point that exists, with the words as they were written.
 */
async function saveEdits(
  supabase: Service,
  clientId: string,
  step: ViewerCommentStep,
  clientName: string,
  edits: ReplyEdit[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (edits.length === 0) return { ok: true };
  const loaded = await loadSetupStep(supabase, clientId, step);
  if (!loaded.ok) return loaded;
  if (!loaded.row) return { ok: false, error: "This step has nothing to reply to yet." };
  const points = collectPoints({
    history: loaded.row.history,
    response: loaded.row.response,
    comments: await listViewerComments(clientId, step),
    clientName,
  });
  const byId = new Map(points.map((point, position) => [point.id, { ...point, position }]));

  const rows = [];
  for (const edit of edits) {
    const point = byId.get(String(edit?.pointId ?? ""));
    if (!point) {
      return { ok: false, error: "A point changed since you opened this. Refresh and try again." };
    }
    const cleaned = cleanReply(edit.reply);
    if (!cleaned.ok) return cleaned;
    const status: ReplyStatus = isReplyStatus(edit.status) ? edit.status : "open";
    rows.push({
      client_id: clientId,
      step,
      version: point.version,
      point_id: point.id,
      source: point.source,
      author: point.author,
      label: point.label,
      point: point.text,
      position: point.position,
      reply: cleaned.reply,
      status,
      updated_at: new Date().toISOString(),
    });
  }
  const { error } = await supabase
    .from(FEEDBACK_REPLIES_TABLE)
    .upsert(rows, { onConflict: "client_id,step,point_id" });
  if (error) return { ok: false, error: tableError(error.message, error.code) };
  return { ok: true };
}

/** Saves the replies Rupert is working on. The client sees nothing yet. */
export async function saveFeedbackReplies(
  clientId: string,
  step: string,
  edits: ReplyEdit[],
): Promise<ReplyActionResult> {
  const admin = await requireAdminService();
  if (!admin.ok) return admin;
  if (!isViewerCommentStep(step)) return { ok: false, error: "Unknown step." };
  const client = await loadClient(admin.supabase, clientId);
  if (!client.ok) return client;

  const saved = await saveEdits(admin.supabase, clientId, step, client.firstName, Array.isArray(edits) ? edits : []);
  if (!saved.ok) return saved;
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/**
 * "Respond": saves any open edits, then sends every reply that is new or
 * changed. They appear in the portal under each point, and one email with all
 * of them goes to the client and the client's viewers.
 */
export async function sendFeedbackReplies(
  clientId: string,
  step: string,
  edits: ReplyEdit[],
): Promise<ReplyActionResult> {
  const admin = await requireAdminService();
  if (!admin.ok) return admin;
  const { supabase } = admin;
  if (!isViewerCommentStep(step)) return { ok: false, error: "Unknown step." };
  const client = await loadClient(supabase, clientId);
  if (!client.ok) return client;

  const saved = await saveEdits(supabase, clientId, step, client.firstName, Array.isArray(edits) ? edits : []);
  if (!saved.ok) return saved;

  const rows = (await listReplyRows(clientId, step)).filter((row) => isUnsent(row));
  if (rows.length === 0) return { ok: false, error: "There is nothing new to send." };
  const empty = rows.find((row) => !row.reply.trim() && row.status === "needs_input");
  if (empty) {
    return { ok: false, error: `Say what you need on "${empty.label}" before sending "Need your input".` };
  }

  const at = new Date().toISOString();
  for (const row of rows) {
    const { error } = await supabase
      .from(FEEDBACK_REPLIES_TABLE)
      .update({ published_reply: row.reply, published_status: row.status, published_at: at, updated_at: at })
      .eq("client_id", clientId)
      .eq("step", step)
      .eq("point_id", row.pointId);
    if (error) return { ok: false, error: tableError(error.message, error.code) };
  }

  // One email with every reply, to the client and the viewers they asked for.
  const viewers = await listClientViewers(clientId);
  const viewerEmails = viewers.ok
    ? viewers.viewers.filter((viewer) => viewer.welcomeSentAt).map((viewer) => viewer.email)
    : [];
  const to = Array.from(new Set([client.email, ...viewerEmails].filter(Boolean)));
  let emailed = false;
  if (to.length > 0) {
    const settings = await loadEmailSettings(supabase);
    const version = Math.max(...rows.map((row) => row.version));
    const message = replyEmail({
      firstName: client.firstName,
      stepLabel: VIEWER_COMMENT_STEP_LABEL[step],
      version,
      replies: rows
        .filter((row) => hasReply(row))
        .map((row) => ({
          author: row.author,
          source: row.source,
          label: row.label,
          point: row.point,
          reply: row.reply,
          status: row.status,
        })),
      portalUrl: `${PORTAL_URL}${VIEWER_COMMENT_STEP_PATH[step]}`,
      signature: settings.signature,
    });
    const sent = await sendClientEmail(supabase, {
      clientId,
      kind: "manual",
      templateKey: "feedback_replies",
      to,
      subject: message.subject,
      text: message.body,
    });
    emailed = sent.ok;
  }

  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath(VIEWER_COMMENT_STEP_PATH[step]);
  return { ok: true, sent: rows.length, emailed };
}
