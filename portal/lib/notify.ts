import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { sendAdminEmail } from "@/lib/email";
import {
  clientDisplayName,
  notificationAction,
  personWithCompany,
} from "@/lib/format";
import { PORTAL_URL } from "@/lib/portal-url";

type ServiceClient = ReturnType<typeof createServiceClient>;

const EMAIL_FOOTERS: Record<string, string> = {
  kickoff_ready:
    "The Service Order is signed and the Setup Fee is received. Your turn: issue the NDA.",
};

/**
 * Records an admin notification and, when `email` is set, emails it too.
 * Best effort: the client's action has already been saved, so failures here
 * are logged and never surfaced to the client.
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

  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  const row = (data ?? {}) as Record<string, unknown>;
  const company =
    row.company_name != null ? String(row.company_name).trim() : "";
  const who = personWithCompany(clientDisplayName(row), company);
  const subject = `${who} ${notificationAction(type)}`;
  const footer = EMAIL_FOOTERS[type];
  const text = [
    `${subject}.`,
    footer,
    `Open the client: ${PORTAL_URL}/admin/clients/${clientId}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  await sendAdminEmail(subject, text);
}
