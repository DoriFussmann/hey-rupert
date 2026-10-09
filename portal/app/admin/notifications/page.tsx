import { PageHeader } from "@/components/page-header";
import { NotificationInbox } from "@/app/admin/notifications/notification-inbox";
import { TestEmailButton } from "@/app/admin/notifications/test-email-button";
import { listAdminNotifications } from "@/app/admin/actions";

export default async function NotificationsPage() {
  const notifications = await listAdminNotifications();

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Client activity across onboarding."
        actions={<TestEmailButton />}
      />
      <NotificationInbox notifications={notifications} />
    </>
  );
}
