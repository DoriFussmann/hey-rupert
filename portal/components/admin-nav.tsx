"use client";

import { NavLinks } from "@/components/nav-links";
import { adminFormNav, adminNav } from "@/lib/nav";

export function AdminNav({ unreadCount = 0 }: { unreadCount?: number }) {
  return (
    <div className="flex flex-col gap-lg">
      <NavLinks items={adminNav} unreadCount={unreadCount} />
      <div>
        <p className="mb-sm px-sm text-label uppercase tracking-label text-muted">
          Forms
        </p>
        <NavLinks items={adminFormNav} />
      </div>
    </div>
  );
}
