import { countUnreadNotifications } from "@/app/admin/actions";
import { AdminShell } from "@/components/admin-nav";
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
    <AdminShell unreadCount={unreadCount}>{children}</AdminShell>
  );
}
