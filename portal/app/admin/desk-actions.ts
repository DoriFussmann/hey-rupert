"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import {
  ATTACHMENTS_MAX,
  BODY_MAX,
  NOTE_MAX,
  STEP_HREF,
  TITLE_MAX,
  TYPE_LABEL,
  assetShelf,
  cleanText,
  deskFileProblem,
  deskFolder,
  deskItemPath,
  isAdminOpenType,
  isDeskId,
  isDeskStep,
  isLoggedType,
  isOutsideSource,
  nextAssetVersion,
  outsideDate,
  ownAttachments,
  replyEmailBody,
  replyEmailSubject,
  statusAfterReply,
  titleFrom,
  type DeskAttachment,
  type DeskItem,
} from "@/lib/desk";
import { deskAdminName } from "@/lib/desk-hooks";
import {
  addDeskNote,
  listDeskMessages,
  loadDeskItem,
  openDeskItem,
  postDeskMessage,
} from "@/lib/desk-server";
import type { EmailResult } from "@/lib/email";
import { sendClientEmail } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import { isServiceRoleConfigured } from "@/lib/env";
import { clientDisplayName } from "@/lib/format";
import { safeFileName } from "@/lib/materials-server";
import { clientAddress, greetingFor } from "@/lib/notify";
import { PORTAL_URL } from "@/lib/portal-url";
import { MATERIALS_BUCKET } from "@/lib/setup";
import { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type AdminDeskResult =
  | { ok: true; itemId: string; clientEmail: EmailResult | null }
  | { ok: false; error: string };

const DESK_EMAIL_KEY = "desk:reply";

async function requireAdmin(clientId: unknown) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  if (!isDeskId(clientId)) return { ok: false as const, error: "Unknown client." };
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client not found." };
  return {
    ok: true as const,
    supabase,
    clientId,
    client: data as Record<string, unknown>,
    email: user.email ?? null,
  };
}

function revalidateDesk(clientId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/portal", "layout");
}

/**
 * Attachments as they are stored: this client's files and safe links only.
 * One marked as a shared asset gets its version here (one more than the last
 * with that title), never from the browser.
 */
async function prepareAttachments(
  supabase: ServiceClient,
  clientId: string,
  value: unknown,
): Promise<{ ok: true; attachments: DeskAttachment[] } | { ok: false; error: string }> {
  const own = ownAttachments(clientId, value);
  if (!own.ok) return own;
  const attachments = own.attachments.slice(0, ATTACHMENTS_MAX);
  if (!attachments.some((item) => item.asset)) return { ok: true, attachments };

  const messages = await listDeskMessages(supabase, clientId);
  if (!messages.ok) return messages;
  const shelf = assetShelf(messages.value);
  const taken = new Map<string, number>();
  return {
    ok: true,
    attachments: attachments.map((item) => {
      if (!item.asset) return item;
      const title = cleanText(item.asset.title, TITLE_MAX);
      const key = title.toLowerCase();
      const version = (taken.get(key) ?? nextAssetVersion(shelf, title) - 1) + 1;
      taken.set(key, version);
      return { ...item, asset: { title, version } };
    }),
  };
}

/** The short email that tells the client there is something on their Desk, with the link to the item. */
async function emailClient(
  supabase: ServiceClient,
  client: Record<string, unknown>,
  item: Pick<DeskItem, "id" | "type" | "step" | "title" | "openedBy">,
  { opening, adminName }: { opening: boolean; adminName: string },
): Promise<EmailResult> {
  const to = clientAddress(client);
  if (!to) return { ok: false, reason: "This client has no email address." };
  const settings = await loadEmailSettings(supabase);
  const subject = replyEmailSubject(item, { opening, adminName });
  return sendClientEmail(supabase, {
    clientId: String(client.id),
    kind: "manual",
    templateKey: DESK_EMAIL_KEY,
    to: [to],
    subject,
    text: replyEmailBody({
      greeting: greetingFor(client),
      subject,
      link: `${PORTAL_URL}${deskItemPath(item.id)}`,
      signature: settings.signature,
    }),
  });
}

/** Step 1 of attaching a file to a client's Desk: a one-time signed upload URL in their Desk folder. */
export async function createAdminDeskUpload(
  clientId: string,
  file: { name: string; size: number },
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const access = await requireAdmin(clientId);
  if (!access.ok) return access;
  const name = String(file?.name ?? "").trim();
  const problem = deskFileProblem({ name, size: Number(file?.size) || 0 });
  if (problem) return { ok: false, error: problem };
  const path = `${deskFolder(access.clientId)}${randomUUID()}/${safeFileName(name)}`;
  const { data, error } = await access.supabase.storage.from(MATERIALS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: `Upload could not start: ${error?.message ?? "unknown error"}.` };
  return { ok: true, path: data.path, token: data.token };
}

/**
 * Rupert replies on an item: text, files, links or a shared asset. The item
 * then waits on the client, or closes with the reply. The client gets a short
 * email with a link to the item unless `emailClient` is off.
 */
export async function replyToDeskItem(input: {
  clientId: string;
  itemId: string;
  body: string;
  attachments?: unknown;
  close?: boolean;
  emailClient?: boolean;
}): Promise<AdminDeskResult> {
  const access = await requireAdmin(input?.clientId);
  if (!access.ok) return access;
  if (!isDeskId(input?.itemId)) return { ok: false, error: "Unknown item." };

  const body = cleanText(input?.body, BODY_MAX);
  const prepared = await prepareAttachments(access.supabase, access.clientId, input?.attachments);
  if (!prepared.ok) return prepared;
  if (!body && prepared.attachments.length === 0) return { ok: false, error: "Write the reply first." };

  const loaded = await loadDeskItem(access.supabase, access.clientId, input.itemId);
  if (!loaded.ok) return loaded;
  if (!loaded.value) return { ok: false, error: "That item is not on this client's Desk." };
  const { item } = loaded.value;

  const adminName = await deskAdminName(access.supabase);
  const next = statusAfterReply(item.status, "admin", { close: input.close === true });
  const posted = await postDeskMessage(access.supabase, {
    itemId: item.id,
    author: "admin",
    authorName: adminName,
    body,
    attachments: prepared.attachments,
    status: next.status,
    event: next.event,
  });
  if (!posted.ok) return posted;

  const clientEmail =
    input.emailClient === false ? null : await emailClient(access.supabase, access.client, item, { opening: false, adminName });
  revalidateDesk(access.clientId);
  return { ok: true, itemId: item.id, clientEmail };
}

/**
 * Rupert opens an item: a question for the client (it waits on them), an
 * update, or a shared asset (both a record: closed until the client replies).
 */
export async function openDeskItemForClient(input: {
  clientId: string;
  type: string;
  step: string;
  title: string;
  body: string;
  attachments?: unknown;
  emailClient?: boolean;
}): Promise<AdminDeskResult> {
  const access = await requireAdmin(input?.clientId);
  if (!access.ok) return access;
  if (!isAdminOpenType(input?.type)) return { ok: false, error: "Choose what you're posting." };
  const step = isDeskStep(input?.step) ? input.step : "general";
  const body = cleanText(input?.body, BODY_MAX);

  // A shared asset is the attachment itself: every attachment on it goes on the shelf, under the item's title.
  let submitted = input?.attachments;
  const givenTitle = cleanText(input?.title, TITLE_MAX);
  if (input.type === "shared_asset") {
    if (!givenTitle) return { ok: false, error: "Give the asset a title: it's how the client finds it on their shelf." };
    submitted = (Array.isArray(submitted) ? submitted : []).map((item) =>
      item && typeof item === "object" ? { ...item, asset: { title: givenTitle, version: 1 } } : item,
    );
  }
  const prepared = await prepareAttachments(access.supabase, access.clientId, submitted);
  if (!prepared.ok) return prepared;
  if (input.type === "shared_asset" && prepared.attachments.length === 0) {
    return { ok: false, error: "Attach the file or the link you're sharing." };
  }
  if (input.type !== "shared_asset" && !body) {
    return { ok: false, error: input.type === "question" ? "Write the question first." : "Write the update first." };
  }

  const adminName = await deskAdminName(access.supabase);
  const title = givenTitle || titleFrom(body, TYPE_LABEL[input.type]);
  const created = await openDeskItem(access.supabase, {
    clientId: access.clientId,
    type: input.type,
    step,
    source: "desk",
    sourceHref: STEP_HREF[step],
    openedBy: "admin",
    title,
    message: { author: "admin", authorName: adminName, body, attachments: prepared.attachments },
  });
  if (!created.ok) return created;

  const item = { id: created.value.id, type: input.type, step, title, openedBy: "admin" as const };
  const clientEmail =
    input.emailClient === false ? null : await emailClient(access.supabase, access.client, item, { opening: true, adminName });
  revalidateDesk(access.clientId);
  return { ok: true, itemId: created.value.id, clientEmail };
}

/**
 * Log an outside message: something the client sent by email or said on a
 * call. It joins the record under their name, with its real date and who
 * logged it. On its own it opens an item waiting on us; with `itemId` it is
 * added to that item. Emails nobody.
 */
export async function logOutsideMessage(input: {
  clientId: string;
  itemId?: string;
  type: string;
  step: string;
  source: string;
  on: string;
  title?: string;
  body: string;
  /** "client": what they sent. "admin": what we answered outside the portal. */
  from?: string;
  attachments?: unknown;
}): Promise<AdminDeskResult> {
  const access = await requireAdmin(input?.clientId);
  if (!access.ok) return access;
  if (!isOutsideSource(input?.source)) return { ok: false, error: "Pick how it was sent." };
  const when = outsideDate(String(input?.on ?? ""), new Date());
  if (!when.ok) return when;
  const body = cleanText(input?.body, BODY_MAX);
  if (!body) return { ok: false, error: "Paste the message, or write what was said." };
  const prepared = await prepareAttachments(access.supabase, access.clientId, input?.attachments);
  if (!prepared.ok) return prepared;

  const fromUs = input?.from === "admin";
  const author = fromUs ? ("admin" as const) : ("client" as const);
  const authorName = fromUs ? await deskAdminName(access.supabase) : clientDisplayName(access.client);

  if (input?.itemId) {
    if (!isDeskId(input.itemId)) return { ok: false, error: "Unknown item." };
    const loaded = await loadDeskItem(access.supabase, access.clientId, input.itemId);
    if (!loaded.ok) return loaded;
    if (!loaded.value) return { ok: false, error: "That item is not on this client's Desk." };
    const { item } = loaded.value;
    const next = statusAfterReply(item.status, author);
    const posted = await postDeskMessage(access.supabase, {
      itemId: item.id,
      author,
      authorName,
      body: `${sourceNote(input.source)}\n\n${body}`,
      attachments: prepared.attachments,
      loggedBy: access.email,
      occurredAt: when.iso,
      status: next.status,
      event: next.event,
    });
    if (!posted.ok) return posted;
    revalidateDesk(access.clientId);
    return { ok: true, itemId: item.id, clientEmail: null };
  }

  if (fromUs) return { ok: false, error: "Our own outside messages are logged on the item they answer." };
  if (!isLoggedType(input?.type)) return { ok: false, error: "Choose what kind of message it was." };
  const step = isDeskStep(input?.step) ? input.step : "general";
  const created = await openDeskItem(access.supabase, {
    clientId: access.clientId,
    type: input.type,
    step,
    source: input.source,
    sourceHref: STEP_HREF[step],
    openedBy: "client",
    title: cleanText(input?.title, TITLE_MAX) || titleFrom(body, TYPE_LABEL[input.type]),
    occurredAt: when.iso,
    message: { author, authorName, body, attachments: prepared.attachments, loggedBy: access.email },
  });
  if (!created.ok) return created;
  revalidateDesk(access.clientId);
  return { ok: true, itemId: created.value.id, clientEmail: null };
}

function sourceNote(source: "email" | "call" | "message" | "meeting") {
  const how = { email: "By email", call: "On a call", message: "By message", meeting: "In a meeting" }[source];
  return `[${how}, logged from outside the portal]`;
}

/** An internal note on an item. The client never sees it; it changes nothing about the item. */
export async function addInternalNote(input: {
  clientId: string;
  itemId: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireAdmin(input?.clientId);
  if (!access.ok) return access;
  if (!isDeskId(input?.itemId)) return { ok: false, error: "Unknown item." };
  const body = cleanText(input?.body, NOTE_MAX);
  if (!body) return { ok: false, error: "Write the note first." };
  const loaded = await loadDeskItem(access.supabase, access.clientId, input.itemId);
  if (!loaded.ok) return loaded;
  if (!loaded.value) return { ok: false, error: "That item is not on this client's Desk." };
  const saved = await addDeskNote(access.supabase, access.clientId, input.itemId, body, access.email);
  if (!saved.ok) return saved;
  revalidatePath(`/admin/clients/${access.clientId}`, "layout");
  return { ok: true };
}

/** Closes an item with an optional note (which the client sees), or reopens it as waiting on us. Emails nobody. */
export async function setDeskItemStatus(input: {
  clientId: string;
  itemId: string;
  action: "close" | "reopen";
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireAdmin(input?.clientId);
  if (!access.ok) return access;
  if (!isDeskId(input?.itemId)) return { ok: false, error: "Unknown item." };
  const loaded = await loadDeskItem(access.supabase, access.clientId, input.itemId);
  if (!loaded.ok) return loaded;
  if (!loaded.value) return { ok: false, error: "That item is not on this client's Desk." };
  const { item } = loaded.value;
  const closing = input.action === "close";
  if (closing === (item.status === "closed")) return { ok: true };

  const posted = await postDeskMessage(access.supabase, {
    itemId: item.id,
    author: "admin",
    authorName: await deskAdminName(access.supabase),
    body: cleanText(input?.note, BODY_MAX),
    status: closing ? "closed" : "waiting_us",
    event: closing ? "closed" : "reopened",
  });
  if (!posted.ok) return posted;
  revalidateDesk(access.clientId);
  return { ok: true };
}
