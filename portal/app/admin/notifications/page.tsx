import { PageHeader } from "@/components/page-header";
import { NotificationInbox } from "@/app/admin/notifications/notification-inbox";
import { TestEmailButton } from "@/app/admin/notifications/test-email-button";
import { RunRemindersButton } from "@/app/admin/notifications/run-reminders-button";
import { ClearNotificationsButton } from "@/app/admin/notifications/clear-notifications-button";
import { listAdminNotifications } from "@/app/admin/actions";
import { ReadyNudges } from "@/app/admin/nudge/ready-nudges";
import { isServiceRoleConfigured } from "@/lib/env";
import { listReadyNudges } from "@/lib/reminders";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function NotificationsPage() {
  const [notifications, ready] = await Promise.all([
    listAdminNotifications(),
    isServiceRoleConfigured() ? listReadyNudges(createServiceClient()) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Notify & Nudge"
        description="Reminders ready for you to send, and client activity across onboarding and setup. Which emails go out, and the reminder schedule for each step, are set in Forms → Emails. For a personal nudge, use Emails → Nudge."
        actions={
          <div className="flex flex-wrap items-start gap-md">
            {notifications.length > 0 ? <ClearNotificationsButton /> : null}
            <RunRemindersButton />
            <TestEmailButton />
          </div>
        }
      />
      {ready ? <ReadyNudges nudges={ready.nudges} errors={ready.errors} /> : null}
      <NotificationInbox notifications={notifications} />
    </>
  );
}
