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

export const FIRST_INVOICE_ACTION = "Go Live: the client approved the launch";

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

  // More than one Setup step can be open at once (a list already sent while
  // the narrative is reopened): Rupert's own work comes first, then what the
  // client has to answer.
  const setupItems = getSetupItems(source);
  const adminNext = setupItems.find((item) => item.status === "waiting");
  if (adminNext) return { owner: "admin", action: adminNext.adminAction };
  const clientNext = setupItems.find((item) => item.status === "your_turn");
  if (clientNext) return { owner: "client", step: clientNext.short };

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
