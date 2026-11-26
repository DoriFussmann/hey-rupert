// The Desk: one record per client of everything they send Rupert and every
// answer he gives. An item asks something, gets answered, and is closed.
// Pure module (no server imports): the rules live here so they can be tested
// and shared by the client portal, the admin and the automatic hooks.

import { MATERIAL_EXTENSIONS, MATERIAL_MAX_BYTES, fileExtension, formatBytes } from "./setup.ts";

export const DESK_TYPES = ["question", "feedback", "materials", "request", "shared_asset", "update"] as const;
export type DeskType = (typeof DESK_TYPES)[number];

export const DESK_STEPS = ["general", "materials", "framing", "investor_list", "email_copy", "campaign"] as const;
export type DeskStep = (typeof DESK_STEPS)[number];

export const DESK_SOURCES = ["desk", "step", "materials", "email", "call", "message", "meeting"] as const;
export type DeskSource = (typeof DESK_SOURCES)[number];

/** Who an item is waiting on. */
export const DESK_STATUSES = ["waiting_us", "waiting_client", "closed"] as const;
export type DeskStatus = (typeof DESK_STATUSES)[number];

export type DeskAuthor = "client" | "admin" | "system";
export type DeskOpener = "client" | "admin";

/** How something said outside the portal reached Rupert. */
export const OUTSIDE_SOURCES = ["email", "call", "message", "meeting"] as const;
export type OutsideSource = (typeof OUTSIDE_SOURCES)[number];

/** A living document the client can reopen from the asset shelf. */
export type DeskAssetMark = { title: string; version: number };

export type DeskFile = {
  kind: "file";
  /** Path in the private materials bucket. Always under the client's folder. */
  path: string;
  name: string;
  size: number;
  type: string;
  asset?: DeskAssetMark;
};

export type DeskLink = {
  kind: "link";
  /** An https link, or a page of the client's portal ("/portal/…"). */
  url: string;
  label: string;
  asset?: DeskAssetMark;
};

export type DeskAttachment = DeskFile | DeskLink;

export type DeskMessage = {
  id: string;
  itemId: string;
  author: DeskAuthor;
  authorName: string;
  body: string;
  attachments: DeskAttachment[];
  event: "closed" | "reopened" | null;
  /** Rupert's login when he logged this for the client. */
  loggedBy: string | null;
  /** When it happened. */
  occurredAt: string;
  /** When it was entered. */
  createdAt: string;
};

export type DeskItem = {
  id: string;
  clientId: string;
  type: DeskType;
  step: DeskStep;
  source: DeskSource;
  sourceHref: string | null;
  openedBy: DeskOpener;
  status: DeskStatus;
  title: string;
  occurredAt: string;
  createdAt: string;
  lastMessageAt: string;
  closedAt: string | null;
};

export type DeskNote = {
  id: string;
  itemId: string;
  body: string;
  author: string | null;
  createdAt: string;
};

export const TITLE_MAX = 200;
export const BODY_MAX = 12000;
export const NOTE_MAX = 10000;
export const ATTACHMENTS_MAX = 10;
export const LINK_MAX = 2000;

// ---------------------------------------------------------------------------
// Labels

export const TYPE_LABEL: Record<DeskType, string> = {
  question: "Question",
  feedback: "Feedback",
  materials: "Materials",
  request: "Request",
  shared_asset: "Shared asset",
  update: "Update",
};

export const STEP_LABEL: Record<DeskStep, string> = {
  general: "General",
  materials: "Materials",
  framing: "Narrative",
  investor_list: "Investor List",
  email_copy: "Email Copy",
  campaign: "Campaign",
};

/** The step as it reads in a sentence: "about the investor list". */
const STEP_PHRASE: Record<DeskStep, string> = {
  general: "",
  materials: "your company materials",
  framing: "the outreach narrative",
  investor_list: "the investor list",
  email_copy: "the email copy",
  campaign: "your campaign",
};

/** Where the client goes to see or act on a step. */
export const STEP_HREF: Record<DeskStep, string | null> = {
  general: null,
  materials: "/portal/what-rupert-knows?open=files",
  framing: "/portal/setup/framing",
  investor_list: "/portal/setup/investor-list",
  email_copy: "/portal/setup/email-copy",
  campaign: "/portal/live-campaign",
};

/** The link back's wording on a step item: "Open the investor list". */
export const STEP_OPEN_LABEL: Record<DeskStep, string> = {
  general: "",
  materials: "Open your company files",
  framing: "Open the outreach narrative",
  investor_list: "Open the investor list",
  email_copy: "Open the email copy",
  campaign: "Open your campaign",
};

/** Status as the admin reads it. */
export const STATUS_LABEL_ADMIN: Record<DeskStatus, string> = {
  waiting_us: "Waiting on us",
  waiting_client: "Waiting on the client",
  closed: "Closed",
};

/** Status as the client reads it. */
export const STATUS_LABEL_CLIENT: Record<DeskStatus, string> = {
  waiting_us: "With Rupert",
  waiting_client: "Waiting on you",
  closed: "Closed",
};

const OUTSIDE_LABEL: Record<OutsideSource, string> = {
  email: "Email",
  call: "Call",
  message: "Message",
  meeting: "Meeting",
};

export function isDeskType(value: unknown): value is DeskType {
  return (DESK_TYPES as readonly unknown[]).includes(value);
}

export function isDeskStep(value: unknown): value is DeskStep {
  return (DESK_STEPS as readonly unknown[]).includes(value);
}

export function isDeskSource(value: unknown): value is DeskSource {
  return (DESK_SOURCES as readonly unknown[]).includes(value);
}

export function isDeskStatus(value: unknown): value is DeskStatus {
  return (DESK_STATUSES as readonly unknown[]).includes(value);
}

export function isOutsideSource(value: unknown): value is OutsideSource {
  return (OUTSIDE_SOURCES as readonly unknown[]).includes(value);
}

function shortDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

/** Where an item came from: "Investor List review", "Email, Nov 25", "The Desk". */
export function sourceLabel(item: Pick<DeskItem, "source" | "step" | "occurredAt">) {
  if (item.source === "desk") return "The Desk";
  if (item.source === "materials") return "Company materials";
  if (item.source === "step") {
    return item.step === "general" ? "Setup" : `${STEP_LABEL[item.step]} review`;
  }
  const day = shortDate(item.occurredAt);
  return day ? `${OUTSIDE_LABEL[item.source]}, ${day}` : OUTSIDE_LABEL[item.source];
}

// ---------------------------------------------------------------------------
// Whose turn it is

/**
 * The status an item starts with. What the client opens waits on us. Our
 * questions wait on the client. Updates and shared assets are a record: they
 * start closed and stay off the inbox until the client replies.
 */
export function openingStatus(type: DeskType, openedBy: DeskOpener): DeskStatus {
  if (openedBy === "client") return "waiting_us";
  if (type === "question") return "waiting_client";
  return "closed";
}

/**
 * The status after a reply. The client's reply always waits on us (and
 * reopens a closed item). Ours waits on the client unless we close with it;
 * a note added to a closed record leaves it closed.
 */
export function statusAfterReply(
  current: DeskStatus,
  author: DeskOpener,
  { close = false }: { close?: boolean } = {},
): { status: DeskStatus; event: "closed" | "reopened" | null } {
  if (author === "client") {
    return { status: "waiting_us", event: current === "closed" ? "reopened" : null };
  }
  if (close) return { status: "closed", event: current === "closed" ? null : "closed" };
  if (current === "closed") return { status: "closed", event: null };
  return { status: "waiting_client", event: null };
}

/** What a client can open from "Ask Rupert". */
export const ASK_TYPES = ["question", "request", "materials"] as const;
export type AskType = (typeof ASK_TYPES)[number];

export const ASK_LABEL: Record<AskType, string> = {
  question: "Ask a question",
  request: "Ask for something",
  materials: "Send files",
};

export function isAskType(value: unknown): value is AskType {
  return (ASK_TYPES as readonly unknown[]).includes(value);
}

/** What the admin can open on a client's Desk. */
export const ADMIN_OPEN_TYPES = ["question", "update", "shared_asset"] as const;
export type AdminOpenType = (typeof ADMIN_OPEN_TYPES)[number];

export function isAdminOpenType(value: unknown): value is AdminOpenType {
  return (ADMIN_OPEN_TYPES as readonly unknown[]).includes(value);
}

/** What the client said in an outside message Rupert logs. */
export const LOGGED_TYPES = ["question", "feedback", "request", "materials"] as const;
export type LoggedType = (typeof LOGGED_TYPES)[number];

export function isLoggedType(value: unknown): value is LoggedType {
  return (LOGGED_TYPES as readonly unknown[]).includes(value);
}

// ---------------------------------------------------------------------------
// Text

export function cleanText(value: unknown, max: number) {
  return (typeof value === "string" ? value : "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

/** A title from the first line of a message, when none was given. */
export function titleFrom(body: string, fallback: string, max = 90) {
  const first = body
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return fallback;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** Noon UTC on a yyyy-mm-dd day: the day reads the same in every US time zone. */
export function dayToIso(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The date of an outside message: not in the future, and a real day.
 * `now` is passed in so this stays pure.
 */
export function outsideDate(day: string, now: Date): { ok: true; iso: string } | { ok: false; error: string } {
  const iso = dayToIso(String(day ?? ""));
  if (!iso) return { ok: false, error: "Pick the date it was sent." };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 23, 59, 59));
  if (new Date(iso).getTime() > today.getTime()) return { ok: false, error: "That date is in the future." };
  return { ok: true, iso };
}

// ---------------------------------------------------------------------------
// Attachments

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** An https link, or a page of the client's own portal. Nothing else is stored. */
export function isDeskUrl(value: string) {
  if (/^\/portal(\/[A-Za-z0-9\-._~/?=&%#]*)?$/.test(value)) return !value.includes("..");
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isPortalUrl(value: string) {
  return value.startsWith("/portal");
}

/** Where Desk uploads live for a client, in the materials bucket. */
export function deskFolder(clientId: string) {
  return `${clientId}/desk/`;
}

/** A stored file may be any file of this client (a Desk upload or a company file). */
export function isClientFilePath(clientId: string, path: string) {
  return Boolean(clientId) && path.startsWith(`${clientId}/`) && !path.includes("..") && !path.includes("\\");
}

function asAssetMark(value: unknown): DeskAssetMark | undefined {
  if (!isRecord(value)) return undefined;
  const title = cleanText(value.title, TITLE_MAX);
  const version = Math.max(1, Math.round(Number(value.version) || 1));
  return title ? { title, version } : undefined;
}

/** Reads stored or submitted attachments, dropping anything malformed. */
export function asAttachments(value: unknown): DeskAttachment[] {
  if (!Array.isArray(value)) return [];
  const list: DeskAttachment[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const asset = asAssetMark(raw.asset);
    if (raw.kind === "file") {
      const path = typeof raw.path === "string" ? raw.path : "";
      if (!path || path.includes("..")) continue;
      list.push({
        kind: "file",
        path,
        name: cleanText(raw.name, 255) || "file",
        size: Math.max(0, Number(raw.size) || 0),
        type: cleanText(raw.type, 120),
        ...(asset ? { asset } : {}),
      });
    } else if (raw.kind === "link") {
      const url = typeof raw.url === "string" ? raw.url.trim().slice(0, LINK_MAX) : "";
      if (!isDeskUrl(url)) continue;
      list.push({
        kind: "link",
        url,
        label: cleanText(raw.label, TITLE_MAX) || url,
        ...(asset ? { asset } : {}),
      });
    }
    if (list.length >= ATTACHMENTS_MAX) break;
  }
  return list;
}

/** Submitted attachments, kept only when every file belongs to this client. */
export function ownAttachments(
  clientId: string,
  value: unknown,
): { ok: true; attachments: DeskAttachment[] } | { ok: false; error: string } {
  const attachments = asAttachments(value);
  for (const item of attachments) {
    if (item.kind === "file" && !isClientFilePath(clientId, item.path)) {
      return { ok: false, error: "That file does not belong to this client." };
    }
  }
  return { ok: true, attachments };
}

/** Why a file can't be attached on the Desk, or null when it can. The same rule as company files. */
export function deskFileProblem(file: { name: string; size: number }): string | null {
  const name = String(file.name ?? "").trim();
  const size = Number(file.size) || 0;
  if (!name) return "The file has no name.";
  if (!MATERIAL_EXTENSIONS.includes(fileExtension(name))) {
    return `${name}: this file type is not supported. Use PDF, PowerPoint, Keynote, Word, Excel, CSV, text or images.`;
  }
  if (size <= 0) return `${name} is empty.`;
  if (size > MATERIAL_MAX_BYTES) {
    return `${name} is ${formatBytes(size)}. The limit is ${formatBytes(MATERIAL_MAX_BYTES)} per file.`;
  }
  return null;
}

/** The uploaded files among attachments, without any asset mark: what a client can attach. */
export function plainFiles(attachments: DeskAttachment[]): DeskFile[] {
  return attachments
    .filter((item): item is DeskFile => item.kind === "file")
    .map(({ kind, path, name, size, type }) => ({ kind, path, name, size, type }));
}

// ---------------------------------------------------------------------------
// The asset shelf

export type ShelfAsset = {
  title: string;
  /** The latest version shared. */
  version: number;
  attachment: DeskAttachment;
  itemId: string;
  sharedAt: string;
  /** How many versions were shared in all. */
  versions: number;
};

const assetKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, " ");

/** Every asset shared with the client, latest version of each, newest first. */
export function assetShelf(messages: Pick<DeskMessage, "itemId" | "attachments" | "occurredAt">[]): ShelfAsset[] {
  const shelf = new Map<string, ShelfAsset>();
  for (const message of messages) {
    for (const attachment of message.attachments) {
      if (!attachment.asset) continue;
      const key = assetKey(attachment.asset.title);
      const current = shelf.get(key);
      const candidate: ShelfAsset = {
        title: attachment.asset.title,
        version: attachment.asset.version,
        attachment,
        itemId: message.itemId,
        sharedAt: message.occurredAt,
        versions: (current?.versions ?? 0) + 1,
      };
      const newer =
        !current ||
        candidate.version > current.version ||
        (candidate.version === current.version && candidate.sharedAt >= current.sharedAt);
      shelf.set(key, newer ? candidate : { ...current, versions: candidate.versions });
    }
  }
  return Array.from(shelf.values()).sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
}

/** The version a newly shared asset gets: one more than the last with that title. */
export function nextAssetVersion(shelf: ShelfAsset[], title: string) {
  const current = shelf.find((asset) => assetKey(asset.title) === assetKey(title));
  return current ? current.version + 1 : 1;
}

// ---------------------------------------------------------------------------
// Lists

export type DeskFilter = { step?: DeskStep | ""; type?: DeskType | ""; status?: DeskStatus | "" };

export function filterItems<T extends Pick<DeskItem, "step" | "type" | "status">>(items: T[], filter: DeskFilter) {
  return items.filter(
    (item) =>
      (!filter.step || item.step === filter.step) &&
      (!filter.type || item.type === filter.type) &&
      (!filter.status || item.status === filter.status),
  );
}

/**
 * The list as a side reads it: what waits on them first (oldest first, so
 * nothing sinks), then everything else, newest first.
 */
export function arrangeItems<T extends Pick<DeskItem, "status" | "lastMessageAt">>(
  items: T[],
  side: DeskOpener,
): { waiting: T[]; rest: T[] } {
  const mine: DeskStatus = side === "client" ? "waiting_client" : "waiting_us";
  const waiting = items
    .filter((item) => item.status === mine)
    .sort((a, b) => a.lastMessageAt.localeCompare(b.lastMessageAt));
  const rest = items
    .filter((item) => item.status !== mine)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  return { waiting, rest };
}

/** Whole days an item has been waiting. */
export function daysWaiting(since: string, now: Date) {
  const start = new Date(since).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((now.getTime() - start) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Paths and emails

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDeskId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export const DESK_PATH = "/portal/desk";

export function deskItemPath(itemId: string) {
  return `${DESK_PATH}/${itemId}`;
}

export function adminDeskPath(clientId: string, itemId?: string) {
  return itemId ? `/admin/clients/${clientId}/desk/${itemId}` : `/admin/clients/${clientId}/desk`;
}

const about = (step: DeskStep, preposition: string) => (STEP_PHRASE[step] ? ` ${preposition} ${STEP_PHRASE[step]}` : "");

/**
 * The subject of the short email a client gets when we post on their Desk:
 * "Rupert answered your question about the investor list".
 */
export function replyEmailSubject(
  item: Pick<DeskItem, "type" | "step" | "title" | "openedBy">,
  { opening = false, adminName = "Rupert" }: { opening?: boolean; adminName?: string } = {},
) {
  if (opening) {
    if (item.type === "question") return `${adminName} has a question for you${about(item.step, "about")}`;
    if (item.type === "shared_asset") return `${adminName} shared “${item.title}” with you`;
    return `An update from ${adminName}: ${item.title}`;
  }
  if (item.openedBy === "admin") return `${adminName} added to “${item.title}”`;
  if (item.type === "question") return `${adminName} answered your question${about(item.step, "about")}`;
  if (item.type === "feedback") return `${adminName} replied to your feedback${about(item.step, "on")}`;
  if (item.type === "materials") return `${adminName} replied about the files you sent`;
  return `${adminName} replied to your request${about(item.step, "about")}`;
}

/** The body of that email: short, with the link to the item. */
export function replyEmailBody({
  greeting,
  subject,
  link,
  signature,
}: {
  greeting: string;
  subject: string;
  link: string;
  signature: string;
}) {
  return [greeting, `${subject}.`, `Read it on your Desk: ${link}`, signature].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// What the existing flows write

/** The client's response on a review step, as it reads on the Desk. */
export function stepResponseBody({
  decision,
  version,
  note,
  itemNotes,
}: {
  decision: "confirmed" | "changes_requested";
  version: number;
  note: string;
  /** Readable label → note. */
  itemNotes: { label: string; note: string }[];
}) {
  const lead = decision === "confirmed" ? `Confirmed version ${version}.` : `Asked for changes to version ${version}.`;
  const notes = itemNotes.map((entry) => `${entry.label}: ${entry.note}`).join("\n");
  return [lead, note.trim(), notes].filter(Boolean).join("\n\n");
}

/** The title of the item a published version opens. */
export function publishTitle(step: DeskStep, version: number) {
  const name: Record<DeskStep, string> = {
    general: "An update",
    materials: "Your company materials",
    framing: "Your outreach narrative",
    investor_list: "Your investor list",
    email_copy: "Your outreach emails",
    campaign: "Your campaign",
  };
  const plural = step === "email_copy";
  if (version > 1) return `${name[step]} ${plural ? "are" : "is"} updated`;
  return `${name[step]} ${plural ? "are" : "is"} ready`;
}

/** Stable keys of the events the existing flows record, so none is recorded twice. */
export const deskRef = {
  published: (step: string, version: number) => `step:${step}:v${version}`,
  response: (step: string, version: number) => `step:${step}:v${version}:response`,
  question: (id: string) => `question:${id}`,
  answer: (id: string) => `question:${id}:answer`,
  materials: (version: number) => `materials:v${version}`,
};
