import { AppShell } from "@/components/app-shell";
import { BookCallLink } from "@/components/book-call-link";
import { PortalNav } from "@/components/portal-nav";
import { ViewAsBanner } from "@/components/view-as-banner";
import { requirePortalUser } from "@/lib/auth";
import { getPortalView } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { getSetupItems } from "@/lib/setup";
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
  const setupItems = getSetupItems(client);

  return (
    <AppShell
      brand={portalGreeting(client)}
      eyebrow="Portal"
      navigation={
        <>
          <PortalNav
            stage={client?.stage}
            onboarding={client}
            setup={{
              complete: setupItems.filter((item) => item.status === "done").length,
              total: setupItems.length,
            }}
            setupYourTurn={setupItems.some((item) => item.status === "your_turn")}
            checklists={
              client
                ? {
                    campaign_analytics_status: client.campaign_analytics_status,
                    investor_inbox_status: client.investor_inbox_status,
                    engagement_tracker_status: client.engagement_tracker_status,
                  }
                : null
            }
          />
          <BookCallLink disabled={viewAs} />
        </>
      }
    >
      {viewAs && client ? <ViewAsBanner label={viewAsLabel(client)} /> : null}
      {children}
    </AppShell>
  );
}
