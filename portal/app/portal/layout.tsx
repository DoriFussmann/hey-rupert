import { AppShell } from "@/components/app-shell";
import { PortalNav } from "@/components/portal-nav";
import { ViewAsBanner } from "@/components/view-as-banner";
import { requirePortalUser } from "@/lib/auth";
import { getPortalView } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import type { Client } from "@/lib/types";

export const metadata = {
  title: "Portal",
  description: "Your Rupert engagement, tracked in one place.",
};

function portalGreeting(client: Client | null) {
  const firstName =
    client?.first_name?.trim() ||
    client?.founder_name?.trim().split(/\s+/)[0] ||
    "";
  return firstName ? `Hey ${firstName}` : "Rupert";
}

function viewAsLabel(client: Client) {
  const person = client.founder_name?.trim();
  const company = client.company_name?.trim();
  if (person && company && person !== company) return `${person} · ${company}`;
  return company || person || "client";
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isSupabaseConfigured()) {
    await requirePortalUser();
  }

  const { client, viewAs } = await getPortalView();

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
                  // The nav only counts completed steps, so the Service Order
                  // text and invoice link are not sent to it.
                  sow_confirmed_at: client.sow_confirmed_at,
                  service_order_agreed_at: client.service_order_agreed_at,
                  payment_received_at: client.payment_received_at,
                  nda_signed_at: client.nda_signed_at,
                  intake_completed_at: client.intake_completed_at,
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
      {viewAs && client ? <ViewAsBanner label={viewAsLabel(client)} /> : null}
      {children}
    </AppShell>
  );
}
