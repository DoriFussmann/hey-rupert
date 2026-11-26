"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "@/components/chevron";
import { SignOutButton } from "@/components/sign-out-button";
import { activeNavGroup, adminNavGroups, navItemActive, navSections, type AdminNavGroup } from "@/lib/nav";

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

function Badge({ count }: { count: number }) {
  return (
    <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-xs py-px text-mono normal-case text-white">
      {count}
    </span>
  );
}

/** One group's menu. Agents is long: it gets the bar's full width, columns by area, and a search box. */
function Menu({
  group,
  pathname,
  hash,
  unreadCount,
  deskCount,
  onPick,
}: {
  group: AdminNavGroup;
  pathname: string;
  hash: string;
  unreadCount: number;
  deskCount: number;
  onPick: (hash: string) => void;
}) {
  const wide = group.id === "agents";
  const [query, setQuery] = useState("");
  const sections = navSections(group, query);

  return (
    <div
      id={`admin-nav-${group.id}`}
      className={`absolute left-md right-md top-full z-40 mt-xs rounded-card border border-border bg-surface p-sm shadow-[0_8px_24px_rgba(0,0,0,0.08)] ${
        wide ? "max-h-[75vh] overflow-y-auto lg:left-xl lg:right-xl" : "lg:left-0 lg:right-auto lg:w-64"
      }`}
    >
      {wide ? (
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search prompts"
          aria-label="Search prompts"
          className="mb-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
        />
      ) : null}
      {sections.length === 0 ? <p className="px-sm py-sm text-body-sm text-muted">Nothing found.</p> : null}
      <div className={wide ? "gap-lg sm:columns-2 lg:columns-3 xl:columns-4" : undefined}>
        {sections.map((section) => (
          <div key={section.label ?? "all"} className={wide ? "mb-md break-inside-avoid" : undefined}>
            {section.label ? <p className="px-sm pb-xs text-label uppercase tracking-label text-muted">{section.label}</p> : null}
            <ul className="flex flex-col">
              {section.items.map((item) => {
                const active = navItemActive(pathname, hash, item, group);
                const href = item.hash ? `${item.href}#${item.hash}` : item.href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => onPick(item.hash ?? "")}
                      className={`flex items-center justify-between gap-sm rounded-md px-sm py-xs text-body-sm no-underline transition-colors duration-hover ${
                        active ? "bg-primary-tint text-primary" : "text-secondary hover:bg-background hover:text-heading"
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.href === "/admin/notifications" && unreadCount > 0 ? <Badge count={unreadCount} /> : null}
                      {item.href === "/admin/desk" && deskCount > 0 ? <Badge count={deskCount} /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The admin's top bar: the brand, the five groups (each opens a menu of its
 * pages) and Log out. The page below gets the full width of the screen.
 */
export function AdminTopBar({ unreadCount = 0, deskCount = 0 }: { unreadCount?: number; deskCount?: number }) {
  const pathname = usePathname();
  const [hash, setHash] = useHash();
  const current = activeNavGroup(pathname);
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  // A menu closes on a click outside it, on Escape, and when the page changes.
  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (bar.current && !bar.current.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div ref={bar} className="relative flex flex-wrap items-center gap-x-lg gap-y-xs px-md py-sm lg:px-xl">
        <Link href="/admin" className="flex items-baseline gap-sm no-underline">
          <span className="font-light text-h4 tracking-headline text-heading">Rupert</span>
          <span className="text-label uppercase tracking-label text-muted">Admin</span>
        </Link>
        <nav aria-label="Admin" className="flex flex-wrap items-center gap-xs">
          {adminNavGroups.map((group) => {
            const expanded = open === group.id;
            const here = current === group.id;
            const unread = unreadCount > 0 && group.items.some((item) => item.href === "/admin/notifications");
            return (
              // The Agents menu spans the bar; the others hang under their own button (the bar, on a phone).
              <div key={group.id} className={group.id === "agents" ? undefined : "lg:relative"}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`admin-nav-${group.id}`}
                  onClick={() => setOpen(expanded ? null : group.id)}
                  className={`flex items-center gap-xs rounded-md px-sm py-xs text-body-sm transition-colors duration-hover ${
                    here ? "bg-primary-tint text-primary" : expanded ? "bg-background text-heading" : "text-secondary hover:bg-background hover:text-heading"
                  }`}
                >
                  {group.label}
                  {unread ? <Badge count={unreadCount} /> : null}
                  <ChevronDown className={`h-3 w-3 transition-transform duration-hover ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded ? (
                  <Menu
                    group={group}
                    pathname={pathname}
                    hash={hash}
                    unreadCount={unreadCount}
                    deskCount={deskCount}
                    onPick={(next) => {
                      setHash(next);
                      setOpen(null);
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="ml-auto">
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

/** The admin's frame: the top bar, then the page across the full width. */
export function AdminShell({
  unreadCount,
  deskCount = 0,
  children,
}: {
  unreadCount: number;
  /** Desk items waiting on us, across clients. */
  deskCount?: number;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <AdminTopBar unreadCount={unreadCount} deskCount={deskCount} />
      <main className="min-w-0 px-md py-lg lg:px-xl lg:py-xl">{children}</main>
    </div>
  );
}
