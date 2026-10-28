import { weekLabel, type PlanWeek } from "@/lib/outreach/live";

// What happens after the client approves the launch, week by week: the pace,
// how many investors get their first email and from which tiers, and when
// only follow-ups are left. The week in progress (or, before launch, the
// first) is marked in the Live banner's green.

const GREEN = "#0e816c";
const GREEN_DARK = "#0e5e4f";
const MINT = "#a8d2c6";
const PALE = "#eaf4ee";

function Dot({ on, done }: { on: boolean; done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="absolute left-0 top-[6px] flex h-[14px] w-[14px] items-center justify-center rounded-full border-2"
      style={{ borderColor: on || done ? GREEN : "#c9c9c2", backgroundColor: done ? GREEN : on ? "#ffffff" : "#ffffff" }}
    >
      {on ? <span className="h-[6px] w-[6px] rounded-full" style={{ backgroundColor: GREEN }} /> : null}
    </span>
  );
}

function Entry({ on, done, children }: { on: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <li className="relative pb-lg pl-xl last:pb-0">
      <Dot on={on} done={done} />
      <div
        className="rounded-card border px-lg py-md"
        style={on ? { backgroundColor: PALE, borderColor: MINT } : { backgroundColor: "#ffffff", borderColor: "#e4e4de" }}
      >
        {children}
      </div>
    </li>
  );
}

export function LaunchTimeline({
  weeks,
  live,
  requested,
}: {
  weeks: PlanWeek[];
  /** The campaign is sending. */
  live: boolean;
  /** The client approved the launch; Rupert starts within 24 hours. */
  requested: boolean;
}) {
  if (weeks.length === 0) return null;
  const firstFollowUpsOnly = weeks.findIndex((w) => w.phase === "Follow-ups only");
  const sending = firstFollowUpsOnly < 0 ? weeks : weeks.slice(0, firstFollowUpsOnly);
  const tail = firstFollowUpsOnly < 0 ? [] : weeks.slice(firstFollowUpsOnly);
  const totalNew = weeks.reduce((sum, w) => sum + w.newInvestors, 0);
  const lastWeek = weeks[weeks.length - 1];

  return (
    <ol className="relative mt-md before:absolute before:bottom-[20px] before:left-[6px] before:top-[12px] before:w-px before:bg-border">
      <Entry on={!live && requested} done={live}>
        <p className="text-label uppercase tracking-label" style={{ color: live || requested ? GREEN_DARK : "#5f5f5a" }}>
          {live ? "Started" : requested ? "Now" : "When you approve"}
        </p>
        <p className="mt-xs text-h4 text-heading">{live ? "Rupert started your campaign" : "Within 24 hours, Rupert starts sending"}</p>
        <p className="mt-xs max-w-prose text-body-sm text-secondary">
          {live
            ? "Your emails go out from your inbox, in your name, on weekdays between 9am and 5pm Eastern."
            : "He runs a final check and starts the campaign. You get an email the moment it's live. Emails go out from your inbox, in your name, on weekdays between 9am and 5pm Eastern."}
        </p>
      </Entry>

      {sending.map((week) => {
        const on = week.status === "current" || (week.status === "next" && !live);
        const done = week.status === "done";
        return (
          <Entry key={week.week} on={on} done={done}>
            <div className="flex flex-wrap items-baseline justify-between gap-sm">
              <p className="text-h4 text-heading">
                Week {week.week}
                <span className="ml-sm text-body-sm font-normal text-secondary">{weekLabel(week.start, week.end)}</span>
              </p>
              <span
                className="rounded-full px-sm py-[2px] text-[12px]"
                style={on ? { backgroundColor: "#ffffff", color: GREEN_DARK, border: `1px solid ${MINT}` } : { backgroundColor: "#f3f3ee", color: "#4a5568" }}
              >
                {week.status === "current" ? "This week · " : done ? "Done · " : ""}
                {week.phase}
              </span>
            </div>
            <p className="mt-sm text-body text-heading">
              Up to <span className="font-mono">{week.cap}</span> emails a day
              {week.phase === "Warm-up" ? ", to start your inbox gently" : week.phase === "Ramp-up" ? ", building up" : ""}.
            </p>
            <p className="mt-xs text-body-sm text-secondary">
              About <span className="text-heading">{week.newInvestors}</span> investors get their first email
              {week.byTier.length > 0 ? ": " : "."}
              {week.byTier.map((t, i) => (
                <span key={t.label}>
                  {i > 0 ? " · " : ""}
                  {t.label} {t.count}
                </span>
              ))}
              {week.byTier.length > 0 ? "." : ""}
              {week.week > 1 ? " Earlier investors get their follow-ups first, in the same thread." : ""}
            </p>
          </Entry>
        );
      })}

      {tail.length > 0 ? (
        <Entry on={tail.some((w) => w.status === "current")} done={tail.every((w) => w.status === "done")}>
          <p className="text-h4 text-heading">
            {tail.length === 1 ? `Week ${tail[0].week}` : `Weeks ${tail[0].week}–${lastWeek.week}`}
            <span className="ml-sm text-body-sm font-normal text-secondary">{weekLabel(tail[0].start, lastWeek.end)}</span>
          </p>
          <p className="mt-sm text-body-sm text-secondary">
            All {totalNew} investors have had their first email. Only the last follow-ups go out; anyone who replied gets no more.
          </p>
        </Entry>
      ) : null}

      <Entry on={false} done={false}>
        <p className="text-h4 text-heading">All along</p>
        <p className="mt-xs max-w-prose text-body-sm text-secondary">
          Rupert reads every reply first. The ones that need you appear in your Investor Inbox, and you answer from your own email, in
          the same thread. Never more than 30 emails a day leave your inbox.
        </p>
      </Entry>
    </ol>
  );
}
