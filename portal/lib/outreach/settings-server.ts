import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { asOutreachStyles, defaultOutreachStyles, type OutreachStyles } from "@/lib/outreach/copy";

type ServiceClient = ReturnType<typeof createServiceClient>;

export const OUTREACH_STYLES_KEY = "styles";

export const OUTREACH_SETTINGS_TABLE_MISSING =
  "The outreach_settings table is missing. Run portal/supabase/outreach_settings.sql in the Supabase SQL editor, then save again.";

export function outreachTableError(message: string, code?: string) {
  return code === "42P01" || message.includes("outreach_settings") || message.toLowerCase().includes("schema cache");
}

/**
 * The investor email styles, with the admin's saved version over the defaults.
 * Never fails: when the table is missing or unreadable the defaults apply, and
 * `error` says why.
 */
export async function loadOutreachStyles(
  supabase: ServiceClient,
): Promise<{ styles: OutreachStyles; saved: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("outreach_settings")
    .select("value")
    .eq("key", OUTREACH_STYLES_KEY)
    .maybeSingle();
  if (error) {
    return {
      styles: defaultOutreachStyles(),
      saved: false,
      error: outreachTableError(error.message, error.code) ? OUTREACH_SETTINGS_TABLE_MISSING : error.message,
    };
  }
  if (!data) return { styles: defaultOutreachStyles(), saved: false, error: null };
  return { styles: asOutreachStyles(data.value), saved: true, error: null };
}
