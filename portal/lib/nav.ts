export const adminNav = [
  { href: "/admin", label: "Clients" },
  { href: "/admin/notifications", label: "Notifications" },
] as const;

export const portalNav = [
  {
    label: "Engagement",
    items: [
      { href: "/portal/scope-of-work", label: "Scope of work" },
      { href: "/portal/service-order", label: "Service order" },
    ],
  },
  {
    label: "Setup & Preparation",
    items: [
      { href: "/portal/preparation/deck-review", label: "Pitch Deck Review" },
      { href: "/portal/preparation/abstract-review", label: "Business Brief" },
      {
        href: "/portal/preparation/messaging-review",
        label: "Outreach Messaging",
      },
      {
        href: "/portal/preparation/investor-matching",
        label: "Investor Match",
      },
      { href: "/portal/preparation/investor-list", label: "Target List" },
    ],
  },
  {
    label: "Live Outreach",
    items: [{ href: "/portal/campaigns", label: "Campaign Analytics" }],
  },
  {
    label: "Communications",
    items: [{ href: "/portal/inbox", label: "Investor Inbox" }],
  },
  {
    label: "Tracking",
    items: [{ href: "/portal/pipeline", label: "Engagement Tracker" }],
  },
] as const;
