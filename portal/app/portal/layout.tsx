import { AppShell } from "@/components/app-shell";
import { PortalNav } from "@/components/portal-nav";
import { requirePortalUser } from "@/lib/auth";
import { getPortalClient } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata = {
  title: "Portal",
  description: "Your Rupert engagement, tracked in one place.",
};

function portalGreeting(client: Awaited<ReturnType<typeof getPortalClient>>) {
  const firstName =
    client?.first_name?.trim() ||
    client?.founder_name?.trim().split(/\s+/)[0] ||
    "";
  return firstName ? `Hey ${firstName}` : "Rupert";
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isSupabaseConfigured()) {
    await requirePortalUser();
  }

  const client = await getPortalClient();

  return (
    <AppShell
      brand={portalGreeting(client)}
      eyebrow="Portal"
      navigation={
        <PortalNav
          stage={client?.stage}
          onboarding={
            client
              ? {
                  sow_confirmed_at: client.sow_confirmed_at,
                  service_order_agreed_at: client.service_order_agreed_at,
                  nda_signed_at: client.nda_signed_at,
                  intake_completed_at: client.intake_completed_at,
                  payment_received_at: client.payment_received_at,
                }
              : null
          }
          checklists={
            client
              ? {
                  pitch_deck_status: client.pitch_deck_status,
                  business_brief_status: client.business_brief_status,
                  outreach_messaging_status: client.outreach_messaging_status,
                  investor_match_status: client.investor_match_status,
                  target_list_status: client.target_list_status,
                  campaign_analytics_status: client.campaign_analytics_status,
                  investor_inbox_status: client.investor_inbox_status,
                  engagement_tracker_status: client.engagement_tracker_status,
                }
              : null
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
