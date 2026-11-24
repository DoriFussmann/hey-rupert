"use client";

// The three finished launch steps, side by side: Inbox Connected, Invoice
// Paid, Launch Confirmed. On the Go Live page they are the cards the steps
// morph into when the client approves the launch (see go-live-view.tsx).
// Each tile carries the same view-transition-name as its step card.

export const LAUNCH_VT = { inbox: "rupert-step-inbox", invoice: "rupert-step-invoice", confirm: "rupert-step-confirm" } as const;

function Tile({ name, title, detail, index }: { name: string; title: string; detail: string; index: number }) {
  return (
    <div
      className="launch-tile relative overflow-hidden rounded-card border border-primary/40 bg-surface px-md py-md"
      style={{ viewTransitionName: name, ["--i" as string]: index }}
    >
      <div className="flex items-center gap-sm">
        <span className="launch-check flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <p className="text-h4 text-heading">{title}</p>
      </div>
      <p className="mt-xs truncate pl-[2.25rem] text-body-sm text-muted" title={detail}>
        {detail}
      </p>
      <span className="launch-sheen pointer-events-none absolute inset-0" aria-hidden />
    </div>
  );
}

export function LaunchDoneRow({
  inboxEmail,
  paidOn,
  confirmedOn,
  celebrate = false,
}: {
  inboxEmail: string | null;
  paidOn: string;
  confirmedOn: string;
  celebrate?: boolean;
}) {
  return (
    <div className={`launch-done relative ${celebrate ? "launch-celebrate" : ""}`}>
      <span className="launch-glow pointer-events-none absolute inset-x-0 -top-lg mx-auto h-40 max-w-2xl rounded-full" aria-hidden />
      <div className="relative grid gap-sm sm:grid-cols-3">
        <Tile name={LAUNCH_VT.inbox} index={0} title="Inbox Connected" detail={inboxEmail ?? "Connected"} />
        <Tile name={LAUNCH_VT.invoice} index={1} title="Invoice Paid" detail={paidOn} />
        <Tile name={LAUNCH_VT.confirm} index={2} title="Launch Confirmed" detail={confirmedOn} />
      </div>
    </div>
  );
}
