import Link from "next/link";
import type { ReactNode } from "react";
import { SendingPlanTable } from "@/components/sending-plan-table";
import { FundActivity } from "@/components/fund-activity";
import { percent, type AnalyticsRow } from "@/lib/outreach/analytics";
import type { CampaignData, ClientAnalytics, PeriodChoice } from "@/lib/outreach/analytics-server";

// Campaign Analytics, shared by the client's portal page and Rupert's admin
// page. `people`: show the investors' names under each fund (Rupert only; the
// client sees funds, as on the Engagement Tracker).

const chip = "inline-flex min-h-[40px] items-center rounded-md px-md text-body-sm transition-colors duration-hover";

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

function BreakdownTable({ title, first, rows }: { title: string; first: string; rows: AnalyticsRow[] }) {
  return (
    <section className="min-w-0 flex-[1_1_480px] rounded-card border border-border bg-surface px-lg py-lg">
      <h2 className="text-h4">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-sm text-body-sm text-muted">Nothing sent in this period.</p>
      ) : (
        <div className="mt-sm overflow-x-auto">
          <table className="w-full min-w-[440px] border-collapse text-body-sm">
            <thead>
              <tr className="text-left text-label uppercase tracking-label text-muted">
                <th className="py-sm pr-sm font-medium">{first}</th>
                <th className="px-sm py-sm text-right font-medium">Sent</th>
                <th className="px-sm py-sm text-right font-medium">Delivered</th>
                <th className="px-sm py-sm font-medium">Open Rate</th>
                <th className="px-sm py-sm text-right font-medium">Replies</th>
                <th className="py-sm pl-sm text-right font-medium">Meetings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-border">
                  <td className="py-sm pr-sm text-heading">{row.name}</td>
                  <td className="px-sm py-sm text-right font-mono text-mono">{row.sent}</td>
                  <td className="px-sm py-sm text-right font-mono text-mono">{row.delivered}</td>
                  <td className="px-sm py-sm">
                    <span className="flex items-center gap-sm">
                      <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-[#efefea]">
                        <span className="block h-[6px] bg-primary" style={{ width: `${Math.round((row.openRate ?? 0) * 100)}%` }} />
                      </span>
                      <span className="w-12 text-right font-mono text-mono">{percent(row.openRate)}</span>
                    </span>
                  </td>
                  <td className="px-sm py-sm text-right font-mono text-mono">{row.replies}</td>
                  <td className="py-sm pl-sm text-right font-mono text-mono">{row.meetings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CampaignAnalyticsView({
  data,
  choice,
  view,
  basePath,
  people,
  header,
}: {
  data: CampaignData;
  choice: PeriodChoice;
  view: ClientAnalytics;
  basePath: string;
  people: boolean;
  header: ReactNode;
}) {
  const { totals, tiers, types, daily } = view.analytics;
  const max = Math.max(1, ...daily.map((d) => d.sent));
  const weeks = Array.from({ length: data.currentWeek }, (_, i) => i + 1);
  const isOn = (from: number | null, to: number | null) =>
    from === null ? choice === null : choice !== null && choice.from === from && choice.to === to;

  const cards = [
    { label: "Sent", value: String(totals.sent), href: "#who-we-sent-to" },
    { label: "Delivered", value: percent(totals.sent ? totals.delivered / totals.sent : null), href: "#who-got-it" },
    { label: "Opened", value: percent(totals.openRate), href: "#who-opened" },
    { label: "Replied", value: String(totals.replies), href: "#who-replied" },
    { label: "Booked", value: String(totals.meetings), href: "#who-booked" },
  ];

  return (
    <>
      {header}
      <div className="mb-lg flex flex-wrap items-end justify-between gap-md">
        <div>
          <p className="text-label uppercase tracking-label text-muted">
            Live campaign · Week {data.currentWeek}
            {data.pausedAt ? " · paused" : ""}
          </p>
          <p className="mt-xs text-body-sm text-secondary">
            Showing {view.label} · {view.dates}
          </p>
        </div>
        <div className="grid gap-sm">
          <nav aria-label="Period" className="flex flex-wrap gap-xs rounded-card border border-border bg-surface p-xs">
            {weeks.map((w) => (
              <Link
                key={w}
                href={`${basePath}?from=${w}&to=${w}`}
                aria-current={isOn(w, w) ? "page" : undefined}
                className={`${chip} ${isOn(w, w) ? "bg-heading text-white" : "text-secondary hover:text-heading"}`}
              >
                Week {w}
              </Link>
            ))}
            <Link
              href={basePath}
              aria-current={isOn(null, null) ? "page" : undefined}
              className={`${chip} ${isOn(null, null) ? "bg-heading text-white" : "text-secondary hover:text-heading"}`}
            >
              All time
            </Link>
          </nav>
          {data.currentWeek > 1 ? (
            <form action={basePath} className="flex flex-wrap items-center gap-xs text-body-sm text-secondary">
              <label htmlFor="period-from">Weeks</label>
              <select id="period-from" name="from" defaultValue={choice?.from ?? 1} className="rounded-md border border-border bg-surface px-sm py-xs">
                {weeks.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <label htmlFor="period-to">to</label>
              <select id="period-to" name="to" defaultValue={choice?.to ?? data.currentWeek} className="rounded-md border border-border bg-surface px-sm py-xs">
                {weeks.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-md border border-border bg-surface px-md py-xs text-secondary hover:text-heading">
                Show
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <a
            key={card.label}
            href={card.href}
            className="group rounded-card border border-border bg-surface px-md py-md no-underline transition-colors duration-hover hover:border-primary"
          >
            <p className="text-label uppercase tracking-label text-muted transition-colors duration-hover group-hover:text-primary">{card.label}</p>
            <p className="mt-xs font-mono text-h2 text-heading">{card.value}</p>
          </a>
        ))}
      </div>

      <section className="mt-lg rounded-card border border-border bg-surface px-lg py-lg">
        <div className="flex flex-wrap items-baseline justify-between gap-sm">
          <h2 className="text-h4">Emails Sent per Day</h2>
          <p className="text-body-sm text-muted">First emails and follow-ups · weekdays, 9am–5pm Eastern</p>
        </div>
        {daily.length === 0 ? (
          <p className="mt-sm text-body-sm text-muted">No sending days in this period yet.</p>
        ) : (
          <div className="mt-md overflow-x-auto">
            <div className="flex h-[170px] items-end gap-sm border-b border-border" style={{ minWidth: `${Math.max(320, daily.length * 44)}px` }}>
              {daily.map((d) => (
                <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-xs">
                  <span className="font-mono text-[12px] text-secondary">{d.sent}</span>
                  <div className="w-full max-w-[44px] rounded-t bg-primary" style={{ height: `${Math.max(3, Math.round((d.sent / max) * 130))}px` }} />
                </div>
              ))}
            </div>
            <div className="mt-xs flex gap-sm" style={{ minWidth: `${Math.max(320, daily.length * 44)}px` }}>
              {daily.map((d) => (
                <span key={d.day} className="flex-1 whitespace-nowrap text-center text-[11px] text-muted">
                  {dayLabel(d.day)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <FundActivity activity={view.activity} people={people} timeZone={data.settings.timezone} />

      <div className="mt-lg flex flex-wrap gap-lg">
        <BreakdownTable title="By Tier" first="Tier" rows={tiers} />
        <BreakdownTable title="By Fund Type" first="Fund type" rows={types} />
      </div>

      <section className="mt-lg rounded-card border border-border bg-surface px-lg py-lg">
        <h2 className="text-h4">Sending Plan</h2>
        <SendingPlanTable
          weeks={data.plan}
          note={`${data.activeTotal} investors · weekdays only, 9am–5pm Eastern · never more than 30 emails a day, follow-ups included · follow-ups ${data.settings.followup_days[0]} and ${data.settings.followup_days[1]} days apart.`}
        />
      </section>

      <p className="mt-lg max-w-prose text-body-sm text-muted">
        Delivered is sent minus bounced. Links aren&apos;t tracked: the emails carry none, and tracked links hurt delivery.
      </p>
    </>
  );
}
