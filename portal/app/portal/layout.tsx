import { AppShell } from "@/components/app-shell";
import { PortalNav } from "@/components/portal-nav";
import { requirePortalUser } from "@/lib/auth";
import { getPortalClient } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata = {
  title: "Portal",
  description: "Your Rupert engagement, tracked in one place.",
};

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
      brand="Rupert"
      eyebrow="Portal"
      navigation={<PortalNav stage={client?.stage} />}
    >
      {children}
    </AppShell>
  );
}
