import { PROMPT_GROUPS, PROMPT_LIST, promptPath } from "./prompt-list.ts";

/** One link in the admin nav. `hash` links jump to a section of the page; `exact` links don't cover the pages below them. */
export type AdminNavItem = { href: string; label: string; hash?: string; exact?: boolean };

export type AdminNavGroup = { id: string; label: string; items: readonly AdminNavItem[] };

/** The admin nav: a top bar of groups, each opening a menu of its pages. */
export const adminNavGroups: readonly AdminNavGroup[] = [
  {
    id: "clients",
    label: "Clients",
    items: [
      { href: "/admin", label: "Clients & Prospects" },
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
      { href: "/admin/forms/emails", hash: "emails-client", label: "Client Emails" },
      { href: "/admin/forms/emails", hash: "emails-admin", label: "Emails to Me" },
      { href: "/admin/forms/emails", hash: "emails-reminder", label: "Reminders" },
      { href: "/admin/forms/outreach-styles", label: "Investor Email Styles" },
      { href: "/admin/nudge", label: "Nudge" },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    items: [
      { href: "/admin/forms/agents", label: "All Prompts", exact: true },
      { href: "/admin/forms/intake", label: "Intake Topics" },
      { href: "/admin/forms/brief-topics", label: "Brief Topics" },
      { href: "/admin/forms/selling-points", label: "Selling Points" },
      { href: "/admin/forms/feedback-topics", label: "Feedback Topics" },
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
      { href: "/admin/forms/launch-confirmation", label: "Launch Confirmation" },
      { href: "/admin/forms/materials", label: "Company Materials" },
    ],
  },
];

/** The Desk: the cross-client inbox, a client's Desk, or one item on it. */
export const DESK_NAV_HREF = "/admin/desk";

export function isDeskPath(pathname: string) {
  return pathname === DESK_NAV_HREF || pathname.startsWith(`${DESK_NAV_HREF}/`) || /^\/admin\/clients\/[^/]+\/desk(\/|$)/.test(pathname);
}

/** Whether a page path belongs to a nav link (ignoring its hash). */
export function navPathMatches(pathname: string, href: string) {
  // A client's Desk belongs to the Desk link in the top bar, not to Clients.
  if (href === "/admin") return pathname === "/admin" || (pathname.startsWith("/admin/clients") && !isDeskPath(pathname)) || pathname.startsWith("/admin/prospects");
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

/** A titled part of a group's menu. No label: the menu is one plain list. */
export type AdminNavSection = { label: string | null; items: AdminNavItem[] };

/**
 * A group's menu, in parts. Agents is long, so it is split: the lists Rupert
 * edits first, then the prompts by area. `query` keeps the links whose label
 * has every word typed; parts left empty are dropped.
 */
export function navSections(group: AdminNavGroup, query = ""): AdminNavSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const keep = (item: AdminNavItem) => words.every((word) => item.label.toLowerCase().includes(word));
  if (group.id !== "agents") return [{ label: null, items: group.items.filter(keep) }].filter((section) => section.items.length > 0);
  const area = new Map<string, string>(PROMPT_LIST.map((prompt) => [promptPath(prompt.key), prompt.group]));
  const sections: AdminNavSection[] = [
    { label: "Lists", items: group.items.filter((item) => !area.has(item.href)) },
    ...PROMPT_GROUPS.map((label) => ({ label, items: group.items.filter((item) => area.get(item.href) === label) })),
  ];
  return sections.map((section) => ({ ...section, items: section.items.filter(keep) })).filter((section) => section.items.length > 0);
}
