import {
  LIVE_ITEMS,
  checklistProgress,
  parseChecklistStatus,
  type ChecklistStatuses,
} from "@/lib/checklists";
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL,
  getOnboardingItems,
  onboardingProgress,
  type OnboardingTimestamps,
} from "@/lib/onboarding";
import {
  SETUP_TOTAL,
  getSetupItems,
  isSetupComplete,
  setupProgress,
  type SetupSource,
} from "@/lib/setup";

export const TRACKED_TOTAL = ONBOARDING_TOTAL + SETUP_TOTAL + LIVE_ITEMS.length;

export type ProgressSource = OnboardingTimestamps &
  ChecklistStatuses &
  SetupSource;

export function overallProgress(source: ProgressSource | null | undefined) {
  const onboarding = onboardingProgress(source);
  const setup = setupProgress(source);
  const live = checklistProgress(LIVE_ITEMS, source);

  return {
    complete: onboarding.complete + setup.complete + live.complete,
    total: TRACKED_TOTAL,
    onboarding,
    setup,
    live,
  };
}

export type NextTurn =
  | { owner: "admin"; action: string }
  | { owner: "client"; step: string }
  | { owner: "none" };

export const FIRST_INVOICE_ACTION = "Issue the first monthly invoice and launch";

/** Whose turn it is next, and what the step is. */
export function nextTurn(source: ProgressSource | null | undefined): NextTurn {
  const onboardingNext = getOnboardingItems(source).find(
    (item) => item.status !== "done",
  );
  if (onboardingNext) {
    const step = ONBOARDING_STEPS[onboardingNext.id];
    return onboardingNext.status === "your_turn"
      ? { owner: "client", step: step.short }
      : { owner: "admin", action: step.adminAction };
  }

  const setupNext = getSetupItems(source).find(
    (item) => item.status === "your_turn" || item.status === "waiting",
  );
  if (setupNext) {
    return setupNext.status === "your_turn"
      ? { owner: "client", step: setupNext.short }
      : { owner: "admin", action: setupNext.adminAction };
  }

  if (isSetupComplete(source) && source?.stage !== "live") {
    return { owner: "admin", action: FIRST_INVOICE_ACTION };
  }

  const liveNext = LIVE_ITEMS.find(
    (item) => parseChecklistStatus(source?.[item.column]) !== "done",
  );
  if (liveNext) return { owner: "admin", action: liveNext.title };

  return { owner: "none" };
}

export function nextActionText(source: ProgressSource | null | undefined) {
  const turn = nextTurn(source);
  if (turn.owner === "admin") return `Your action: ${turn.action}`;
  if (turn.owner === "client") return `Waiting on client: ${turn.step}`;
  return "All complete";
}
