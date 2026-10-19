// The client portal's three phases and which one the client is in. Pure
// module: used by the portal home redirect and the portal navigation.

import { isLiveUnlocked, isSetupUnlocked } from "@/lib/checklists";
import { onboardingProgress, type OnboardingSource } from "@/lib/onboarding";

export type PortalPhase = "onboarding" | "setup" | "live";

export const PORTAL_PHASE_HOME: Record<PortalPhase, string> = {
  onboarding: "/portal/onboarding",
  setup: "/portal/setup",
  live: "/portal/live-campaign",
};

/** The phase the client is in now: where the portal opens. */
export function currentPortalPhase(
  stage: string | null | undefined,
  onboarding: OnboardingSource | null | undefined,
): PortalPhase {
  if (isLiveUnlocked(stage)) return "live";
  const { complete, total } = onboardingProgress(onboarding);
  if (isSetupUnlocked(stage) && complete === total) return "setup";
  return "onboarding";
}
