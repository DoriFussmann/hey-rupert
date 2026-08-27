"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LIVE_ITEMS,
  SETUP_ITEMS,
  checklistProgress,
  isLiveUnlocked,
  isSetupUnlocked,
  type ChecklistStatuses,
} from "@/lib/checklists";
import {
  onboardingProgress,
  type OnboardingTimestamps,
} from "@/lib/onboarding";

type PhaseId = "onboarding" | "setup" | "live";

const PHASES: {
  id: PhaseId;
  label: string;
  href: string;
  prefixes: string[];
}[] = [
  {
    id: "onboarding",
    label: "Onboarding",
    href: "/portal/onboarding",
    prefixes: [
      "/portal/onboarding",
      "/portal/statement-of-work",
      "/portal/service-order",
      "/portal/nda",
    ],
  },
  {
    id: "setup",
    label: "Setup",
    href: "/portal/setup",
    prefixes: ["/portal/setup", "/portal/preparation"],
  },
  {
    id: "live",
    label: "Live Campaign",
    href: "/portal/live-campaign",
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

function currentPhase(stage?: string): PhaseId {
  if (isLiveUnlocked(stage)) return "live";
  if (isSetupUnlocked(stage)) return "setup";
  return "onboarding";
}

export function PortalNav({
  stage,
  onboarding,
  checklists,
}: {
  stage?: string;
  onboarding?: OnboardingTimestamps | null;
  checklists?: ChecklistStatuses | null;
}) {
  const pathname = usePathname();
  const counts = {
    onboarding: onboardingProgress(onboarding),
    setup: checklistProgress(SETUP_ITEMS, checklists),
    live: checklistProgress(LIVE_ITEMS, checklists),
  };
  const locked = {
    onboarding: false,
    setup: !isSetupUnlocked(stage),
    live: !isLiveUnlocked(stage),
  };
  const activeStage = currentPhase(stage);

  return (
    <nav className="flex flex-col gap-xs">
      {PHASES.map((phase) => {
        const { complete, total } = counts[phase.id];
        const isLocked = locked[phase.id];
        const isCurrent = activeStage === phase.id;
        const isActive = pathInPhase(pathname, phase.prefixes);
        const progress =
          complete === total
            ? "Complete"
            : isLocked
              ? "Not open yet"
              : `${complete} of ${total} complete`;

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
              {isCurrent ? (
                <span className="text-label uppercase tracking-label text-primary">
                  Current
                </span>
              ) : null}
            </span>
            <span
              className={`mt-xs block text-body-sm ${
                isActive ? "text-primary" : "text-muted"
              }`}
            >
              {progress}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
