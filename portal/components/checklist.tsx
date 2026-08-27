import Link from "next/link";

export type ChecklistDisplayStatus =
  | "done"
  | "wip"
  | "open"
  | "your_turn"
  | "waiting";

export type ChecklistRowItem = {
  id: string;
  title: string;
  detail?: string;
  href?: string;
  status: ChecklistDisplayStatus;
  statusLabel?: string;
  clickable?: boolean;
  dimmed?: boolean;
};

const statusCopy: Record<ChecklistDisplayStatus, string> = {
  done: "Done",
  wip: "In progress",
  open: "Open",
  your_turn: "Your turn",
  waiting: "Waiting on Rupert",
};

function StatusIcon({ status }: { status: ChecklistDisplayStatus }) {
  if (status === "done") {
    return (
      <svg className="h-5 w-5 text-success" viewBox="0 0 20 20" aria-hidden>
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 6.25 8.25 14.5 3.5 9.75"
        />
      </svg>
    );
  }

  if (status === "your_turn") {
    return (
      <svg className="h-5 w-5 text-primary" viewBox="0 0 20 20" aria-hidden>
        <circle
          cx="10"
          cy="10"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle
          cx="10"
          cy="10"
          r="2.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  if (status === "waiting") {
    return (
      <svg className="h-5 w-5 text-muted" viewBox="0 0 20 20" aria-hidden>
        <circle
          cx="10"
          cy="10"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          d="M10 7.25V10l1.75 1.75"
        />
      </svg>
    );
  }

  const dotClass = status === "wip" ? "fill-warning" : "fill-muted";

  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="3" className={dotClass} />
    </svg>
  );
}

function StatusPill({
  status,
  label,
}: {
  status: ChecklistDisplayStatus;
  label?: string;
}) {
  const styles: Record<ChecklistDisplayStatus, string> = {
    done: "border-border text-success",
    wip: "border-border text-warning",
    open: "border-border text-muted",
    your_turn: "border-primary/30 bg-primary-tint text-primary",
    waiting: "border-border text-muted",
  };

  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-sm py-xs text-label uppercase tracking-label ${styles[status]}`}
    >
      {label ?? statusCopy[status]}
    </span>
  );
}

function ItemRow({ item }: { item: ChecklistRowItem }) {
  const content = (
    <div
      className={`flex items-center gap-md px-lg py-md ${
        item.dimmed ? "opacity-40" : ""
      } ${item.clickable ? "transition-colors duration-hover hover:bg-background" : ""}`}
    >
      <StatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <p className="text-body-sm text-heading">{item.title}</p>
        {item.detail ? (
          <p className="text-body-sm text-muted">{item.detail}</p>
        ) : null}
      </div>
      <StatusPill status={item.status} label={item.statusLabel} />
    </div>
  );

  if (item.clickable && item.href) {
    return (
      <Link href={item.href} className="block no-underline">
        {content}
      </Link>
    );
  }

  return content;
}

export function Checklist({
  items,
  framed = true,
}: {
  items: ChecklistRowItem[];
  framed?: boolean;
}) {
  return (
    <div
      className={
        framed
          ? "overflow-hidden rounded-card border border-border bg-surface"
          : undefined
      }
    >
      {items.map((item, index) => (
        <div
          key={item.id}
          className={index === 0 ? "" : "border-t border-border"}
        >
          <ItemRow item={item} />
        </div>
      ))}
    </div>
  );
}
