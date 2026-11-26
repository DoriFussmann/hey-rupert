import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  asAttachments,
  isDeskSource,
  isDeskStatus,
  isDeskStep,
  isDeskType,
  openingStatus,
  type DeskAttachment,
  type DeskAuthor,
  type DeskItem,
  type DeskMessage,
  type DeskNote,
  type DeskOpener,
  type DeskSource,
  type DeskStatus,
  type DeskStep,
  type DeskType,
} from "@/lib/desk";
import { MATERIALS_BUCKET } from "@/lib/setup";

// The Desk's reads and writes. Everything goes through the service role, after
// the caller has checked who is asking and for which client; the database's
// own rules (portal/supabase/desk.sql) are the second line of defence.

type ServiceClient = ReturnType<typeof createServiceClient>;
export type DeskResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const DESK_MIGRATION_MISSING =
  "The Desk is not set up in the database yet. Run portal/supabase/desk.sql in Supabase.";

/** True when the Desk's tables or functions are not in the database yet. */
export function isDeskMissing(message: string, code?: string) {
  return (
    code === "42P01" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST205" ||
    (/desk_items|desk_messages|desk_notes|desk_open_item|desk_post_message/.test(message) &&
      /does not exist|schema cache|could not find/i.test(message))
  );
}

function deskError(message: string, code?: string) {
  return isDeskMissing(message, code) ? DESK_MIGRATION_MISSING : message;
}

const ITEM_COLUMNS =
  "id, client_id, type, step, source, source_href, opened_by, status, title, occurred_at, created_at, last_message_at, closed_at";
const MESSAGE_COLUMNS =
  "id, item_id, author, author_name, body, attachments, event, logged_by, occurred_at, created_at";

const text = (value: unknown) => (value != null ? String(value) : "");

function asItem(row: Record<string, unknown>): DeskItem {
  return {
    id: text(row.id),
    clientId: text(row.client_id),
    type: isDeskType(row.type) ? row.type : "update",
    step: isDeskStep(row.step) ? row.step : "general",
    source: isDeskSource(row.source) ? row.source : "desk",
    sourceHref: row.source_href != null ? text(row.source_href) : null,
    openedBy: row.opened_by === "admin" ? "admin" : "client",
    status: isDeskStatus(row.status) ? row.status : "closed",
    title: text(row.title),
    occurredAt: text(row.occurred_at),
    createdAt: text(row.created_at),
    lastMessageAt: text(row.last_message_at),
    closedAt: row.closed_at != null ? text(row.closed_at) : null,
  };
}

function asMessage(row: Record<string, unknown>): DeskMessage {
  return {
    id: text(row.id),
    itemId: text(row.item_id),
    author: row.author === "admin" || row.author === "system" ? row.author : "client",
    authorName: text(row.author_name),
    body: text(row.body),
    attachments: asAttachments(row.attachments),
    event: row.event === "closed" || row.event === "reopened" ? row.event : null,
    loggedBy: row.logged_by != null ? text(row.logged_by) : null,
    occurredAt: text(row.occurred_at),
    createdAt: text(row.created_at),
  };
}

function asNote(row: Record<string, unknown>): DeskNote {
  return {
    id: text(row.id),
    itemId: text(row.item_id),
    body: text(row.body),
    author: row.author != null ? text(row.author) : null,
    createdAt: text(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Reading

/** Every item on a client's Desk, most recently active first. */
export async function listDeskItems(supabase: ServiceClient, clientId: string): Promise<DeskResult<DeskItem[]>> {
  const { data, error } = await supabase
    .from("desk_items")
    .select(ITEM_COLUMNS)
    .eq("client_id", clientId)
    .order("last_message_at", { ascending: false })
    .limit(1000);
  if (error) return { ok: false, error: deskError(error.message, error.code) };
  return { ok: true, value: (data ?? []).map((row) => asItem(row as Record<string, unknown>)) };
}

/** Every message on a client's Desk, oldest first (for the asset shelf and previews). */
export async function listDeskMessages(supabase: ServiceClient, clientId: string): Promise<DeskResult<DeskMessage[]>> {
  const { data, error } = await supabase
    .from("desk_messages")
    .select(MESSAGE_COLUMNS)
    .eq("client_id", clientId)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) return { ok: false, error: deskError(error.message, error.code) };
  return { ok: true, value: (data ?? []).map((row) => asMessage(row as Record<string, unknown>)) };
}

/** One item with its messages, oldest first. `null` when it is not this client's. */
export async function loadDeskItem(
  supabase: ServiceClient,
  clientId: string,
  itemId: string,
): Promise<DeskResult<{ item: DeskItem; messages: DeskMessage[] } | null>> {
  const { data, error } = await supabase
    .from("desk_items")
    .select(ITEM_COLUMNS)
    .eq("id", itemId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return { ok: false, error: deskError(error.message, error.code) };
  if (!data) return { ok: true, value: null };

  const messages = await supabase
    .from("desk_messages")
    .select(MESSAGE_COLUMNS)
    .eq("item_id", itemId)
    .eq("client_id", clientId)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (messages.error) return { ok: false, error: deskError(messages.error.message, messages.error.code) };
  return {
    ok: true,
    value: {
      item: asItem(data as Record<string, unknown>),
      messages: (messages.data ?? []).map((row) => asMessage(row as Record<string, unknown>)),
    },
  };
}

/** Rupert's internal notes on an item. Only ever loaded for the admin. */
export async function loadDeskNotes(supabase: ServiceClient, clientId: string, itemId: string): Promise<DeskResult<DeskNote[]>> {
  const { data, error } = await supabase
    .from("desk_notes")
    .select("id, item_id, body, author, created_at")
    .eq("item_id", itemId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: deskError(error.message, error.code) };
  return { ok: true, value: (data ?? []).map((row) => asNote(row as Record<string, unknown>)) };
}

/** How many items wait on the client. 0 when the Desk can't be read: the nav never breaks. */
export async function countWaitingOnClient(supabase: ServiceClient, clientId: string) {
  try {
    const { count, error } = await supabase
      .from("desk_items")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "waiting_client");
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

/** How many items wait on us, across clients. 0 when the Desk can't be read. */
export async function countWaitingOnUs(supabase: ServiceClient) {
  try {
    const { count, error } = await supabase
      .from("desk_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "waiting_us");
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

export type InboxItem = DeskItem & { company: string; person: string };

/** The cross-client inbox: every open item waiting on us, oldest first. */
export async function listWaitingOnUs(supabase: ServiceClient): Promise<DeskResult<InboxItem[]>> {
  const { data, error } = await supabase
    .from("desk_items")
    .select(ITEM_COLUMNS)
    .eq("status", "waiting_us")
    .order("last_message_at", { ascending: true })
    .limit(500);
  if (error) return { ok: false, error: deskError(error.message, error.code) };
  const items = (data ?? []).map((row) => asItem(row as Record<string, unknown>));
  if (items.length === 0) return { ok: true, value: [] };

  const ids = Array.from(new Set(items.map((item) => item.clientId)));
  const clients = await supabase
    .from("clients")
    .select("*")
    .in("id", ids);
  if (clients.error) return { ok: false, error: clients.error.message };
  const byId = new Map((clients.data ?? []).map((row) => [String(row.id), row as Record<string, unknown>]));
  return {
    ok: true,
    value: items.map((item) => {
      const row = byId.get(item.clientId) ?? {};
      return {
        ...item,
        company: text(row.company_name),
        person: [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ") || text(row.founder_name),
      };
    }),
  };
}

/** The item an event already opened, if any. */
export async function findItemByRef(supabase: ServiceClient, clientId: string, sourceRef: string): Promise<DeskItem | null> {
  const { data, error } = await supabase
    .from("desk_items")
    .select(ITEM_COLUMNS)
    .eq("client_id", clientId)
    .eq("source_ref", sourceRef)
    .maybeSingle();
  return error || !data ? null : asItem(data as Record<string, unknown>);
}

/** Whether an event is already on the client's Desk, as an item or as a message on one. */
export async function isRecorded(supabase: ServiceClient, clientId: string, sourceRef: string) {
  const [item, message] = await Promise.all([
    supabase.from("desk_items").select("id").eq("client_id", clientId).eq("source_ref", sourceRef).limit(1),
    supabase.from("desk_messages").select("id, item_id").eq("client_id", clientId).eq("source_ref", sourceRef).limit(1),
  ]);
  const itemId = item.data?.[0]?.id ?? message.data?.[0]?.item_id;
  return itemId ? String(itemId) : null;
}

/**
 * The item a step's back-and-forth continues on: the most recent open one
 * from that flow, or (with `anyStatus`) the most recent one at all.
 */
export async function findFlowItem(
  supabase: ServiceClient,
  clientId: string,
  step: DeskStep,
  source: DeskSource,
  { anyStatus = false, openedBy }: { anyStatus?: boolean; openedBy?: DeskOpener } = {},
): Promise<DeskItem | null> {
  let query = supabase
    .from("desk_items")
    .select(ITEM_COLUMNS)
    .eq("client_id", clientId)
    .eq("step", step)
    .eq("source", source);
  if (!anyStatus) query = query.neq("status", "closed");
  if (openedBy) query = query.eq("opened_by", openedBy);
  const { data, error } = await query.order("last_message_at", { ascending: false }).limit(1);
  const row = data?.[0];
  return error || !row ? null : asItem(row as Record<string, unknown>);
}

/** Signed download links (1 hour) for the files attached to these messages, by path. */
export async function signDeskFiles(
  supabase: ServiceClient,
  clientId: string,
  attachments: DeskAttachment[],
): Promise<Record<string, string>> {
  const links: Record<string, string> = {};
  const files = attachments.filter(
    (item): item is Extract<DeskAttachment, { kind: "file" }> =>
      // Never sign a path outside this client's folder, whatever is stored.
      item.kind === "file" && item.path.startsWith(`${clientId}/`) && !item.path.includes(".."),
  );
  await Promise.all(
    files.map(async (file) => {
      if (links[file.path]) return;
      const { data } = await supabase.storage
        .from(MATERIALS_BUCKET)
        .createSignedUrl(file.path, 60 * 60, { download: file.name });
      if (data?.signedUrl) links[file.path] = data.signedUrl;
    }),
  );
  return links;
}

// ---------------------------------------------------------------------------
// Writing

export type OpenItemInput = {
  clientId: string;
  type: DeskType;
  step?: DeskStep;
  source?: DeskSource;
  sourceHref?: string | null;
  /** Stable key of the event, so it is never recorded twice. */
  sourceRef?: string | null;
  openedBy: DeskOpener;
  /** Defaults to the opening status for the type and opener. */
  status?: DeskStatus;
  title: string;
  /** When it happened, when that is not now (a logged email, a backfill). */
  occurredAt?: string | null;
  message: {
    author: DeskAuthor;
    authorName: string;
    body: string;
    attachments?: DeskAttachment[];
    loggedBy?: string | null;
  };
};

/** Opens an item with its first message, in one step. */
export async function openDeskItem(
  supabase: ServiceClient,
  input: OpenItemInput,
): Promise<DeskResult<{ id: string; created: boolean }>> {
  const { data, error } = await supabase.rpc("desk_open_item", {
    p_client_id: input.clientId,
    p_type: input.type,
    p_step: input.step ?? "general",
    p_source: input.source ?? "desk",
    p_source_href: input.sourceHref ?? null,
    p_source_ref: input.sourceRef ?? null,
    p_opened_by: input.openedBy,
    p_status: input.status ?? openingStatus(input.type, input.openedBy),
    p_title: input.title.trim().slice(0, 200) || "Untitled",
    p_occurred_at: input.occurredAt ?? null,
    p_author: input.message.author,
    p_author_name: input.message.authorName.slice(0, 200),
    p_body: input.message.body,
    p_attachments: input.message.attachments ?? [],
    p_logged_by: input.message.loggedBy ?? null,
  });
  if (error) return { ok: false, error: deskError(error.message, error.code) };
  const row = (data ?? {}) as { id?: string; created?: boolean };
  if (!row.id) return { ok: false, error: "The item could not be opened." };
  return { ok: true, value: { id: row.id, created: row.created === true } };
}

export type PostMessageInput = {
  itemId: string;
  author: DeskAuthor;
  authorName: string;
  body: string;
  attachments?: DeskAttachment[];
  event?: "closed" | "reopened" | null;
  loggedBy?: string | null;
  occurredAt?: string | null;
  /** The item's status after this message. Left out: unchanged. */
  status?: DeskStatus | null;
  sourceRef?: string | null;
};

/** Adds a message to an item and sets the item's status, in one step. */
export async function postDeskMessage(
  supabase: ServiceClient,
  input: PostMessageInput,
): Promise<DeskResult<{ id: string; created: boolean; status: DeskStatus }>> {
  const { data, error } = await supabase.rpc("desk_post_message", {
    p_item_id: input.itemId,
    p_author: input.author,
    p_author_name: input.authorName.slice(0, 200),
    p_body: input.body,
    p_attachments: input.attachments ?? [],
    p_event: input.event ?? null,
    p_logged_by: input.loggedBy ?? null,
    p_occurred_at: input.occurredAt ?? null,
    p_status: input.status ?? null,
    p_source_ref: input.sourceRef ?? null,
  });
  if (error) return { ok: false, error: deskError(error.message, error.code) };
  const row = (data ?? {}) as { id?: string; created?: boolean; status?: string };
  if (!row.id || !isDeskStatus(row.status)) return { ok: false, error: "The message could not be saved." };
  return { ok: true, value: { id: row.id, created: row.created === true, status: row.status } };
}

/** Adds an internal note to an item. The client never sees it. */
export async function addDeskNote(
  supabase: ServiceClient,
  clientId: string,
  itemId: string,
  body: string,
  author: string | null,
): Promise<DeskResult<null>> {
  const { error } = await supabase
    .from("desk_notes")
    .insert({ item_id: itemId, client_id: clientId, body, author });
  if (error) return { ok: false, error: deskError(error.message, error.code) };
  return { ok: true, value: null };
}
