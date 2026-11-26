import { countUnreadNotifications } from "@/app/admin/actions";
import { AdminShell } from "@/components/admin-nav";
import { requireAdmin } from "@/lib/auth";
import { countWaitingOnUs } from "@/lib/desk-server";
import { isServiceRoleConfigured, isSupabaseConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

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
  let deskCount = 0;
  if (isSupabaseConfigured()) {
    await requireAdmin();
    [unreadCount, deskCount] = await Promise.all([
      countUnreadNotifications(),
      isServiceRoleConfigured() ? countWaitingOnUs(createServiceClient()) : 0,
    ]);
  }

  return (
    <AdminShell unreadCount={unreadCount} deskCount={deskCount}>
      {children}
    </AdminShell>
  );
}
