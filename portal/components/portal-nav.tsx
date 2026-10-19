"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LIVE_ITEMS,
  checklistProgress,
  isLiveUnlocked,
  isSetupUnlocked,
  type ChecklistStatuses,
} from "@/lib/checklists";
import {
  onboardingProgress,
  type OnboardingSource,
} from "@/lib/onboarding";
import {
  PORTAL_PHASE_HOME,
  currentPortalPhase,
  type PortalPhase as PhaseId,
} from "@/lib/portal-phase";

const PHASES: {
  id: PhaseId;
  label: string;
  href: string;
  prefixes: string[];
}[] = [
  {
    id: "onboarding",
    label: "Onboarding",
    href: PORTAL_PHASE_HOME.onboarding,
    prefixes: [
      "/portal/onboarding",
      "/portal/statement-of-work",
      "/portal/service-order",
      "/portal/nda",
      "/portal/intake",
      "/portal/materials",
    ],
  },
  {
    id: "setup",
    label: "Setup",
    href: PORTAL_PHASE_HOME.setup,
    prefixes: ["/portal/setup"],
  },
  {
    id: "live",
    label: "Live Campaign",
    href: PORTAL_PHASE_HOME.live,
    prefixes: [
      "/portal/live-campaign",
      "/portal/campaigns",
      "/portal/inbox",
      "/portal/pipeline",
    ],
  },
];

function pathInPhase(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function PortalNav({
  stage,
  onboarding,
  setup,
  setupYourTurn = false,
  checklists,
}: {
  stage?: string;
  onboarding?: OnboardingSource | null;
  /** Setup progress, computed on the server from the Turn Engine. */
  setup: { complete: number; total: number };
  /** True when a Setup step is waiting on the client. */
  setupYourTurn?: boolean;
  checklists?: ChecklistStatuses | null;
}) {
  const pathname = usePathname();
  const counts = {
    onboarding: onboardingProgress(onboarding),
    setup,
    live: checklistProgress(LIVE_ITEMS, checklists),
  };
  const locked = {
    onboarding: false,
    setup: !isSetupUnlocked(stage),
    live: !isLiveUnlocked(stage),
  };
  const activeStage = currentPortalPhase(stage, onboarding);

  return (
    <nav className="flex flex-col gap-xs">
      {PHASES.map((phase) => {
        const { complete, total } = counts[phase.id];
        const isLocked = locked[phase.id];
        const isCurrent = activeStage === phase.id;
        const isActive = pathInPhase(pathname, phase.prefixes);
        const done = total > 0 && complete === total;
        const progress = isLocked ? "Not open yet" : `${complete} of ${total} complete`;

        return (
          <Link
            key={phase.id}
            href={phase.href}
            className={`rounded-md px-sm py-sm no-underline transition-colors duration-hover ${
              isActive
                ? "bg-primary-tint text-primary"
                : isLocked
                  ? "text-muted"
                  : "text-secondary hover:bg-background hover:text-heading"
            }`}
          >
            <span className="flex items-center justify-between gap-sm">
              <span className="text-body-sm">{phase.label}</span>
              {phase.id === "setup" && setupYourTurn && !isLocked ? (
                <span className="text-label uppercase tracking-label text-primary">
                  Your turn
                </span>
              ) : done ? (
                <span className="flex items-center text-success">
                  <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4" fill="none">
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="sr-only">Complete</span>
                </span>
              ) : isCurrent ? (
                <span className="text-label uppercase tracking-label text-primary">
                  Current
                </span>
              ) : null}
            </span>
            {done ? null : (
              <span
                className={`mt-xs block text-body-sm ${
                  isActive ? "text-primary" : "text-muted"
                }`}
              >
                {progress}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
