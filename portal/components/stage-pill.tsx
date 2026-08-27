import { ENGAGEMENT_STAGES, isEngagementStage } from "@/lib/types";

export function StagePill({ stage }: { stage?: string | null }) {
  if (!stage) {
    return <span className="text-body-sm text-muted">—</span>;
  }

  const label = isEngagementStage(stage)
    ? (ENGAGEMENT_STAGES.find((item) => item.value === stage)?.label ?? stage)
    : stage.replaceAll("_", " ");

  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-primary-tint px-sm py-xs text-body-sm text-heading">
      {label}
    </span>
  );
}
