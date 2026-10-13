export type ChecklistStatus = "open" | "wip" | "done";

export type LiveStatusColumn =
  | "campaign_analytics_status"
  | "investor_inbox_status"
  | "engagement_tracker_status";

export type ChecklistStatusColumn = LiveStatusColumn;

export type OnboardingTimestampColumn =
  | "nda_signed_at"
  | "intake_completed_at"
  | "payment_received_at";

export type ChecklistStatuses = Partial<
  Record<ChecklistStatusColumn, string | null>
>;

export type PhaseItem<Column extends string> = {
  column: Column;
  title: string;
  href: string;
};

// Setup is driven by the Turn Engine in lib/setup.ts. The old manual
// Setup status columns (pitch_deck_status, …) are no longer used.

export const LIVE_ITEMS: PhaseItem<LiveStatusColumn>[] = [
  {
    column: "campaign_analytics_status",
    title: "Campaign Analytics",
    href: "/portal/campaigns",
  },
  {
    column: "investor_inbox_status",
    title: "Investor Inbox",
    href: "/portal/inbox",
  },
  {
    column: "engagement_tracker_status",
    title: "Engagement Tracker",
    href: "/portal/pipeline",
  },
];

export const ONBOARDING_TOGGLES: {
  column: OnboardingTimestampColumn;
  title: string;
  detail: string;
}[] = [
  {
    column: "payment_received_at",
    title: "Setup Fee",
    detail: "Payment received",
  },
  {
    column: "nda_signed_at",
    title: "NDA",
    detail: "Mutually signed",
  },
  {
    column: "intake_completed_at",
    title: "Client Intake",
    detail: "Completed",
  },
];

export const CHECKLIST_STATUS_VALUES: ChecklistStatus[] = [
  "open",
  "wip",
  "done",
];

export function parseChecklistStatus(
  value: string | null | undefined,
): ChecklistStatus {
  if (value === "wip" || value === "done") return value;
  return "open";
}

export function isChecklistStatus(value: string): value is ChecklistStatus {
  return value === "open" || value === "wip" || value === "done";
}

export function checklistProgress(
  items: { column: ChecklistStatusColumn }[],
  statuses: ChecklistStatuses | null | undefined,
) {
  const complete = items.filter(
    (item) => parseChecklistStatus(statuses?.[item.column]) === "done",
  ).length;
  return { complete, total: items.length };
}

export function isSetupUnlocked(stage?: string | null) {
  return stage === "setup" || stage === "live";
}

export function isLiveUnlocked(stage?: string | null) {
  return stage === "live";
}
