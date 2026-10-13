import { PageHeader } from "@/components/page-header";
import { NotificationInbox } from "@/app/admin/notifications/notification-inbox";
import { TestEmailButton } from "@/app/admin/notifications/test-email-button";
import { RunRemindersButton } from "@/app/admin/notifications/run-reminders-button";
import { listAdminNotifications } from "@/app/admin/actions";

export default async function NotificationsPage() {
  const notifications = await listAdminNotifications();

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Client activity across onboarding and setup. Clients get an email reminder when their turn has waited 24 hours (up to 3), then you get a stalled alert."
        actions={
          <div className="flex flex-wrap items-start gap-md">
            <RunRemindersButton />
            <TestEmailButton />
          </div>
        }
      />
      <NotificationInbox notifications={notifications} />
    </>
  );
}
