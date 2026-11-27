import type { OpenedFund } from "@/lib/outreach/analytics";

// Who opened, by fund, newest first. The client sees funds and how many of
// their investors opened; Rupert (`people`) also sees who.

const STEP: Record<number, string> = { 1: "First email", 2: "Follow-up", 3: "Follow-up 2" };

function when(at: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(at));
  } catch {
    return at.slice(0, 16).replace("T", " ");
  }
}

function Row({ fund, people, timeZone }: { fund: OpenedFund; people: boolean; timeZone: string }) {
  return (
    <li className="grid gap-xs border-t border-border py-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center sm:gap-md">
      <div className="min-w-0">
        <p className="truncate text-body text-heading">{fund.fund}</p>
        {people ? (
          <p className="text-body-sm text-muted">
            {fund.people.map((p) => `${p.name || "Unknown"}${p.title ? `, ${p.title}` : ""}`).join(" · ")}
          </p>
        ) : null}
      </div>
      <p className="text-body-sm text-secondary">
        <span className="rounded-full bg-[#f3f3ee] px-sm py-[2px] text-[12px] text-secondary">{fund.tier}</span>{" "}
        <span className="font-mono text-mono">
          {fund.opened}/{fund.emailed}
        </span>{" "}
        opened
      </p>
      <p className="flex flex-wrap gap-xs">
        {fund.steps.map((s) => (
          <span key={s} className="rounded-full px-sm py-[2px] text-[12px]" style={{ backgroundColor: "#eaf4ee", color: "#0e5e4f", border: "1px solid #a8d2c6" }}>
            {STEP[s] ?? `Email ${s}`}
          </span>
        ))}
      </p>
      <p className="whitespace-nowrap text-body-sm text-muted sm:text-right">{when(fund.lastAt, timeZone)}</p>
    </li>
  );
}

export function WhoOpened({ funds, people, timeZone = "America/Detroit" }: { funds: OpenedFund[]; people: boolean; timeZone?: string }) {
  const shown = funds.slice(0, 15);
  const rest = funds.slice(15);
  return (
    <section id="who-opened" className="mt-lg scroll-mt-lg rounded-card border border-border bg-surface px-lg py-lg">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h2 className="text-h4">Who Opened</h2>
        <p className="text-body-sm text-muted">
          {funds.length} fund{funds.length === 1 ? "" : "s"} · newest first · times Eastern
        </p>
      </div>
      {funds.length === 0 ? (
        <p className="mt-sm text-body-sm text-muted">No opens in this period yet.</p>
      ) : (
        <>
          <ul className="mt-sm">
            {shown.map((fund) => (
              <Row key={fund.firmId} fund={fund} people={people} timeZone={timeZone} />
            ))}
          </ul>
          {rest.length ? (
            <details className="mt-xs">
              <summary className="cursor-pointer py-sm text-body-sm text-primary">Show all {funds.length}</summary>
              <ul>
                {rest.map((fund) => (
                  <Row key={fund.firmId} fund={fund} people={people} timeZone={timeZone} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      <p className="mt-sm max-w-prose text-body-sm text-muted">
        An open is a signal, not a reply: some email apps block opens, and Apple Mail can open every email on its own. A fund that
        opened more than once, or opened the follow-up, is the stronger sign.
      </p>
    </section>
  );
}
