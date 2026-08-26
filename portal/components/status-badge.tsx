import type { ClientStatus, InvestorStatus, ReviewStatus } from "@/lib/types";
import { statusLabel } from "@/lib/format";

const styles: Record<string, string> = {
  onboarding: "bg-primary-tint text-primary",
  preparation: "bg-primary-tint text-primary",
  live: "bg-primary-tint text-success",
  paused: "text-warning",
  completed: "text-muted",
  scope_of_work: "bg-primary-tint text-primary",
  service_order: "bg-primary-tint text-primary",
  pending: "text-warning",
  acknowledged: "text-success",
  changes_requested: "text-warning",
  identified: "text-muted",
  queued: "text-secondary",
  contacted: "text-secondary",
  replied: "text-success",
  meeting: "text-success",
  passed: "text-muted",
  draft: "text-muted",
  active: "text-success",
};

export function StatusBadge({
  status,
}: {
  status: ClientStatus | InvestorStatus | ReviewStatus | string;
}) {
  return (
    <span
      className={`inline-flex rounded-full border border-border px-sm py-xs text-label uppercase tracking-label ${styles[status] ?? "text-secondary"}`}
    >
      {statusLabel(status as ClientStatus)}
    </span>
  );
}
