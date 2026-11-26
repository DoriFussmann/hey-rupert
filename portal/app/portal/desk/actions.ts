"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import {
  ASK_LABEL,
  ATTACHMENTS_MAX,
  BODY_MAX,
  STEP_HREF,
  STEP_LABEL,
  TITLE_MAX,
  TYPE_LABEL,
  adminDeskPath,
  cleanText,
  deskFileProblem,
  deskFolder,
  isAskType,
  isDeskId,
  isDeskStep,
  ownAttachments,
  plainFiles,
  statusAfterReply,
  titleFrom,
  type DeskAttachment,
} from "@/lib/desk";
import { loadDeskItem, openDeskItem, postDeskMessage } from "@/lib/desk-server";
import { clientDisplayName } from "@/lib/format";
import { attachMaterialFile, safeFileName } from "@/lib/materials-server";
import { notifyAdmin } from "@/lib/notify";
import { requirePortalService, type PortalAccess } from "@/lib/portal-access";
import { PORTAL_URL } from "@/lib/portal-url";
import { MATERIALS_BUCKET, formatBytes } from "@/lib/setup";

export type DeskActionResult = { ok: true; itemId: string } | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;
/** The most messages one client can post in a day. Past it, email is the better channel. */
const MESSAGES_PER_DAY = 60;

function revalidateDesk(clientId: string) {
  revalidatePath("/portal", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);
}

/** The signed-in client (never a viewer, never an admin viewing as them) and their name. */
async function openDesk() {
  const access = await requirePortalService();
  if (!access.ok) return access;
  const { data, error } = await access.supabase
    .from("clients")
    .select("id, first_name, last_name, founder_name, company_name, email, archived_at")
    .eq("id", access.user.id)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client record not found." };
  return { ok: true as const, access, name: clientDisplayName(data as Record<string, unknown>) };
}

async function underDailyLimit({ supabase, user }: PortalAccess) {
  const { count, error } = await supabase
    .from("desk_messages")
    .select("id", { count: "exact", head: true })
    .eq("client_id", user.id)
    .eq("author", "client")
    .gt("created_at", new Date(Date.now() - DAY_MS).toISOString());
  // Unreadable: the write below reports the real problem.
  return error ? true : (count ?? 0) < MESSAGES_PER_DAY;
}

const LIMIT_ERROR = "That's a lot for one day. Use Book a call, or email Rupert with the rest.";

function attachmentLines(attachments: DeskAttachment[]) {
  return attachments
    .map((item) => (item.kind === "file" ? `- ${item.name} (${formatBytes(item.size)})` : `- ${item.label}: ${item.url}`))
    .join("\n");
}

/**
 * Step 1 of attaching a file: checks it and returns a one-time signed URL
 * the browser uploads to directly, in the client's own Desk folder.
 */
export async function createDeskUpload(file: {
  name: string;
  size: number;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const opened = await openDesk();
  if (!opened.ok) return opened;
  const name = String(file?.name ?? "").trim();
  const problem = deskFileProblem({ name, size: Number(file?.size) || 0 });
  if (problem) return { ok: false, error: problem };

  const path = `${deskFolder(opened.access.user.id)}${randomUUID()}/${safeFileName(name)}`;
  const { data, error } = await opened.access.supabase.storage.from(MATERIALS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return { ok: false, error: `Upload could not start: ${error?.message ?? "unknown error"}. If this keeps happening, use Book a call.` };
  }
  return { ok: true, path: data.path, token: data.token };
}

/**
 * Ask Rupert: one form for a question, a request or files, about a step or
 * General. Opens an item waiting on Rupert, who is notified.
 */
export async function askRupert(input: {
  type: string;
  step: string;
  title?: string;
  body: string;
  attachments?: unknown;
}): Promise<DeskActionResult> {
  const opened = await openDesk();
  if (!opened.ok) return opened;
  const { access, name } = opened;
  const clientId = access.user.id;

  if (!isAskType(input?.type)) return { ok: false, error: "Choose what you're sending." };
  const step = isDeskStep(input?.step) ? input.step : "general";
  const body = cleanText(input?.body, BODY_MAX);
  const files = ownAttachments(clientId, input?.attachments);
  if (!files.ok) return files;
  // A client attaches files; links go in the message itself.
  const attachments = plainFiles(files.attachments).slice(0, ATTACHMENTS_MAX);

  if (input.type === "materials" && attachments.length === 0) {
    return { ok: false, error: "Add the files you want to send first." };
  }
  if (input.type !== "materials" && !body) {
    return { ok: false, error: input.type === "question" ? "Write your question first." : "Tell Rupert what you need first." };
  }
  if (!(await underDailyLimit(access))) return { ok: false, error: LIMIT_ERROR };

  const fallback = input.type === "materials" ? (attachments.length === 1 ? attachments[0].name : `${attachments.length} files`) : TYPE_LABEL[input.type];
  const title = cleanText(input?.title, TITLE_MAX) || titleFrom(body, fallback);

  const created = await openDeskItem(access.supabase, {
    clientId,
    type: input.type,
    step,
    source: "desk",
    sourceHref: STEP_HREF[step],
    openedBy: "client",
    title,
    message: { author: "client", authorName: name, body, attachments },
  });
  if (!created.ok) return created;
  const itemId = created.value.id;

  // Files sent as materials also join the company materials, so the analysis
  // reads them like any other file. Best effort: they are on the Desk either way.
  if (input.type === "materials") {
    for (const file of attachments) {
      const attached = await attachMaterialFile(access.supabase, clientId, file);
      if (!attached.ok) console.error(`Desk file not added to the company materials: ${attached.error}`);
    }
  }

  await notifyAdmin(access.supabase, clientId, "desk_item", {
    email: true,
    link: `${PORTAL_URL}${adminDeskPath(clientId, itemId)}`,
    details: [
      `${ASK_LABEL[input.type]} · ${STEP_LABEL[step]}`,
      title,
      body,
      attachments.length > 0 ? `Files:\n${attachmentLines(attachments)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  revalidateDesk(clientId);
  return { ok: true, itemId };
}

/** The client replies on an item. It waits on Rupert again; a closed item reopens. */
export async function replyOnDesk(input: {
  itemId: string;
  body: string;
  attachments?: unknown;
}): Promise<DeskActionResult> {
  const opened = await openDesk();
  if (!opened.ok) return opened;
  const { access, name } = opened;
  const clientId = access.user.id;
  if (!isDeskId(input?.itemId)) return { ok: false, error: "That item is not on your Desk." };

  const body = cleanText(input?.body, BODY_MAX);
  const files = ownAttachments(clientId, input?.attachments);
  if (!files.ok) return files;
  const attachments = plainFiles(files.attachments).slice(0, ATTACHMENTS_MAX);
  if (!body && attachments.length === 0) return { ok: false, error: "Write your reply first." };

  const loaded = await loadDeskItem(access.supabase, clientId, input.itemId);
  if (!loaded.ok) return loaded;
  if (!loaded.value) return { ok: false, error: "That item is not on your Desk." };
  if (!(await underDailyLimit(access))) return { ok: false, error: LIMIT_ERROR };

  const { item } = loaded.value;
  const next = statusAfterReply(item.status, "client");
  const posted = await postDeskMessage(access.supabase, {
    itemId: item.id,
    author: "client",
    authorName: name,
    body,
    attachments,
    status: next.status,
    event: next.event,
  });
  if (!posted.ok) return posted;

  await notifyAdmin(access.supabase, clientId, "desk_reply", {
    email: true,
    link: `${PORTAL_URL}${adminDeskPath(clientId, item.id)}`,
    details: [
      `On: ${item.title}${next.event === "reopened" ? " (reopened)" : ""}`,
      body,
      attachments.length > 0 ? `Files:\n${attachmentLines(attachments)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  revalidateDesk(clientId);
  return { ok: true, itemId: item.id };
}

/** The client closes an item, with an optional note. Rupert is told in the app, not by email. */
export async function closeDeskItem(input: { itemId: string; note?: string }): Promise<DeskActionResult> {
  const opened = await openDesk();
  if (!opened.ok) return opened;
  const { access, name } = opened;
  const clientId = access.user.id;
  if (!isDeskId(input?.itemId)) return { ok: false, error: "That item is not on your Desk." };

  const loaded = await loadDeskItem(access.supabase, clientId, input.itemId);
  if (!loaded.ok) return loaded;
  if (!loaded.value) return { ok: false, error: "That item is not on your Desk." };
  const { item } = loaded.value;
  if (item.status === "closed") return { ok: true, itemId: item.id };

  const posted = await postDeskMessage(access.supabase, {
    itemId: item.id,
    author: "client",
    authorName: name,
    body: cleanText(input?.note, BODY_MAX),
    status: "closed",
    event: "closed",
  });
  if (!posted.ok) return posted;

  await notifyAdmin(access.supabase, clientId, "desk_closed", {
    email: false,
    link: `${PORTAL_URL}${adminDeskPath(clientId, item.id)}`,
  });

  revalidateDesk(clientId);
  return { ok: true, itemId: item.id };
}
