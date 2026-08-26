import { countUnreadNotifications } from "@/app/admin/actions";
import { AppShell } from "@/components/app-shell";
import { NavLinks } from "@/components/nav-links";
import { requireAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { adminNav } from "@/lib/nav";

export const metadata = {
  title: "Admin",
  description: "Rupert admin dashboard.",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let unreadCount = 0;
  if (isSupabaseConfigured()) {
    await requireAdmin();
    unreadCount = await countUnreadNotifications();
  }

  return (
    <AppShell
      brand="Rupert"
      eyebrow="Admin"
      navigation={<NavLinks items={adminNav} unreadCount={unreadCount} />}
    >
      {children}
    </AppShell>
  );
}
