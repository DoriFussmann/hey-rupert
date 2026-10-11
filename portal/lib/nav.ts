export const adminNav = [
  { href: "/admin", label: "Clients" },
  { href: "/admin/notifications", label: "Notifications" },
] as const;

export const adminFormNav = [
  { href: "/admin/forms/statement-of-work", label: "Statement of Work" },
  { href: "/admin/forms/service-order", label: "Service Order" },
  { href: "/admin/forms/nda", label: "NDA" },
  { href: "/admin/forms/intake", label: "Intake Interviewer" },
] as const;
