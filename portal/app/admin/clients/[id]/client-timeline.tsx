import { formatDate } from "@/lib/format";
import { buildTimeline, milestoneText, type TimelineSource } from "@/lib/timeline";

export function ClientTimeline({ source }: { source: TimelineSource }) {
  const timeline = buildTimeline(source);

  return (
    <section className="mt-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-md border-b border-border px-lg py-lg">
        <div>
          <h2 className="text-h4">Timeline</h2>
          <p className="mt-xs text-body-sm text-muted">
            {timeline.kickoffAt
              ? `Day 1 is ${formatDate(timeline.kickoffAt)}: Service Order signed and Setup Fee paid.`
              : "Not kicked off yet. Day 1 starts once the Service Order is signed and the Setup Fee is paid."}
          </p>
        </div>
        {timeline.today !== null ? (
          <p className="font-mono text-mono text-heading">
            Today: Day {timeline.today}
          </p>
        ) : null}
      </div>
      <ol className="divide-y divide-border">
        {timeline.milestones.map((milestone) => {
          const happened = Boolean(milestone.at) || milestone.dateUnknown;
          return (
            <li
              key={milestone.id}
              className={`grid grid-cols-[1fr_auto] items-baseline gap-x-md gap-y-xs px-lg py-sm text-body-sm sm:grid-cols-[1fr_10rem_8rem] ${
                happened ? "" : "text-muted"
              }`}
            >
              <span className={happened ? "text-heading" : undefined}>
                {milestone.label}
              </span>
              <span className="text-muted">
                {milestone.at ? formatDate(milestone.at) : milestone.dateUnknown ? "Date unknown" : ""}
              </span>
              <span className="col-span-2 font-mono text-mono sm:col-span-1 sm:text-right">
                {milestone.dateUnknown ? "Done" : milestoneText(milestone)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
