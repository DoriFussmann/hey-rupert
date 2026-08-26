import { PageHeader } from "@/components/page-header";
import { NotificationInbox } from "@/app/admin/notifications/notification-inbox";
import { listAdminNotifications } from "@/app/admin/actions";

export default async function NotificationsPage() {
  const notifications = await listAdminNotifications();

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Client activity on scope of work and service orders."
      />
      <NotificationInbox notifications={notifications} />
    </>
  );
}
