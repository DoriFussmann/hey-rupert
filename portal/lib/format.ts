import { ENGAGEMENT_STAGES, type AcknowledgementType } from "@/lib/types";

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateAtTime(value: string) {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${day} at ${time}`;
}

export function statusLabel(status: string) {
  const stage = ENGAGEMENT_STAGES.find((item) => item.value === status);
  if (stage) return stage.label;
  return status.replaceAll("_", " ");
}

export function notificationLabel(type: string) {
  if (type === "sow_confirmed" || type === "scope_acknowledged") {
    return "Confirmed Statement of Work";
  }
  if (type === "service_order_agreed") return "Signed Service Order";
  if (type === "nda_signed") return "Signed NDA";
  if (type === "password_set") return "Set Portal Password";
  if (type === "kickoff_ready") return "Ready for Kick-off";
  if (type === "setup_fee_paid") return "Paid Setup Fee";
  return statusLabel(type);
}

export function notificationAction(type: string) {
  if (type === "sow_confirmed" || type === "scope_acknowledged") {
    return "confirmed the Statement of Work";
  }
  if (type === "service_order_agreed") return "signed the Service Order";
  if (type === "nda_signed") return "signed the NDA";
  if (type === "password_set") return "set their portal password";
  if (type === "kickoff_ready") return "is ready for kick-off: issue the NDA";
  if (type === "setup_fee_paid") return "paid the Setup Fee";
  return notificationLabel(type).toLowerCase();
}

/** Best available person name for a raw `clients` row. */
export function clientDisplayName(row: Record<string, unknown>) {
  const text = (value: unknown) => (value != null ? String(value).trim() : "");
  const fullName = [text(row.first_name), text(row.last_name)]
    .filter(Boolean)
    .join(" ");

  return (
    fullName ||
    text(row.founder_name) ||
    text(row.company_name) ||
    text(row.email) ||
    "Unknown client"
  );
}

/** "Maya Chen · Lena Health", or just the name when they match. */
export function personWithCompany(name: string, company: string) {
  return company && company !== name ? `${name} · ${company}` : name;
}

export function acknowledgementLabel(type: AcknowledgementType) {
  const labels: Record<AcknowledgementType, string> = {
    scope_of_work: "Statement of Work",
    service_order: "Service Order",
    deck: "Pitch Deck Review",
    abstract: "Business Brief",
    messaging: "Outreach Messaging",
    investor_list: "Target List",
  };

  return labels[type];
}
