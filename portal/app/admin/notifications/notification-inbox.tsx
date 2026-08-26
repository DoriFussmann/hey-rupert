"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markNotificationRead } from "@/app/admin/actions";
import { formatDateAtTime, notificationLabel } from "@/lib/format";
import type { AdminNotification } from "@/lib/types";

export function NotificationInbox({
  notifications,
}: {
  notifications: AdminNotification[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (notifications.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface px-lg py-xl">
        <p className="text-center text-body-sm text-muted">
          No notifications yet.
        </p>
      </div>
    );
  }

  async function openNotification(item: AdminNotification) {
    if (pendingId) return;
    setPendingId(item.id);
    if (!item.read) {
      await markNotificationRead(item.id);
    }
    router.push(`/admin/clients/${item.client_id}`);
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <ul>
        {notifications.map((item) => {
          const unread = !item.read;
          return (
            <li key={item.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => openNotification(item)}
                disabled={pendingId === item.id}
                className={`flex w-full items-start gap-md px-lg py-md text-left transition-colors duration-hover hover:bg-background ${
                  unread ? "bg-primary-tint" : "bg-surface"
                }`}
              >
                <span
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    unread ? "bg-primary" : "invisible"
                  }`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm text-heading">
                    {item.client_name}
                    {item.company_name ? ` · ${item.company_name}` : ""}
                  </span>
                  <span className="mt-xs block text-body-sm text-muted">
                    {notificationLabel(item.type)}
                  </span>
                  <span className="mt-xs block text-body-sm text-muted">
                    {formatDateAtTime(item.created_at)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
