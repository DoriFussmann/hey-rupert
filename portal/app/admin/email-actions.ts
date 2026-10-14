"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { adminAddresses, sendAdminEmail, type EmailResult } from "@/lib/email";
import { sendClientEmail } from "@/lib/email-log";
import {
  EMAIL_SETTINGS_TABLE_MISSING,
  REMINDER_TIMING_PREFIX,
  SIGNATURE_KEY,
  emailControlsTableError,
  loadEmailSettings,
} from "@/lib/email-settings";
import {
  BODY_MAX,
  REMINDER_STEPS,
  SIGNATURE_MAX,
  SUBJECT_MAX,
  asReminderTiming,
  emailTemplate,
  renderEmail,
  sampleValues,
  unknownTokens,
  type EmailTemplateDefinition,
} from "@/lib/email-templates";
import { isServiceRoleConfigured } from "@/lib/env";
import { clientAddress } from "@/lib/notify";
import { PORTAL_URL } from "@/lib/portal-url";
import { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type EmailActionResult = { ok: true } | { ok: false; error: string };

const EMAILS_PATH = "/admin/forms/emails";

async function requireAdminService(): Promise<
  { ok: true; supabase: ServiceClient } | { ok: false; error: string }
> {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false, error: "Service role key is not configured." };
  }
  return { ok: true, supabase: createServiceClient() };
}

function settingsError(message: string, code?: string) {
  return emailControlsTableError(message, code)
    ? EMAIL_SETTINGS_TABLE_MISSING
    : message;
}

function checkTemplateText(
  template: EmailTemplateDefinition,
  subject: string,
  body: string,
): string | null {
  if (!subject) return "The subject cannot be empty.";
  if (!body) return "The email cannot be empty.";
  if (subject.length > SUBJECT_MAX) {
    return `The subject is too long (max ${SUBJECT_MAX} characters).`;
  }
  if (body.length > BODY_MAX) {
    return `The email is too long (max ${BODY_MAX} characters).`;
  }
  const unknown = unknownTokens(`${subject}\n${body}`, template.tokens);
  if (unknown.length > 0) {
    return `${unknown.join(", ")} ${unknown.length === 1 ? "is not a fill-in" : "are not fill-ins"} for this email. Use only the ones listed.`;
  }
  return null;
}

/** Saves one email's switch and wording. Text equal to the default is stored
 * as "not edited", so it keeps following the default. */
export async function saveEmailTemplate(
  key: string,
  input: { enabled: boolean; subject: string; body: string },
): Promise<EmailActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const template = emailTemplate(key);
  if (!template) return { ok: false, error: "Unknown email." };

  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  const problem = checkTemplateText(template, subject, body);
  if (problem) return { ok: false, error: problem };

  const { error } = await access.supabase.from("email_settings").upsert({
    key: template.key,
    enabled: template.switchable ? Boolean(input.enabled) : true,
    subject: subject === template.subject ? null : subject,
    body: body === template.body ? null : body,
    updated_at: new Date().toISOString(),
  });

  if (error) return { ok: false, error: settingsError(error.message, error.code) };

  revalidatePath(EMAILS_PATH);
  return { ok: true };
}

export async function saveEmailSignature(
  signature: string,
): Promise<EmailActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const value = String(signature ?? "").trim();
  if (!value) return { ok: false, error: "The signature cannot be empty." };
  if (value.length > SIGNATURE_MAX) {
    return { ok: false, error: `The signature is too long (max ${SIGNATURE_MAX} characters).` };
  }

  const { error } = await access.supabase.from("email_settings").upsert({
    key: SIGNATURE_KEY,
    body: value,
    updated_at: new Date().toISOString(),
  });

  if (error) return { ok: false, error: settingsError(error.message, error.code) };

  revalidatePath(EMAILS_PATH);
  return { ok: true };
}

/** Saves the reminder schedule for every step at once. */
export async function saveReminderTimings(
  input: Record<string, unknown>,
): Promise<EmailActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const at = new Date().toISOString();
  const rows = REMINDER_STEPS.map((step) => {
    const timing = asReminderTiming(input?.[step.key], step.defaults);
    return {
      key: `${REMINDER_TIMING_PREFIX}${step.key}`,
      enabled: timing.enabled,
      config: {
        first_after_days: timing.first_after_days,
        every_days: timing.every_days,
        max_reminders: timing.max_reminders,
        stall_alert: timing.stall_alert,
      },
      updated_at: at,
    };
  });

  const { error } = await access.supabase.from("email_settings").upsert(rows);
  if (error) return { ok: false, error: settingsError(error.message, error.code) };

  revalidatePath(EMAILS_PATH);
  return { ok: true };
}

/**
 * Emails Rupert the given (possibly unsaved) wording of one email, filled
 * with sample details, so it can be checked before a client sees it.
 */
export async function sendTemplateTest(
  key: string,
  input: { subject: string; body: string; signature?: string },
): Promise<EmailResult> {
  const access = await requireAdminService();
  if (!access.ok) return { ok: false, reason: access.error };

  const template = emailTemplate(key);
  if (!template) return { ok: false, reason: "Unknown email." };

  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  const problem = checkTemplateText(template, subject, body);
  if (problem) return { ok: false, reason: problem };

  const signature =
    String(input.signature ?? "").trim() ||
    (await loadEmailSettings(access.supabase)).signature;

  const message = renderEmail(
    { subject, body },
    sampleValues(template, { portalUrl: PORTAL_URL, signature }),
  );

  return sendAdminEmail(
    `[Test] ${message.subject}`,
    [
      `Test of the "${template.title}" email, filled with sample details. Nothing was sent to a client.`,
      "———",
      message.body,
    ].join("\n\n"),
  );
}

export async function setClientEmailsPaused(
  clientId: string,
  paused: boolean,
): Promise<EmailActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { error } = await access.supabase
    .from("clients")
    .update({ emails_paused: Boolean(paused) })
    .eq("id", clientId);

  if (error) return { ok: false, error: settingsError(error.message, error.code) };

  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

export type ManualEmailResult =
  | { ok: true; copied: boolean }
  | { ok: false; error: string };

/**
 * Sends an email written by Rupert to the client, with the signature added.
 * Goes out even when automatic emails are paused. Logged in the client's
 * email history.
 */
export async function sendManualEmail(
  clientId: string,
  input: { subject: string; message: string; copyMe: boolean },
): Promise<ManualEmailResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const subject = String(input.subject ?? "").replace(/\s+/g, " ").trim();
  const message = String(input.message ?? "").trim();
  if (!subject) return { ok: false, error: "Add a subject." };
  if (!message) return { ok: false, error: "Write a message." };
  if (subject.length > SUBJECT_MAX) {
    return { ok: false, error: `The subject is too long (max ${SUBJECT_MAX} characters).` };
  }
  if (message.length > BODY_MAX) {
    return { ok: false, error: `The message is too long (max ${BODY_MAX} characters).` };
  }

  const { data: row, error: loadError } = await access.supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!row) return { ok: false, error: "Client not found." };

  const address = clientAddress(row as Record<string, unknown>);
  if (!address) return { ok: false, error: "This client has no email address." };

  const { signature } = await loadEmailSettings(access.supabase);
  const copy = Boolean(input.copyMe);

  const result = await sendClientEmail(access.supabase, {
    clientId,
    kind: "manual",
    to: [address],
    bcc: copy ? adminAddresses() : [],
    subject,
    text: `${message}\n\n${signature}`,
  });

  revalidatePath(`/admin/clients/${clientId}`);
  if (!result.ok) return { ok: false, error: result.reason };
  return { ok: true, copied: copy && adminAddresses().length > 0 };
}
