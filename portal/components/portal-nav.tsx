"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { portalNav } from "@/lib/nav";

export function PortalNav({ stage }: { stage?: string }) {
  const pathname = usePathname();
  const live = stage === "live";
  const serviceOrderOpen = stage === "service_order" || live;

  return (
    <nav className="flex flex-col gap-lg">
      {portalNav.map((group) => (
        <div key={group.label}>
          <p className="mb-sm px-sm text-label uppercase tracking-label text-muted">
            {group.label}
          </p>
          <div className="flex flex-col gap-xs">
            {group.items.map((item) => {
              const active = pathname === item.href;
              const locked =
                item.href === "/portal/scope-of-work"
                  ? false
                  : item.href === "/portal/service-order"
                    ? !serviceOrderOpen
                    : !live;

              if (locked) {
                return (
                  <span
                    key={item.href}
                    className="cursor-not-allowed rounded-md px-sm py-sm text-body-sm text-muted"
                  >
                    {item.label}
                  </span>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-sm py-sm text-body-sm no-underline transition-colors duration-hover ${
                    active
                      ? "bg-primary-tint text-primary"
                      : "text-secondary hover:bg-background hover:text-heading"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
