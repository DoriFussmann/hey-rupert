import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  REMINDER_STEPS,
  asReminderTiming,
  defaultEmailSettings,
  isEmailTemplateKey,
  type EmailSettings,
} from "@/lib/email-templates";

type ServiceClient = ReturnType<typeof createServiceClient>;

export const REMINDER_TIMING_PREFIX = "reminder_timing:";
export const SIGNATURE_KEY = "signature";

export const EMAIL_SETTINGS_TABLE_MISSING =
  "The email_settings table is missing. Run portal/supabase/email_controls.sql in the Supabase SQL editor, then try again.";

export function emailControlsTableError(message: string, code?: string) {
  return (
    code === "42P01" ||
    code === "42703" ||
    message.includes("email_settings") ||
    message.includes("email_log") ||
    message.includes("emails_paused") ||
    message.toLowerCase().includes("schema cache")
  );
}

/**
 * Every email setting, with the admin's edits merged over the defaults.
 * Never fails: when the table is missing or unreadable the defaults apply,
 * so emails keep going out exactly as before. `error` says why.
 */
export async function loadEmailSettings(
  supabase: ServiceClient,
): Promise<EmailSettings & { error: string | null }> {
  const settings = defaultEmailSettings();

  const { data, error } = await supabase
    .from("email_settings")
    .select("key, enabled, subject, body, config");

  if (error) {
    return {
      ...settings,
      error: emailControlsTableError(error.message, error.code)
        ? EMAIL_SETTINGS_TABLE_MISSING
        : error.message,
    };
  }

  for (const row of data ?? []) {
    const key = String(row.key);

    if (key === SIGNATURE_KEY) {
      const signature = row.body != null ? String(row.body).trim() : "";
      if (signature) settings.signature = signature;
      continue;
    }

    if (key.startsWith(REMINDER_TIMING_PREFIX)) {
      const step = REMINDER_STEPS.find(
        (item) => item.key === key.slice(REMINDER_TIMING_PREFIX.length),
      );
      if (step) {
        settings.timings[step.key] = asReminderTiming(
          { ...(row.config ?? {}), enabled: row.enabled },
          step.defaults,
        );
      }
      continue;
    }

    if (isEmailTemplateKey(key)) {
      const current = settings.templates[key];
      const subject = row.subject != null ? String(row.subject).trim() : "";
      const body = row.body != null ? String(row.body).trim() : "";
      settings.templates[key] = {
        enabled: typeof row.enabled === "boolean" ? row.enabled : current.enabled,
        subject: subject || current.subject,
        body: body || current.body,
        customized: Boolean(subject || body),
      };
    }
  }

  return { ...settings, error: null };
}
