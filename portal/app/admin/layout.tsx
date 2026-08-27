import { countUnreadNotifications } from "@/app/admin/actions";
import { AppShell } from "@/components/app-shell";
import { AdminNav } from "@/components/admin-nav";
import { requireAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

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
      navigation={<AdminNav unreadCount={unreadCount} />}
    >
      {children}
    </AppShell>
  );
}
