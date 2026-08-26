"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
};

function isActive(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === "/admin" || pathname.startsWith("/admin/clients");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({
  items,
  unreadCount = 0,
}: {
  items: readonly NavItem[];
  unreadCount?: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-xs">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const showBadge =
          item.href === "/admin/notifications" && unreadCount > 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between gap-sm rounded-md px-sm py-sm text-body-sm no-underline transition-colors duration-hover ${
              active
                ? "bg-primary-tint text-primary"
                : "text-secondary hover:bg-background hover:text-heading"
            }`}
          >
            <span>{item.label}</span>
            {showBadge ? (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-xs py-px text-mono text-white">
                {unreadCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
