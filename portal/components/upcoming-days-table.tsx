import type { UpcomingDay } from "@/lib/outreach/presend";

// The client's Live page: the next five sending days, one row each, with a
// few of the funds getting a first email that day. Today is highlighted in
// the Live banner's green.

const dayText = (day: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

export function UpcomingDaysTable({ days, today, paused, left }: { days: UpcomingDay[]; today: string; paused: boolean; left: number }) {
  if (days.length === 0) return null;
  const total = days.reduce((n, d) => n + d.firsts, 0);
  return (
    <section className="mt-lg rounded-card border border-border bg-surface px-lg py-lg">
      <h2 className="text-h3">Next 5 Sending Days</h2>
      <p className="mt-xs max-w-prose text-body-sm text-secondary">
        {paused
          ? "Your campaign is paused, so nothing goes out until it starts again. This is what the days look like once it does."
          : `About ${total} new investors over these days, from your inbox, weekdays 9am to 5pm Eastern. Follow-ups go out 5 business days after each first email, in the same thread; anyone who replies gets none.`}{" "}
        {left > 0 ? `${left} still to reach after today.` : ""}
      </p>
      <div className="mt-md overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-body-sm">
          <thead>
            <tr className="text-left text-label uppercase tracking-label text-muted">
              <th className="py-sm pl-sm pr-sm font-medium">Day</th>
              <th className="px-sm py-sm text-right font-medium">First Emails</th>
              <th className="px-sm py-sm text-right font-medium">Follow-Ups</th>
              <th className="px-sm py-sm text-right font-medium">Total</th>
              <th className="py-sm pl-md pr-sm font-medium">Some of the Funds</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const on = d.day === today;
              const more = d.fundCount - d.funds.length;
              return (
                <tr key={d.day} className="border-t" style={on ? { backgroundColor: "#eaf4ee", borderColor: "#a8d2c6" } : { borderColor: "#e4e4de" }}>
                  <td className="py-sm pl-sm pr-sm whitespace-nowrap" style={on ? { color: "#0e5e4f", fontWeight: 500 } : undefined}>
                    {on ? "● Today" : dayText(d.day)}
                    {on ? <span className="ml-xs text-muted">{dayText(d.day)}</span> : null}
                  </td>
                  <td className="px-sm py-sm text-right font-mono text-mono">{d.firsts}</td>
                  <td className="px-sm py-sm text-right font-mono text-mono">{d.followups}</td>
                  <td className="px-sm py-sm text-right font-mono text-mono">{d.firsts + d.followups}</td>
                  <td className="py-sm pl-md pr-sm text-secondary">
                    {d.funds.length ? `${d.funds.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : d.followups ? "Follow-ups only" : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-sm text-body-sm text-muted">
        An estimate: each morning Rupert checks the day&apos;s contacts first, and may swap one for a colleague at the same fund.
      </p>
    </section>
  );
}
