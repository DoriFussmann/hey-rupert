import { Checklist, type ChecklistRowItem } from "@/components/checklist";
import { ChevronDown } from "@/components/chevron";
import {
  LIVE_ITEMS,
  isLiveUnlocked,
  parseChecklistStatus,
  type ChecklistStatuses,
} from "@/lib/checklists";
import { getSetupItems, type SetupSource } from "@/lib/setup";
import { formatDate } from "@/lib/format";
import {
  getOnboardingItems,
  type OnboardingTimestamps,
} from "@/lib/onboarding";
import { overallProgress } from "@/lib/progress";

const setupLiveLabel = {
  open: "Open",
  wip: "WIP",
  done: "Done",
} as const;

// The client portal's view, translated for the admin: steps waiting on Rupert
// are highlighted as the admin's turn.
function onboardingRows(timestamps: OnboardingTimestamps): ChecklistRowItem[] {
  return getOnboardingItems(timestamps).map((item) => {
    const done = item.status === "done";
    const detail =
      done && item.completedAt ? formatDate(item.completedAt) : item.detail;

    if (done) {
      return {
        id: item.id,
        title: item.title,
        detail,
        status: "done",
        statusLabel: "Done",
      };
    }
    if (item.status === "waiting") {
      return {
        id: item.id,
        title: item.title,
        detail,
        status: "your_turn",
        statusLabel: "Your turn",
      };
    }
    if (item.status === "your_turn") {
      return {
        id: item.id,
        title: item.title,
        detail,
        status: "waiting",
        statusLabel: "Waiting on client",
      };
    }
    return {
      id: item.id,
      title: item.title,
      detail,
      status: "open",
      statusLabel: "Open",
      dimmed: true,
    };
  });
}

// Setup steps, translated for the admin the same way as onboarding.
function setupRows(source: SetupSource): ChecklistRowItem[] {
  return getSetupItems(source).map((item) => {
    if (item.status === "done") {
      return {
        id: item.id,
        title: item.title,
        detail: item.completedAt ? formatDate(item.completedAt) : item.detail,
        status: "done",
        statusLabel: "Done",
      };
    }
    if (item.status === "waiting") {
      return {
        id: item.id,
        title: item.title,
        detail: item.adminAction,
        status: "your_turn",
        statusLabel: "Your turn",
      };
    }
    if (item.status === "your_turn") {
      return {
        id: item.id,
        title: item.title,
        detail: item.detail,
        status: "waiting",
        statusLabel: "Waiting on client",
      };
    }
    return {
      id: item.id,
      title: item.title,
      detail: item.detail,
      status: "open",
      statusLabel: "Open",
      dimmed: true,
    };
  });
}

function phaseRows(
  items: { column: keyof ChecklistStatuses; title: string }[],
  statuses: ChecklistStatuses,
  dimmed: boolean,
): ChecklistRowItem[] {
  return items.map((item) => {
    const status = parseChecklistStatus(statuses[item.column]);
    return {
      id: item.column,
      title: item.title,
      status,
      statusLabel: setupLiveLabel[status],
      dimmed,
    };
  });
}

/**
 * One phase of the overview. A finished phase collapses to a single line
 * (native <details>: keyboard and screen-reader friendly, no JS).
 */
function Phase({
  title,
  complete,
  total,
  divided = false,
  children,
}: {
  title: string;
  complete: number;
  total: number;
  divided?: boolean;
  children: React.ReactNode;
}) {
  if (total === 0 || complete < total) {
    return (
      <>
        <SectionHeading title={title} complete={complete} total={total} divided={divided} />
        {children}
      </>
    );
  }
  return (
    <details className={`group/phase ${divided ? "border-t border-border" : ""}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-sm px-lg py-md [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-sm">
          <ChevronDown className="h-4 w-4 -rotate-90 text-muted transition-transform duration-hover group-open/phase:rotate-0" />
          <span className="text-label uppercase tracking-label text-muted">{title}</span>
        </span>
        <span className="text-body-sm text-success">
          {complete} of {total} complete
        </span>
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
  );
}

function SectionHeading({
  title,
  complete,
  total,
  divided = false,
}: {
  title: string;
  complete: number;
  total: number;
  divided?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-sm px-lg py-md ${
        divided ? "border-t border-b border-border" : "border-b border-border"
      }`}
    >
      <p className="text-label uppercase tracking-label text-muted">{title}</p>
      <p className="text-body-sm text-muted">
        {complete} of {total} complete
      </p>
    </div>
  );
}

export function ProgressOverview({
  stage,
  timestamps,
  statuses,
  setup,
}: {
  stage?: string;
  timestamps: OnboardingTimestamps;
  statuses: ChecklistStatuses;
  setup: SetupSource;
}) {
  const progress = overallProgress({ ...timestamps, ...statuses, ...setup });

  return (
    <section className="mb-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-lg">
        <h2 className="text-h4">Progress Overview</h2>
        <p className="mt-xs text-body-sm text-muted">
          What the client sees across Onboarding, Setup, and Live Campaign.
        </p>
      </div>

      <Phase
        title="Onboarding"
        complete={progress.onboarding.complete}
        total={progress.onboarding.total}
      >
        <Checklist items={onboardingRows(timestamps)} framed={false} />
      </Phase>

      <Phase
        title="Setup"
        complete={progress.setup.complete}
        total={progress.setup.total}
        divided
      >
        <Checklist items={setupRows(setup)} framed={false} />
      </Phase>

      <Phase
        title="Live Campaign"
        complete={progress.live.complete}
        total={progress.live.total}
        divided
      >
        <Checklist
          items={phaseRows(LIVE_ITEMS, statuses, !isLiveUnlocked(stage))}
          framed={false}
        />
      </Phase>
    </section>
  );
}
