import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { sendAdminEmail, sendEmail, type EmailResult } from "@/lib/email";
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
import { SETUP_FEE_LABEL } from "@/lib/service-order";
import { loadSetupSteps } from "@/lib/setup-server";

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
 * Records an admin notification and, when `email` is set, emails it too.
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

  const row = await loadClientRow(supabase, clientId);
  const who = personWithCompany(clientDisplayName(row), text(row.company_name));
  const event = `${who} ${notificationAction(type)}`;
  const turn = nextTurn(row as ProgressSource);
  const adminTurn = turn.owner === "admin";

  const subject = adminTurn ? `${event} — you're up` : event;
  const body = [
    `${event}.`,
    adminTurn
      ? `You're up: ${turn.action}.`
      : `Next: ${nextActionText(row as ProgressSource)}.`,
    details,
    `Open the client: ${PORTAL_URL}/admin/clients/${clientId}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  await sendAdminEmail(subject, body);
}

export type ClientTurn =
  | "statement_of_work_ready"
  | "service_order_ready"
  | "nda_ready"
  | "materials_reopened"
  | "deck_review_ready"
  | "framing_ready"
  | "investor_list_ready"
  | "email_copy_ready";

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
  nda_ready: {
    subject: "Your NDA is ready — you're up",
    prepared: "Rupert has prepared your Non-Disclosure Agreement.",
    task: "You're up: review and sign it in your portal. It protects everything you share with us from here on.",
    path: "/portal/nda",
  },
  materials_reopened: {
    subject: "Rupert needs a little more from you — you're up",
    prepared: "Rupert has reviewed your company materials and needs a few more things.",
    task: "You're up: add what's missing and submit again in your portal.",
    path: "/portal/setup/materials",
  },
  deck_review_ready: {
    subject: "Rupert's comments on your deck are ready",
    prepared: "Rupert has reviewed your pitch deck and materials.",
    task: "Read the comments in your portal. Nothing to sign off: they are yours to apply as you see fit.",
    path: "/portal/setup/deck-review",
  },
  framing_ready: {
    subject: "Your message framing is ready — you're up",
    prepared: "Rupert has written the message framing for your investor outreach.",
    task: "You're up: review it in your portal, then confirm or tell us what to change.",
    path: "/portal/setup/framing",
  },
  investor_list_ready: {
    subject: "Your matched investor list is ready — you're up",
    prepared: "Rupert has matched investors for your raise, grouped into three fit tiers.",
    task: "You're up: review the list in your portal. Add a note on any fund, ask questions, or confirm.",
    path: "/portal/setup/investor-list",
  },
  email_copy_ready: {
    subject: "Your outreach emails are ready — you're up",
    prepared: "Rupert has written the outreach emails for each of the three investor tiers.",
    task: "You're up: review them in your portal, then confirm or tell us what to change.",
    path: "/portal/setup/email-copy",
  },
};

function firstNameOf(row: Record<string, unknown>) {
  return text(row.first_name) || text(row.founder_name).split(/\s+/)[0] || "";
}

function clientAddress(row: Record<string, unknown>) {
  return text(row.email) || text(row.founder_email);
}

/**
 * Emails the client when the turn passes to them. `note` is an optional
 * message from Rupert placed in the email (for example what changed).
 * `updated` words the email as a revised version.
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

  const firstName = firstNameOf(row);
  const copy = CLIENT_TURN_EMAILS[turn];
  const subject = updated
    ? copy.subject.replace(" is ready", " has been updated").replace(" are ready", " have been updated")
    : copy.subject;
  const body = [
    firstName ? `Hi ${firstName},` : "Hi,",
    updated ? `${copy.prepared} This is an updated version based on your feedback.` : copy.prepared,
    note?.trim() ? `A note from Rupert:\n${note.trim()}` : "",
    copy.task,
    `Open your portal: ${PORTAL_URL}${copy.path}`,
    "Dori\nHey Rupert",
  ]
    .filter(Boolean)
    .join("\n\n");

  return sendEmail({ to: [address], subject, text: body });
}

export type PendingClientTurn = {
  /** What the client is asked to do, e.g. "sign your NDA". */
  task: string;
  path: string;
  since: string;
};

/**
 * A reminder that one or more turns are waiting on the client.
 * `attempt` is 1-based; the last attempt says so.
 */
export async function sendClientReminder(
  row: Record<string, unknown>,
  turns: PendingClientTurn[],
  { attempt, max }: { attempt: number; max: number },
): Promise<EmailResult> {
  const address = clientAddress(row);
  if (!address) return { ok: false, reason: "This client has no email address." };
  if (turns.length === 0) return { ok: false, reason: "Nothing to remind." };

  const firstName = firstNameOf(row);
  const [first] = turns;
  const subject =
    turns.length === 1
      ? `Reminder: ${first.task} — you're up`
      : `Reminder: ${turns.length} steps are waiting on you`;
  const list =
    turns.length === 1
      ? `Rupert is waiting on you to ${first.task}.`
      : `Rupert is waiting on you for:\n${turns.map((turn) => `- ${turn.task}: ${PORTAL_URL}${turn.path}`).join("\n")}`;

  const body = [
    firstName ? `Hi ${firstName},` : "Hi,",
    `A quick nudge. ${list}`,
    "Each step takes a few minutes, and your campaign moves forward as soon as it is done.",
    turns.length === 1 ? `Open your portal: ${PORTAL_URL}${first.path}` : "",
    attempt >= max
      ? "If something is holding you up, just reply to this email or book a call — happy to help."
      : "Questions? Just reply to this email.",
    "Dori\nHey Rupert",
  ]
    .filter(Boolean)
    .join("\n\n");

  return sendEmail({ to: [address], subject, text: body });
}
