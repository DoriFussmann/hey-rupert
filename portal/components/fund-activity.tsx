import type { ReactNode } from "react";
import type { BookedFund, OpenedFund, ReceivedFund, RepliedFund } from "@/lib/outreach/analytics";
import { replyLabelText } from "@/lib/outreach/live";

// The fund lists under the Campaign Analytics cards: Who We Sent To, Who Got
// It, Who Opened, Who Replied, Who Booked. One fund per row, newest first.
// The client sees funds; Rupert (`people`) also sees who at each fund.

const STEP: Record<number, string> = { 1: "First email", 2: "Follow-up", 3: "Follow-up 2" };

function when(at: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(at));
  } catch {
    return at.slice(0, 16).replace("T", " ");
  }
}

type Person = { name: string; title: string; note?: string; alert?: boolean };
type Row = { key: string; fund: string; tier: string; stat: ReactNode; chips: string[]; green?: boolean; lastAt: string; people: Person[] };

function FundRow({ row, people, timeZone }: { row: Row; people: boolean; timeZone: string }) {
  return (
    <li className="grid gap-xs border-t border-border py-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center sm:gap-md">
      <div className="min-w-0">
        <p className="truncate text-body text-heading">{row.fund || "Unknown fund"}</p>
        {people && row.people.length ? (
          <p className="text-body-sm text-muted">
            {row.people.map((p, i) => (
              <span key={`${p.name}-${i}`}>
                {i > 0 ? " · " : ""}
                {p.name || "Unknown"}
                {p.title ? `, ${p.title}` : ""}
                {p.note ? <span className={p.alert ? "text-error" : undefined}> ({p.note})</span> : null}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <p className="text-body-sm text-secondary">
        {row.tier ? <span className="rounded-full bg-[#f3f3ee] px-sm py-[2px] text-[12px] text-secondary">{row.tier}</span> : null} {row.stat}
      </p>
      <p className="flex flex-wrap gap-xs">
        {row.chips.map((c) => (
          <span
            key={c}
            className="rounded-full px-sm py-[2px] text-[12px]"
            style={row.green ? { backgroundColor: "#eaf4ee", color: "#0e5e4f", border: "1px solid #a8d2c6" } : { backgroundColor: "#f3f3ee", color: "#4a5568", border: "1px solid #e4e4de" }}
          >
            {c}
          </span>
        ))}
      </p>
      <p className="whitespace-nowrap text-body-sm text-muted sm:text-right">{when(row.lastAt, timeZone)}</p>
    </li>
  );
}

function FundList({
  id,
  title,
  rows,
  people,
  timeZone,
  empty,
  extra,
  note,
}: {
  id: string;
  title: string;
  rows: Row[];
  people: boolean;
  timeZone: string;
  empty: string;
  extra?: string;
  note?: string;
}) {
  const shown = rows.slice(0, 15);
  const rest = rows.slice(15);
  return (
    <section id={id} className="mt-lg scroll-mt-lg rounded-card border border-border bg-surface px-lg py-lg">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h2 className="text-h4">{title}</h2>
        <p className="text-body-sm text-muted">
          {rows.length} fund{rows.length === 1 ? "" : "s"}
          {extra ? ` · ${extra}` : ""} · newest first · times Eastern
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-sm text-body-sm text-muted">{empty}</p>
      ) : (
        <>
          <ul className="mt-sm">
            {shown.map((row) => (
              <FundRow key={row.key} row={row} people={people} timeZone={timeZone} />
            ))}
          </ul>
          {rest.length ? (
            <details className="mt-xs">
              <summary className="cursor-pointer py-sm text-body-sm text-primary">Show all {rows.length}</summary>
              <ul>
                {rest.map((row) => (
                  <FundRow key={row.key} row={row} people={people} timeZone={timeZone} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      {note ? <p className="mt-sm max-w-prose text-body-sm text-muted">{note}</p> : null}
    </section>
  );
}

const stat = (value: string, word: string) => (
  <>
    <span className="font-mono text-mono">{value}</span> {word}
  </>
);

export function FundActivity({
  received,
  opened,
  replied,
  booked,
  people,
  timeZone = "America/Detroit",
}: {
  received: ReceivedFund[];
  opened: OpenedFund[];
  replied: RepliedFund[];
  booked: BookedFund[];
  people: boolean;
  timeZone?: string;
}) {
  const bounced = received.reduce((n, f) => n + f.bounced, 0);
  const sentRows: Row[] = received.map((f) => ({
    key: f.firmId,
    fund: f.fund,
    tier: f.tier,
    stat: (
      <>
        {stat(String(f.emailed), f.emailed === 1 ? "investor" : "investors")}
        {f.bounced ? <span className="text-error"> · {f.bounced} bounced</span> : null}
      </>
    ),
    chips: f.steps.map((s) => STEP[s] ?? `Email ${s}`),
    lastAt: f.lastAt,
    people: f.people.map((p) => ({ name: p.name, title: p.title, note: p.bounced ? "bounced" : undefined, alert: p.bounced })),
  }));
  const gotRows: Row[] = received
    .filter((f) => f.emailed > f.bounced)
    .map((f) => ({
      key: f.firmId,
      fund: f.fund,
      tier: f.tier,
      stat: stat(`${f.emailed - f.bounced}/${f.emailed}`, "got it"),
      chips: f.steps.map((s) => STEP[s] ?? `Email ${s}`),
      lastAt: f.lastAt,
      people: f.people.filter((p) => !p.bounced).map((p) => ({ name: p.name, title: p.title })),
    }));
  const openRows: Row[] = opened.map((f) => ({
    key: f.firmId,
    fund: f.fund,
    tier: f.tier,
    stat: stat(`${f.opened}/${f.emailed}`, "opened"),
    chips: f.steps.map((s) => STEP[s] ?? `Email ${s}`),
    green: true,
    lastAt: f.lastAt,
    people: f.people.map((p) => ({ name: p.name, title: p.title })),
  }));
  const replyRows: Row[] = replied.map((f) => ({
    key: f.firmId,
    fund: f.fund,
    tier: f.tier,
    stat: stat(String(f.replies), f.replies === 1 ? "reply" : "replies"),
    chips: f.labels.map(replyLabelText),
    green: true,
    lastAt: f.lastAt,
    people: f.people.map((p) => ({ name: p.name, title: p.title, note: p.label ? replyLabelText(p.label) : undefined })),
  }));
  const bookRows: Row[] = booked.map((f) => ({
    key: f.firmId,
    fund: f.fund,
    tier: f.tier,
    stat: stat(String(f.meetings), f.meetings === 1 ? "meeting" : "meetings"),
    chips: ["Meeting"],
    green: true,
    lastAt: f.lastAt,
    people: f.people.map((p) => ({ name: p.name, title: p.title })),
  }));
  return (
    <>
      <FundList id="who-we-sent-to" title="Who We Sent To" rows={sentRows} people={people} timeZone={timeZone} empty="Nothing sent in this period yet." extra={bounced ? `${bounced} bounced` : undefined} />
      <FundList
        id="who-got-it"
        title="Who Got It"
        rows={gotRows}
        people={people}
        timeZone={timeZone}
        empty="Nothing delivered in this period yet."
        note="Got it means the email was sent and didn't bounce. A bounced address gets no follow-up."
      />
      <FundList
        id="who-opened"
        title="Who Opened"
        rows={openRows}
        people={people}
        timeZone={timeZone}
        empty="No opens in this period yet."
        note="An open is a signal, not a reply: some email apps block opens, and Apple Mail can open every email on its own. A fund that opened more than once, or opened the follow-up, is the stronger sign."
      />
      <FundList id="who-replied" title="Who Replied" rows={replyRows} people={people} timeZone={timeZone} empty="No replies in this period yet." />
      <FundList id="who-booked" title="Who Booked" rows={bookRows} people={people} timeZone={timeZone} empty="No meetings booked in this period yet." />
    </>
  );
}
