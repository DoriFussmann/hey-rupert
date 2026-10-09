import {
  LIVE_ITEMS,
  SETUP_ITEMS,
  checklistProgress,
  parseChecklistStatus,
  type ChecklistStatuses,
} from "@/lib/checklists";
import {
  ONBOARDING_TOTAL,
  getOnboardingItems,
  onboardingProgress,
  type OnboardingItemId,
  type OnboardingTimestamps,
} from "@/lib/onboarding";

export const TRACKED_TOTAL =
  ONBOARDING_TOTAL + SETUP_ITEMS.length + LIVE_ITEMS.length;

const ONBOARDING_SHORT: Record<OnboardingItemId, string> = {
  sow: "Statement of Work",
  service_order: "Service Order",
  payment: "Setup Fee",
  nda: "NDA",
  intake: "Client Intake",
};

// What the admin has to do when an onboarding step is waiting on Rupert.
const ADMIN_ACTION: Record<OnboardingItemId, string> = {
  sow: "Send Statement of Work",
  service_order: "Issue Service Order",
  payment: "Issue Setup Fee invoice",
  nda: "Issue NDA",
  intake: "Send Client Intake",
};

export type ProgressSource = OnboardingTimestamps & ChecklistStatuses;

export function overallProgress(source: ProgressSource | null | undefined) {
  const onboarding = onboardingProgress(source);
  const setup = checklistProgress(SETUP_ITEMS, source);
  const live = checklistProgress(LIVE_ITEMS, source);

  return {
    complete: onboarding.complete + setup.complete + live.complete,
    total: TRACKED_TOTAL,
    onboarding,
    setup,
    live,
  };
}

export function nextActionText(source: ProgressSource | null | undefined) {
  const onboardingNext = getOnboardingItems(source).find(
    (item) => item.status !== "done",
  );
  if (onboardingNext) {
    if (onboardingNext.status === "your_turn") {
      return `Waiting on client: ${ONBOARDING_SHORT[onboardingNext.id]}`;
    }
    return `Your action: ${ADMIN_ACTION[onboardingNext.id]}`;
  }

  const setupNext = SETUP_ITEMS.find(
    (item) => parseChecklistStatus(source?.[item.column]) !== "done",
  );
  if (setupNext) return `Your action: ${setupNext.title}`;

  const liveNext = LIVE_ITEMS.find(
    (item) => parseChecklistStatus(source?.[item.column]) !== "done",
  );
  if (liveNext) return `Your action: ${liveNext.title}`;

  return "All complete";
}
