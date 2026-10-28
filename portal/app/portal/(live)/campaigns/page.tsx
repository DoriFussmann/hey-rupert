import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { SendingPlanTable } from "@/components/sending-plan-table";
import { getPortalView } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { percent, type AnalyticsRow } from "@/lib/outreach/analytics";
import { clientAnalytics, loadCampaignData, periodChoice } from "@/lib/outreach/analytics-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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
                <th className="px-sm py-sm font-medium">Open rate</th>
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

export default async function CampaignsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const { client } = await getPortalView();
  const loaded = client?.id && isServiceRoleConfigured() ? await loadCampaignData(createServiceClient(), client.id) : null;
  const data = loaded?.ok ? loaded.value : null;

  const header = (
    <>
      <BackLink href="/portal/live-campaign" label="Live Campaign" />
      <PageHeader
        title="Campaign Analytics"
        description="How your outreach is going, by week, tier and fund type. Replies count once Rupert passes them on; opens are an estimate, since some email apps block them."
      />
    </>
  );

  if (!data) {
    return (
      <>
        {header}
        <p className="rounded-card border border-border bg-surface px-lg py-md text-body-sm text-muted">
          {loaded && !loaded.ok ? "Analytics couldn't load. Rupert has been told." : "Analytics start once your campaign is live."}
        </p>
      </>
    );
  }

  const choice = periodChoice(searchParams ?? {}, data.currentWeek);
  const view = clientAnalytics(data, choice);
  const { totals, tiers, types, daily } = view.analytics;
  const max = Math.max(1, ...daily.map((d) => d.sent));
  const weeks = Array.from({ length: data.currentWeek }, (_, i) => i + 1);
  const isOn = (from: number | null, to: number | null) =>
    from === null ? choice === null : choice !== null && choice.from === from && choice.to === to;

  const cards = [
    { label: "Emails sent", value: String(totals.sent), sub: "First emails and follow-ups" },
    { label: "Delivered", value: percent(totals.sent ? totals.delivered / totals.sent : null), sub: `${totals.delivered} delivered · ${totals.bounced} bounced` },
    { label: "Open rate", value: percent(totals.openRate), sub: `${totals.opened} opened` },
    { label: "Replies", value: String(totals.replies), sub: `${percent(totals.replyRate)} reply rate` },
    { label: "Meetings", value: String(totals.meetings), sub: "Booked from replies" },
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
                href={`/portal/campaigns?from=${w}&to=${w}`}
                aria-current={isOn(w, w) ? "page" : undefined}
                className={`${chip} ${isOn(w, w) ? "bg-heading text-white" : "text-secondary hover:text-heading"}`}
              >
                Week {w}
              </Link>
            ))}
            <Link
              href="/portal/campaigns"
              aria-current={isOn(null, null) ? "page" : undefined}
              className={`${chip} ${isOn(null, null) ? "bg-heading text-white" : "text-secondary hover:text-heading"}`}
            >
              All time
            </Link>
          </nav>
          {data.currentWeek > 1 ? (
            <form action="/portal/campaigns" className="flex flex-wrap items-center gap-xs text-body-sm text-secondary">
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
          <div key={card.label} className="rounded-card border border-border bg-surface px-lg py-lg">
            <p className="text-label uppercase tracking-label text-muted">{card.label}</p>
            <p className="mt-sm font-mono text-h2 text-heading">{card.value}</p>
            <p className="mt-xs text-body-sm text-muted">{card.sub}</p>
          </div>
        ))}
      </div>

      <section className="mt-lg rounded-card border border-border bg-surface px-lg py-lg">
        <div className="flex flex-wrap items-baseline justify-between gap-sm">
          <h2 className="text-h4">Emails sent per day</h2>
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

      <div className="mt-lg flex flex-wrap gap-lg">
        <BreakdownTable title="By tier" first="Tier" rows={tiers} />
        <BreakdownTable title="By fund type" first="Fund type" rows={types} />
      </div>

      <section className="mt-lg rounded-card border border-border bg-surface px-lg py-lg">
        <h2 className="text-h4">Sending plan</h2>
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
