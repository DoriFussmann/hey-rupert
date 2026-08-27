export type ChecklistStatus = "open" | "wip" | "done";

export type SetupStatusColumn =
  | "pitch_deck_status"
  | "business_brief_status"
  | "outreach_messaging_status"
  | "investor_match_status"
  | "target_list_status";

export type LiveStatusColumn =
  | "campaign_analytics_status"
  | "investor_inbox_status"
  | "engagement_tracker_status";

export type ChecklistStatusColumn = SetupStatusColumn | LiveStatusColumn;

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

export const SETUP_ITEMS: PhaseItem<SetupStatusColumn>[] = [
  {
    column: "pitch_deck_status",
    title: "Pitch Deck Review",
    href: "/portal/preparation/deck-review",
  },
  {
    column: "business_brief_status",
    title: "Business Brief",
    href: "/portal/preparation/abstract-review",
  },
  {
    column: "outreach_messaging_status",
    title: "Outreach Messaging",
    href: "/portal/preparation/messaging-review",
  },
  {
    column: "investor_match_status",
    title: "Investor Match",
    href: "/portal/preparation/investor-matching",
  },
  {
    column: "target_list_status",
    title: "Target List",
    href: "/portal/preparation/investor-list",
  },
];

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
    column: "nda_signed_at",
    title: "NDA",
    detail: "Mutually Signed",
  },
  {
    column: "intake_completed_at",
    title: "Client Intake Form",
    detail: "Completed",
  },
  {
    column: "payment_received_at",
    title: "Invoice & Setup Payment",
    detail: "Received",
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
