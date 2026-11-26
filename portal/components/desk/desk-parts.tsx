import Link from "next/link";
import { formatDate, formatDateAtTime } from "@/lib/format";
import {
  STATUS_LABEL_ADMIN,
  STATUS_LABEL_CLIENT,
  STEP_LABEL,
  TYPE_LABEL,
  daysWaiting,
  isPortalUrl,
  sourceLabel,
  type DeskAttachment,
  type DeskItem,
  type DeskMessage,
  type DeskOpener,
  type DeskStatus,
  type ShelfAsset,
} from "@/lib/desk";
import { formatBytes } from "@/lib/setup";

// The Desk's read-only pieces, shared by the client's portal and the admin.
// `side` says who is reading: it decides the wording, never what is shown
// (internal notes are a separate component, rendered by admin pages only).

const label = "text-label uppercase tracking-label text-muted";

export function StatusChip({ status, side }: { status: DeskStatus; side: DeskOpener }) {
  const mine = side === "client" ? status === "waiting_client" : status === "waiting_us";
  const text = (side === "client" ? STATUS_LABEL_CLIENT : STATUS_LABEL_ADMIN)[status];
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-sm py-xs text-label uppercase tracking-label ${
        mine
          ? "border-primary/30 bg-primary-tint text-primary"
          : status === "closed"
            ? "border-border text-muted"
            : "border-border text-secondary"
      }`}
    >
      {text}
    </span>
  );
}

/** "Question · Investor List · Email, Nov 25" */
export function itemMeta(item: Pick<DeskItem, "type" | "step" | "source" | "occurredAt">) {
  return [TYPE_LABEL[item.type], STEP_LABEL[item.step], sourceLabel(item)].join(" · ");
}

/** One row of a Desk list. `now` is passed in so the age is the same across the page. */
export function ItemRow({
  item,
  href,
  side,
  now,
  lead,
}: {
  item: DeskItem;
  href: string;
  side: DeskOpener;
  now: Date;
  /** Shown before the title: the client's name in the cross-client inbox. */
  lead?: string;
}) {
  const mine = side === "client" ? item.status === "waiting_client" : item.status === "waiting_us";
  const days = mine ? daysWaiting(item.lastMessageAt, now) : 0;
  return (
    <li>
      <Link
        href={href}
        className="flex flex-wrap items-center justify-between gap-x-md gap-y-xs px-lg py-md no-underline transition-colors duration-hover hover:bg-background"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm text-heading">
            {lead ? <span className="text-muted">{lead} · </span> : null}
            {item.title}
          </span>
          <span className={`mt-xs block ${label}`}>{itemMeta(item)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-sm">
          <span className="text-body-sm text-muted">
            {mine && days > 0 ? `${days} ${days === 1 ? "day" : "days"}` : formatDate(item.lastMessageAt)}
          </span>
          <StatusChip status={item.status} side={side} />
        </span>
      </Link>
    </li>
  );
}

export function ItemList({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="px-lg py-md text-body-sm text-muted">{empty}</p>;
  return <ul className="divide-y divide-border">{children}</ul>;
}

export function DeskCard({
  id,
  title,
  meta,
  action,
  children,
}: {
  id?: string;
  title: string;
  meta?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="mb-lg scroll-mt-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-md border-b border-border px-lg py-md">
        <div>
          <h2 className="text-h4 text-heading">{title}</h2>
          {meta ? <p className="text-body-sm text-muted">{meta}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function AttachmentLink({
  attachment,
  fileLinks,
}: {
  attachment: DeskAttachment;
  fileLinks: Record<string, string>;
}) {
  const asset = attachment.asset ? (
    <span className={`ml-sm ${label}`}>
      Shared asset · v{attachment.asset.version}
    </span>
  ) : null;
  if (attachment.kind === "file") {
    const href = fileLinks[attachment.path];
    return (
      <li className="text-body-sm">
        {href ? (
          <a href={href} className="text-primary no-underline hover:text-primary-hover">
            {attachment.name}
          </a>
        ) : (
          <span className="text-secondary">{attachment.name}</span>
        )}
        <span className="ml-sm text-muted">{formatBytes(attachment.size)}</span>
        {asset}
      </li>
    );
  }
  const text = attachment.asset?.title ?? attachment.label;
  return (
    <li className="text-body-sm">
      {isPortalUrl(attachment.url) ? (
        <Link href={attachment.url} className="text-primary no-underline hover:text-primary-hover">
          {text}
        </Link>
      ) : (
        <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="text-primary no-underline hover:text-primary-hover">
          {text}
        </a>
      )}
      {asset}
    </li>
  );
}

function sameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}

/**
 * An item's messages, oldest first. Each shows who wrote it and when it
 * happened; one entered later (a logged email, a backfilled message) also
 * says when it was entered and by whom.
 */
export function MessageThread({
  messages,
  side,
  fileLinks,
}: {
  messages: DeskMessage[];
  side: DeskOpener;
  fileLinks: Record<string, string>;
}) {
  return (
    <ul className="divide-y divide-border">
      {messages.map((message) => {
        const ours = message.author === "admin";
        const who =
          message.author === "system"
            ? "The Desk"
            : message.author === "client" && side === "client"
              ? "You"
              : message.authorName || (ours ? "Rupert" : "Client");
        const entered =
          message.loggedBy || !sameDay(message.occurredAt, message.createdAt)
            ? `entered ${formatDate(message.createdAt)}${
                message.loggedBy ? ` by ${side === "admin" ? message.loggedBy : "Rupert"}` : ""
              }`
            : "";
        const eventText =
          message.event === "closed" ? "Closed the item" : message.event === "reopened" ? "Reopened the item" : "";
        return (
          <li key={message.id} className={`px-lg py-md ${ours ? "bg-primary-tint/40" : ""}`}>
            <p className={label}>
              <span className={ours ? "text-primary" : undefined}>{who}</span>
              {` · ${formatDateAtTime(message.occurredAt)}`}
              {entered ? ` · ${entered}` : ""}
            </p>
            {eventText ? <p className="mt-xs text-body-sm text-secondary">{eventText}{message.body ? ":" : "."}</p> : null}
            {message.body ? (
              <p className="mt-xs max-w-prose whitespace-pre-wrap text-body-sm text-heading">{message.body}</p>
            ) : null}
            {message.attachments.length > 0 ? (
              <ul className="mt-sm space-y-xs">
                {message.attachments.map((attachment, index) => (
                  <AttachmentLink key={index} attachment={attachment} fileLinks={fileLinks} />
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Every asset shared with the client: the latest version of each, always reopenable. */
export function AssetShelf({
  assets,
  fileLinks,
  itemHref,
  empty,
}: {
  assets: ShelfAsset[];
  fileLinks: Record<string, string>;
  itemHref: (itemId: string) => string;
  empty: string;
}) {
  if (assets.length === 0) return <p className="px-lg py-md text-body-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {assets.map((asset) => {
        const attachment = asset.attachment;
        const href = attachment.kind === "file" ? fileLinks[attachment.path] : attachment.url;
        const internal = attachment.kind === "link" && isPortalUrl(attachment.url);
        const open = "text-body-sm text-primary no-underline hover:text-primary-hover";
        return (
          <li key={`${asset.title}:${asset.version}`} className="flex flex-wrap items-center justify-between gap-md px-lg py-md">
            <span className="min-w-0">
              <span className="block truncate text-body-sm text-heading">{asset.title}</span>
              <span className={`mt-xs block ${label}`}>
                Version {asset.version} · shared {formatDate(asset.sharedAt)}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-md">
              <Link href={itemHref(asset.itemId)} className="text-body-sm text-muted no-underline hover:text-heading">
                On the Desk
              </Link>
              {href ? (
                internal ? (
                  <Link href={href} className={open}>
                    Open
                  </Link>
                ) : (
                  <a href={href} target="_blank" rel="noopener noreferrer" className={open}>
                    Open
                  </a>
                )
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
