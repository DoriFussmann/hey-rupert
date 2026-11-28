import type { Activity, ActivityRow } from "@/lib/outreach/analytics";

// The lists under the Campaign Analytics cards: Who We Sent To, Who Got It,
// Who Opened, Who Replied, Who Booked. One investor per row, newest first,
// one line each (the table scrolls inside its card, sideways on a narrow screen). The client
// sees the fund; Rupert (`people`) also sees the person.

const STEP: Record<number, string> = { 1: "First email", 2: "Follow-up", 3: "Follow-up 2" };

function when(at: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(at));
  } catch {
    return at.slice(0, 16).replace("T", " ");
  }
}

const cell = "whitespace-nowrap px-sm py-sm";

function Status({ row }: { row: ActivityRow }) {
  const style = row.alert
    ? { backgroundColor: "#fdecea", color: "#a1281b", border: "1px solid #f2c1bb" }
    : row.status === "Sent"
      ? { backgroundColor: "#f3f3ee", color: "#4a5568", border: "1px solid #e4e4de" }
      : { backgroundColor: "#eaf4ee", color: "#0e5e4f", border: "1px solid #a8d2c6" };
  return (
    <span className="rounded-full px-sm py-[2px] text-[12px]" style={style}>
      {row.status}
    </span>
  );
}

function Rows({ rows, people, timeZone }: { rows: ActivityRow[]; people: boolean; timeZone: string }) {
  return (
    <>
      {rows.map((row) => (
        <tr key={row.key} className="border-t border-border align-middle">
          <td className={`${cell} pl-0 text-heading`}>
            {people && row.person ? (
              <>
                {row.person}
                <span className="text-muted">
                  {row.title ? `, ${row.title}` : ""} · {row.fund}
                </span>
              </>
            ) : (
              row.fund || "Unknown fund"
            )}
          </td>
          <td className={`${cell} text-secondary`}>{row.tier}</td>
          <td className={`${cell} text-secondary`}>{row.steps.map((s) => STEP[s] ?? `Email ${s}`).join(", ")}</td>
          <td className={`${cell} text-secondary`}>{when(row.at, timeZone)}</td>
          <td className={cell}>
            <Status row={row} />
          </td>
          <td className={`${cell} pr-0 ${row.alert ? "text-error" : "text-secondary"}`}>{row.comment || <span className="text-muted">—</span>}</td>
        </tr>
      ))}
    </>
  );
}

function ActivityTable({
  id,
  title,
  rows,
  people,
  timeZone,
  empty,
  note,
}: {
  id: string;
  title: string;
  rows: ActivityRow[];
  people: boolean;
  timeZone: string;
  empty: string;
  note?: string;
}) {
  const funds = new Set(rows.map((r) => r.fund)).size;
  return (
    <section id={id} className="mt-lg scroll-mt-lg rounded-card border border-border bg-surface px-lg py-lg">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h2 className="text-h4">{title}</h2>
        <p className="text-body-sm text-muted">
          {rows.length} investor{rows.length === 1 ? "" : "s"} at {funds} fund{funds === 1 ? "" : "s"} · newest first · times Eastern
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-sm text-body-sm text-muted">{empty}</p>
      ) : (
        // One line per investor; past about 12 rows the table scrolls inside its card, header pinned.
        <div className="mt-sm max-h-[520px] overflow-auto">
          <table className="w-full border-collapse text-body-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-label uppercase tracking-label text-muted">
                <th className={`${cell} pl-0 font-medium`}>Name</th>
                <th className={`${cell} font-medium`}>Group</th>
                <th className={`${cell} font-medium`}>Emails</th>
                <th className={`${cell} font-medium`}>Date and Time</th>
                <th className={`${cell} font-medium`}>Status</th>
                <th className={`${cell} pr-0 font-medium`}>Comments</th>
              </tr>
            </thead>
            <tbody>
              <Rows rows={rows} people={people} timeZone={timeZone} />
            </tbody>
          </table>
        </div>
      )}
      {note ? <p className="mt-sm max-w-prose text-body-sm text-muted">{note}</p> : null}
    </section>
  );
}

export function FundActivity({ activity, people, timeZone = "America/Detroit" }: { activity: Activity; people: boolean; timeZone?: string }) {
  return (
    <>
      <ActivityTable
        id="who-we-sent-to"
        title="Who We Sent To"
        rows={activity.sent}
        people={people}
        timeZone={timeZone}
        empty="Nothing sent in this period yet."
        note="A bounce gets one more try when it can: a new address from Hunter goes back in the next batch. Otherwise the next investor at the same fund takes its place."
      />
      <ActivityTable id="who-got-it" title="Who Got It" rows={activity.delivered} people={people} timeZone={timeZone} empty="Nothing delivered in this period yet." />
      <ActivityTable
        id="who-opened"
        title="Who Opened"
        rows={activity.opened}
        people={people}
        timeZone={timeZone}
        empty="No opens in this period yet."
        note="An open is a signal, not a reply: some email apps block opens, and Apple Mail can open every email on its own. Several opens, or an open of the follow-up, is the stronger sign."
      />
      <ActivityTable id="who-replied" title="Who Replied" rows={activity.replied} people={people} timeZone={timeZone} empty="No replies in this period yet." />
      <ActivityTable id="who-booked" title="Who Booked" rows={activity.booked} people={people} timeZone={timeZone} empty="No meetings booked in this period yet." />
    </>
  );
}
