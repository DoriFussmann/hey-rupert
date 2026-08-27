import { Checklist, type ChecklistRowItem } from "@/components/checklist";
import {
  LIVE_ITEMS,
  SETUP_ITEMS,
  isLiveUnlocked,
  isSetupUnlocked,
  parseChecklistStatus,
  type ChecklistStatuses,
} from "@/lib/checklists";
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

function onboardingRows(timestamps: OnboardingTimestamps): ChecklistRowItem[] {
  return getOnboardingItems(timestamps).map((item) => {
    const done = item.status === "done";
    const waiting = item.status === "your_turn" || item.status === "waiting";

    return {
      id: item.id,
      title: item.title,
      detail:
        done && item.completedAt ? formatDate(item.completedAt) : undefined,
      status: done ? "done" : waiting ? "waiting" : "open",
      statusLabel: done ? "Done" : waiting ? "Waiting" : "Open",
      dimmed: item.status === "open",
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
}: {
  stage?: string;
  timestamps: OnboardingTimestamps;
  statuses: ChecklistStatuses;
}) {
  const progress = overallProgress({ ...timestamps, ...statuses });

  return (
    <section className="mb-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-lg">
        <h2 className="text-h4">Progress Overview</h2>
        <p className="mt-xs text-body-sm text-muted">
          What the client sees across Onboarding, Setup, and Live Campaign.
        </p>
      </div>

      <SectionHeading
        title="Onboarding"
        complete={progress.onboarding.complete}
        total={progress.onboarding.total}
      />
      <Checklist items={onboardingRows(timestamps)} framed={false} />

      <SectionHeading
        title="Setup"
        complete={progress.setup.complete}
        total={progress.setup.total}
        divided
      />
      <Checklist
        items={phaseRows(SETUP_ITEMS, statuses, !isSetupUnlocked(stage))}
        framed={false}
      />

      <SectionHeading
        title="Live Campaign"
        complete={progress.live.complete}
        total={progress.live.total}
        divided
      />
      <Checklist
        items={phaseRows(LIVE_ITEMS, statuses, !isLiveUnlocked(stage))}
        framed={false}
      />
    </section>
  );
}
