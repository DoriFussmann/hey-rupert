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
        description="Client activity across onboarding and setup. Which emails go out, and the reminder schedule for each step, are set in Forms → Emails."
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
