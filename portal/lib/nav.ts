import { PROMPT_LIST, promptPath } from "./prompt-list.ts";

/** One link in the admin nav. `hash` links jump to a section of the page; `exact` links don't cover the pages below them. */
export type AdminNavItem = { href: string; label: string; hash?: string; exact?: boolean };

export type AdminNavGroup = { id: string; label: string; items: readonly AdminNavItem[] };

/** The admin nav: groups that open and close, each with its pages. */
export const adminNavGroups: readonly AdminNavGroup[] = [
  {
    id: "clients",
    label: "Clients",
    items: [
      { href: "/admin", label: "Clients" },
      { href: "/admin/timeline", label: "Timeline" },
      { href: "/admin/notifications", label: "Notify & Nudge" },
      { href: "/admin/replies", label: "Replies" },
    ],
  },
  {
    id: "matching",
    label: "Matching",
    items: [
      { href: "/admin/matching", label: "Matching" },
      { href: "/admin/fund-database", label: "Fund Database" },
      { href: "/admin/taxonomy", label: "Taxonomy" },
    ],
  },
  {
    id: "emails",
    label: "Emails",
    items: [
      { href: "/admin/forms/emails", hash: "emails-client", label: "Client emails" },
      { href: "/admin/forms/emails", hash: "emails-admin", label: "Emails to me" },
      { href: "/admin/forms/emails", hash: "emails-reminder", label: "Reminders" },
      { href: "/admin/forms/outreach-styles", label: "Investor email styles" },
      { href: "/admin/nudge", label: "Nudge" },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    items: [
      { href: "/admin/forms/agents", label: "All prompts", exact: true },
      { href: "/admin/forms/intake", label: "Intake topics" },
      { href: "/admin/forms/brief-topics", label: "Brief topics" },
      { href: "/admin/forms/selling-points", label: "Selling points" },
      ...PROMPT_LIST.map((prompt) => ({ href: promptPath(prompt.key), label: prompt.title })),
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { href: "/admin/forms/statement-of-work", label: "Statement of Work" },
      { href: "/admin/forms/service-order", label: "Service Order" },
      { href: "/admin/forms/nda", label: "NDA" },
      { href: "/admin/forms/materials", label: "Company Materials" },
    ],
  },
];

/** Whether a page path belongs to a nav link (ignoring its hash). */
export function navPathMatches(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin" || pathname.startsWith("/admin/clients");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Whether a link is the current page. On a page with section links, the first section counts when there is no hash. */
export function navItemActive(pathname: string, hash: string, item: AdminNavItem, group: AdminNavGroup) {
  if (item.exact ? pathname !== item.href : !navPathMatches(pathname, item.href)) return false;
  if (!item.hash) return true;
  const sections = group.items.filter((other) => other.href === item.href && other.hash);
  const current = sections.some((other) => other.hash === hash) ? hash : sections[0]?.hash;
  return item.hash === current;
}

/** The group holding the current page, or null. */
export function activeNavGroup(pathname: string) {
  return adminNavGroups.find((group) => group.items.some((item) => navPathMatches(pathname, item.href)))?.id ?? null;
}
