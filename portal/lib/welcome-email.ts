import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { loadEmailSettings } from "@/lib/email-settings";
import { WELCOME_EMAIL_KEY, renderEmail } from "@/lib/email-templates";
import { formatDate } from "@/lib/format";
import { PORTAL_HOST } from "@/lib/portal-url";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type WelcomeDetails = {
  firstName: string;
  company: string;
  email: string;
  setupUrl: string;
  expiresAt: string;
};

export type WelcomeEmail = { subject: string; body: string };

/**
 * The welcome email for a new client, from the wording in Forms → Emails,
 * with their set-password link filled in. Rupert copies it and sends it
 * himself.
 */
export async function renderWelcomeEmail(
  supabase: ServiceClient,
  details: WelcomeDetails,
): Promise<WelcomeEmail> {
  const settings = await loadEmailSettings(supabase);
  const template = settings.templates[WELCOME_EMAIL_KEY];
  const firstName = details.firstName.trim();
  return renderEmail(template, {
    greeting: firstName ? `Hi ${firstName},` : "Hi,",
    first_name: firstName || "there",
    company: details.company.trim(),
    setup_link: details.setupUrl,
    link_expires: formatDate(details.expiresAt),
    login_email: details.email,
    portal_host: PORTAL_HOST,
    signature: settings.signature,
  });
}
