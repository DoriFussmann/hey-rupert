import type { AcknowledgementType } from "@/lib/types";

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
  return status.replaceAll("_", " ");
}

export function notificationLabel(type: string) {
  if (type === "scope_acknowledged") return "Reviewed Scope of Work";
  if (type === "service_order_agreed") return "Agreed to Service Order";
  return statusLabel(type);
}

export function acknowledgementLabel(type: AcknowledgementType) {
  const labels: Record<AcknowledgementType, string> = {
    scope_of_work: "Scope of work",
    service_order: "Service order",
    deck: "Pitch Deck Review",
    abstract: "Business Brief",
    messaging: "Outreach Messaging",
    investor_list: "Target List",
  };

  return labels[type];
}
