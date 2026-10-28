import { weekLabel, type PlanWeek } from "@/lib/outreach/live";

// The week-by-week sending plan: shown to the client before and after launch,
// and to Rupert. The current week (or, before launch, the first) is
// highlighted in the Live banner's green.

const STATUS: Record<PlanWeek["status"], string> = {
  done: "Done",
  current: "This week",
  next: "Next",
  planned: "Planned",
};

export function SendingPlanTable({ weeks, note }: { weeks: PlanWeek[]; note?: string }) {
  if (weeks.length === 0) return null;
  return (
    <div>
      {note ? <p className="max-w-prose text-body-sm text-secondary">{note}</p> : null}
      <div className="mt-sm overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-body-sm">
          <thead>
            <tr className="text-left text-label uppercase tracking-label text-muted">
              <th className="py-sm pl-sm pr-sm font-medium">Week</th>
              <th className="px-sm py-sm font-medium">Dates</th>
              <th className="px-sm py-sm font-medium">Phase</th>
              <th className="px-sm py-sm text-right font-medium">New investors / day</th>
              <th className="px-sm py-sm text-right font-medium">New investors</th>
              <th className="px-sm py-sm text-right font-medium">Emails (approx.)</th>
              <th className="py-sm pl-sm pr-sm font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => {
              const on = week.status === "current" || week.status === "next";
              return (
                <tr
                  key={week.week}
                  className="border-t"
                  style={on ? { backgroundColor: "#eaf4ee", borderColor: "#a8d2c6" } : { borderColor: "#e4e4de" }}
                >
                  <td className="py-sm pl-sm pr-sm" style={on ? { color: "#0e5e4f", fontWeight: 500 } : undefined}>
                    Week {week.week}
                  </td>
                  <td className="px-sm py-sm text-secondary">{weekLabel(week.start, week.end)}</td>
                  <td className="px-sm py-sm">
                    <span
                      className="rounded-full px-sm py-[2px] text-[12px]"
                      style={on ? { backgroundColor: "#ffffff", color: "#0e5e4f", border: "1px solid #a8d2c6" } : { backgroundColor: "#f3f3ee", color: "#4a5568" }}
                    >
                      {week.phase}
                    </span>
                  </td>
                  <td className="px-sm py-sm text-right font-mono text-mono">{week.perDay}</td>
                  <td className="px-sm py-sm text-right font-mono text-mono">{week.newInvestors}</td>
                  <td className="px-sm py-sm text-right font-mono text-mono">~{week.emails}</td>
                  <td className="py-sm pl-sm pr-sm" style={on ? { color: "#0e5e4f", fontWeight: 500 } : { color: "#5f5f5a" }}>
                    {on ? "● " : ""}
                    {STATUS[week.status]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
