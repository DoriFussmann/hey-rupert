import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { sendAdminEmail, sendEmail, type EmailResult } from "@/lib/email";
import {
  clientDisplayName,
  notificationAction,
  personWithCompany,
} from "@/lib/format";
import { PORTAL_URL } from "@/lib/portal-url";
import { nextActionText, type ProgressSource } from "@/lib/progress";
import { SETUP_FEE_LABEL } from "@/lib/service-order";

type ServiceClient = ReturnType<typeof createServiceClient>;

const ADMIN_ACTION_PREFIX = "Your action: ";

async function loadClientRow(supabase: ServiceClient, clientId: string) {
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  return (data ?? {}) as Record<string, unknown>;
}

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

/**
 * Records an admin notification and, when `email` is set, emails it too.
 * The email says "you're up" only when the next step is the admin's, using
 * the same next-action logic as the admin client list.
 * Best effort: callers have already saved the change, so failures here are
 * logged and never block them. Call it after any stage change (kick-off) so
 * the next step it reports is current.
 */
export async function notifyAdmin(
  supabase: ServiceClient,
  clientId: string,
  type: string,
  { email }: { email: boolean },
) {
  const { error } = await supabase
    .from("notifications")
    .insert({ client_id: clientId, type });

  if (error) {
    console.error(`Notification insert failed (${type}): ${error.message}`);
  }

  if (!email) return;

  const row = await loadClientRow(supabase, clientId);
  const who = personWithCompany(clientDisplayName(row), text(row.company_name));
  const event = `${who} ${notificationAction(type)}`;
  const next = nextActionText(row as ProgressSource);
  const adminTurn = next.startsWith(ADMIN_ACTION_PREFIX);

  const subject = adminTurn ? `${event} — you're up` : event;
  const body = [
    `${event}.`,
    adminTurn
      ? `You're up: ${next.slice(ADMIN_ACTION_PREFIX.length)}.`
      : `Next: ${next}.`,
    `Open the client: ${PORTAL_URL}/admin/clients/${clientId}`,
  ].join("\n\n");

  await sendAdminEmail(subject, body);
}

export type ClientTurn = "statement_of_work_ready" | "service_order_ready";

const CLIENT_TURN_EMAILS: Record<
  ClientTurn,
  { subject: string; prepared: string; task: string; path: string }
> = {
  statement_of_work_ready: {
    subject: "Your Statement of Work is ready — you're up",
    prepared: "Rupert has prepared your Statement of Work.",
    task: "You're up: review it and confirm in your portal.",
    path: "/portal/statement-of-work",
  },
  service_order_ready: {
    subject: "Your Service Order and Setup Fee invoice are ready — you're up",
    prepared: `Rupert has prepared your Service Order and the ${SETUP_FEE_LABEL} Setup Fee invoice.`,
    task: "You're up: sign the Service Order and pay the Setup Fee in your portal, in either order. Once both are done, we kick off.",
    path: "/portal/service-order",
  },
};

/** Emails the client when the turn passes to them. */
export async function notifyClient(
  supabase: ServiceClient,
  clientId: string,
  turn: ClientTurn,
): Promise<EmailResult> {
  const row = await loadClientRow(supabase, clientId);
  const address = text(row.email) || text(row.founder_email);
  if (!address) {
    return { ok: false, reason: "This client has no email address." };
  }

  const firstName =
    text(row.first_name) || text(row.founder_name).split(/\s+/)[0] || "";
  const copy = CLIENT_TURN_EMAILS[turn];
  const body = [
    firstName ? `Hi ${firstName},` : "Hi,",
    copy.prepared,
    copy.task,
    `Open your portal: ${PORTAL_URL}${copy.path}`,
    "Dori\nHey Rupert",
  ].join("\n\n");

  return sendEmail({ to: [address], subject: copy.subject, text: body });
}
