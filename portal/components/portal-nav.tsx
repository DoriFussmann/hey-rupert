"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LIVE_ITEMS,
  SETUP_ITEMS,
  checklistProgress,
  type ChecklistStatuses,
} from "@/lib/checklists";
import {
  onboardingProgress,
  type OnboardingTimestamps,
} from "@/lib/onboarding";

function ProgressSection({
  label,
  href,
  complete,
  total,
}: {
  label: string;
  href: string;
  complete: number;
  total: number;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  const progressWidth = total === 0 ? 0 : (complete / total) * 100;

  return (
    <div>
      <p className="mb-sm px-sm text-label uppercase tracking-label text-muted">
        {label}
      </p>
      <Link
        href={href}
        className={`block rounded-md px-sm py-sm no-underline transition-colors duration-hover ${
          active
            ? "bg-primary-tint text-primary"
            : "text-secondary hover:bg-background hover:text-heading"
        }`}
      >
        <div className="h-[2px] overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-primary"
            style={{ width: `${progressWidth}%` }}
          />
        </div>
        <p
          className={`mt-sm text-body-sm ${
            active ? "text-primary" : "text-muted"
          }`}
        >
          {complete} of {total} complete
        </p>
      </Link>
    </div>
  );
}

export function PortalNav({
  onboarding,
  checklists,
}: {
  stage?: string;
  onboarding?: OnboardingTimestamps | null;
  checklists?: ChecklistStatuses | null;
}) {
  const onboardingCounts = onboardingProgress(onboarding);
  const setupCounts = checklistProgress(SETUP_ITEMS, checklists);
  const liveCounts = checklistProgress(LIVE_ITEMS, checklists);

  return (
    <nav className="flex flex-col gap-lg">
      <ProgressSection
        label="Onboarding"
        href="/portal/onboarding"
        complete={onboardingCounts.complete}
        total={onboardingCounts.total}
      />
      <ProgressSection
        label="Setup"
        href="/portal/setup"
        complete={setupCounts.complete}
        total={setupCounts.total}
      />
      <ProgressSection
        label="Live Campaign"
        href="/portal/live-campaign"
        complete={liveCounts.complete}
        total={liveCounts.total}
      />
    </nav>
  );
}
