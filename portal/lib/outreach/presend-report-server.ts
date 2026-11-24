import "server-only";
import { sendAdminEmail } from "@/lib/email";
import { checkPresend, summarySubject, summaryText, type CampaignOutcome } from "@/lib/outreach/presend-server";
import type { createServiceClient } from "@/lib/supabase/admin";

// Runs the pre-send email check (presend-server.ts) and emails Rupert the
// summary. Kept apart so the code that runs AI calls never sends email.

type ServiceClient = ReturnType<typeof createServiceClient>;

/** email: "always" (default), "if_checked" (only when a contact was checked or an error came up), or "never". */
export async function runPresendChecks(
  supabase: ServiceClient,
  options: { clientId?: string; email?: "always" | "if_checked" | "never"; now?: number } = {},
): Promise<{ campaigns: CampaignOutcome[]; delivered: number; emailed: boolean; error: string | null }> {
  const result = await checkPresend(supabase, { clientId: options.clientId, now: options.now });
  const summary = summaryText(result.campaigns, result.delivered);
  const mode = options.email ?? "always";
  const worked = result.campaigns.some((c) => c.outcomes.length > 0 || c.errors.length > 0);
  let emailed = false;
  if (result.campaigns.length > 0 && (mode === "always" || (mode === "if_checked" && worked))) {
    const sent = await sendAdminEmail(summarySubject(result.campaigns), summary);
    emailed = sent.ok;
  }
  await supabase.from("presend_runs").insert({
    finished_at: new Date().toISOString(),
    summary: { campaigns: result.campaigns, delivered: result.delivered, text: summary },
    emailed,
    error: result.error,
  });
  return { ...result, emailed };
}
