"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "@/components/chevron";
import { activeNavGroup, adminNavGroups, navItemActive } from "@/lib/nav";

/** Which groups this browser left open. Per-viewer convenience only. */
const STORAGE_KEY = "rupert.adminNav.open";

function readStored(): string[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

function writeStored(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable (private mode, blocked site data): the nav still works.
  }
}

function useHash() {
  const [hash, setHash] = useState("");
  useEffect(() => {
    const read = () => setHash(window.location.hash.replace(/^#/, ""));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return [hash, setHash] as const;
}

/**
 * The admin nav: five groups that open and close. The group holding the
 * current page is always open; the others stay as this browser left them.
 */
export function AdminNav({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname();
  const [hash, setHash] = useHash();
  const current = activeNavGroup(pathname);
  const [open, setOpen] = useState<string[]>(current ? [current] : []);

  useEffect(() => {
    const stored = readStored();
    if (stored) setOpen((now) => Array.from(new Set([...stored, ...now])));
  }, []);

  useEffect(() => {
    if (current) setOpen((now) => (now.includes(current) ? now : [...now, current]));
  }, [current]);

  function toggle(id: string) {
    setOpen((now) => {
      const next = now.includes(id) ? now.filter((item) => item !== id) : [...now, id];
      writeStored(next);
      return next;
    });
  }

  return (
    <nav aria-label="Admin" className="flex flex-col gap-xs">
      {adminNavGroups.map((group) => {
        const expanded = open.includes(group.id);
        const panelId = `admin-nav-${group.id}`;
        const groupUnread = group.items.some((item) => item.href === "/admin/notifications") && unreadCount > 0;
        return (
          <div key={group.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-sm rounded-md px-sm py-sm text-left text-label uppercase tracking-label text-muted transition-colors duration-hover hover:bg-background hover:text-heading"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggle(group.id)}
            >
              <span className="flex items-center gap-xs">
                {group.label}
                {groupUnread && !expanded ? (
                  <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-xs py-px text-mono normal-case text-white">
                    {unreadCount}
                  </span>
                ) : null}
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform duration-hover ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded ? (
              <ul id={panelId} className="mb-sm mt-xs flex flex-col gap-xs">
                {group.items.map((item) => {
                  const active = navItemActive(pathname, hash, item, group);
                  const href = item.hash ? `${item.href}#${item.hash}` : item.href;
                  const showBadge = item.href === "/admin/notifications" && unreadCount > 0;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setHash(item.hash ?? "")}
                        className={`flex items-center justify-between gap-sm rounded-md px-sm py-sm text-body-sm no-underline transition-colors duration-hover ${
                          active ? "bg-primary-tint text-primary" : "text-secondary hover:bg-background hover:text-heading"
                        }`}
                      >
                        <span>{item.label}</span>
                        {showBadge ? (
                          <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-xs py-px text-mono text-white">
                            {unreadCount}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
