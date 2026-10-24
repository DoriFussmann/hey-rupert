import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { sendAdminEmail, type EmailResult } from "@/lib/email";
import { sendClientEmail } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import {
  emailTemplate,
  isAdminEmailType,
  renderEmail,
  updatedSubject,
  type ClientTurn,
  type EmailSettings,
} from "@/lib/email-templates";
import {
  clientDisplayName,
  notificationAction,
  personWithCompany,
} from "@/lib/format";
import { PORTAL_URL } from "@/lib/portal-url";
import {
  nextActionText,
  nextTurn,
  type ProgressSource,
} from "@/lib/progress";
import { loadSetupSteps } from "@/lib/setup-server";

export type { ClientTurn };

type ServiceClient = ReturnType<typeof createServiceClient>;

/** The client row plus its Setup rows, so turn logic sees the whole picture. */
export async function loadClientRow(supabase: ServiceClient, clientId: string) {
  const [{ data }, setup] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
    loadSetupSteps(supabase, [clientId]),
  ]);
  return {
    ...((data ?? {}) as Record<string, unknown>),
    setup_steps: setup.get(clientId) ?? [],
  } as Record<string, unknown>;
}

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

/**
 * Records an admin notification (and, with `email`, emails it) unless an
 * unread one of the same type is already waiting for this client, so
 * repeated events (a founder adding several messages or files) don't flood
 * the list or the inbox. Best effort, like notifyAdmin.
 */
export async function notifyAdminOnce(
  supabase: ServiceClient,
  clientId: string,
  type: string,
  { email = false, details }: { email?: boolean; details?: string } = {},
) {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("type", type)
    .or("read.eq.false,read.is.null");
  if (error) {
    console.error(`Notification check failed (${type}): ${error.message}`);
    return;
  }
  if ((count ?? 0) > 0) return;
  await notifyAdmin(supabase, clientId, type, { email, details });
}

/**
 * Records an admin notification and, when `email` is set and that email is
 * switched on in Forms → Emails, emails it too.
 * `details` is optional extra text placed in the email body.
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
  { email, details }: { email: boolean; details?: string },
) {
  const { error } = await supabase
    .from("notifications")
    .insert({ client_id: clientId, type });

  if (error) {
    console.error(`Notification insert failed (${type}): ${error.message}`);
  }

  if (!email) return;

  const settings = await loadEmailSettings(supabase);
  const setting = isAdminEmailType(type)
    ? settings.templates[`admin:${type}`]
    : null;
  if (setting && !setting.enabled) return;

  const row = await loadClientRow(supabase, clientId);
  const who = personWithCompany(clientDisplayName(row), text(row.company_name));
  const turn = nextTurn(row as ProgressSource);
  const adminTurn = turn.owner === "admin";

  // Events without a catalog entry keep the generic wording.
  const template = setting ?? {
    subject: `{client} ${notificationAction(type)}{youre_up}`,
    body: `{client} ${notificationAction(type)}.\n\n{next_step}\n\n{details}\n\nOpen the client: {client_link}`,
  };

  const message = renderEmail(template, {
    client: who,
    company: text(row.company_name),
    next_step: adminTurn
      ? `You're up: ${turn.action}.`
      : `Next: ${nextActionText(row as ProgressSource)}.`,
    youre_up: adminTurn ? " — you're up" : "",
    details: details?.trim() ?? "",
    client_link: `${PORTAL_URL}/admin/clients/${clientId}`,
  });

  await sendAdminEmail(message.subject, message.body);
}

export function firstNameOf(row: Record<string, unknown>) {
  return text(row.first_name) || text(row.founder_name).split(/\s+/)[0] || "";
}

export function clientAddress(row: Record<string, unknown>) {
  return text(row.email) || text(row.founder_email);
}

export function greetingFor(row: Record<string, unknown>) {
  const firstName = firstNameOf(row);
  return firstName ? `Hi ${firstName},` : "Hi,";
}

export const PAUSED_REASON = "Automatic emails are paused for this client.";

/**
 * Emails the client when the turn passes to them. `note` is an optional
 * message from Rupert placed in the email (for example what changed).
 * `updated` words the email as a revised version.
 * Skipped (with the reason) when the email is switched off in Forms → Emails
 * or automatic emails are paused for this client.
 */
export async function notifyClient(
  supabase: ServiceClient,
  clientId: string,
  turn: ClientTurn,
  { note, updated }: { note?: string; updated?: boolean } = {},
): Promise<EmailResult> {
  const row = await loadClientRow(supabase, clientId);
  const address = clientAddress(row);
  if (!address) {
    return { ok: false, reason: "This client has no email address." };
  }
  if (row.emails_paused === true) {
    return { ok: false, reason: PAUSED_REASON };
  }

  const key = `client:${turn}` as const;
  const settings = await loadEmailSettings(supabase);
  const setting = settings.templates[key];
  if (!setting.enabled) {
    return {
      ok: false,
      reason: "This email is switched off in Forms → Emails.",
    };
  }

  const rendered = renderEmail(setting, {
    greeting: greetingFor(row),
    first_name: firstNameOf(row),
    company: text(row.company_name),
    portal_link: `${PORTAL_URL}${emailTemplate(key)?.path ?? "/portal"}`,
    note: note?.trim() ? `A note from Rupert:\n${note.trim()}` : "",
    updated_line: updated
      ? " This is an updated version based on your feedback."
      : "",
    signature: settings.signature,
  });

  return sendClientEmail(supabase, {
    clientId,
    kind: "automatic",
    templateKey: key,
    to: [address],
    subject: updated ? updatedSubject(rendered.subject) : rendered.subject,
    text: rendered.body,
  });
}

export type PendingClientTurn = {
  /** What the client is asked to do, e.g. "sign your NDA". */
  task: string;
  path: string;
  since: string;
};

/**
 * A reminder that one or more turns are waiting on the client.
 * `lastAttempt` is true when this is the final reminder for any of them.
 */
export async function sendClientReminder(
  supabase: ServiceClient,
  settings: EmailSettings,
  row: Record<string, unknown>,
  turns: PendingClientTurn[],
  { lastAttempt }: { lastAttempt: boolean },
): Promise<EmailResult> {
  const address = clientAddress(row);
  if (!address) return { ok: false, reason: "This client has no email address." };
  if (turns.length === 0) return { ok: false, reason: "Nothing to remind." };

  const [first] = turns;
  const single = turns.length === 1;

  const message = renderEmail(settings.templates.reminder, {
    greeting: greetingFor(row),
    first_name: firstNameOf(row),
    company: text(row.company_name),
    task_summary: single
      ? first.task
      : `complete ${turns.length} waiting steps`,
    task_links: single
      ? `Open your portal: ${PORTAL_URL}${first.path}`
      : turns.map((turn) => `- ${turn.task}: ${PORTAL_URL}${turn.path}`).join("\n"),
    closing: lastAttempt
      ? "If something is holding you up, just reply to this email or book a call — happy to help."
      : "Questions? Just reply to this email.",
    signature: settings.signature,
  });

  return sendClientEmail(supabase, {
    clientId: String(row.id),
    kind: "reminder",
    templateKey: "reminder",
    to: [address],
    subject: message.subject,
    text: message.body,
  });
}
