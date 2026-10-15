export const adminNav = [
  { href: "/admin", label: "Clients" },
  { href: "/admin/timeline", label: "Timeline" },
  { href: "/admin/fund-database", label: "Fund database" },
  { href: "/admin/notifications", label: "Notifications" },
] as const;

export const adminFormNav = [
  { href: "/admin/forms/statement-of-work", label: "Statement of Work" },
  { href: "/admin/forms/service-order", label: "Service Order" },
  { href: "/admin/forms/nda", label: "NDA" },
  { href: "/admin/forms/emails", label: "Emails" },
  { href: "/admin/forms/intake", label: "Intake Interviewer" },
  { href: "/admin/forms/materials", label: "Company Materials" },
  { href: "/admin/forms/agents", label: "AI Agents" },
] as const;
