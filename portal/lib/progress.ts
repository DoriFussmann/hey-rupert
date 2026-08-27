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
  type OnboardingTimestamps,
} from "@/lib/onboarding";

export const TRACKED_TOTAL =
  ONBOARDING_TOTAL + SETUP_ITEMS.length + LIVE_ITEMS.length;

const CLIENT_OWNED_ONBOARDING = new Set(["sow", "service_order", "nda"]);

const ONBOARDING_SHORT: Record<string, string> = {
  sow: "Statement of Work",
  service_order: "Service Order",
  nda: "NDA",
  intake: "Client Intake",
  payment: "Invoice & Payment",
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
    const label = ONBOARDING_SHORT[onboardingNext.id] ?? onboardingNext.title;
    if (CLIENT_OWNED_ONBOARDING.has(onboardingNext.id)) {
      return `Waiting on client: ${label}`;
    }
    return `Your action: ${label}`;
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
