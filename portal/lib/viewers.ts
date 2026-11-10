import "server-only";
import { randomBytes } from "crypto";
import { isServiceRoleConfigured } from "@/lib/env";
import {
  SETUP_LINK_TTL_DAYS,
  findActiveSetup,
  setupUrl,
} from "@/lib/password-setup";
import { createServiceClient } from "@/lib/supabase/admin";

// Viewers: view-only logins on one client's portal, added by Rupert when a
// client asks for someone else to have access. A viewer has their own auth
// user (role "viewer") and a row here naming the client they can see.

const TABLE = "client_viewers";
const DAY_MS = 24 * 60 * 60 * 1000;
// 32 random bytes encoded as base64url is always 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COLUMNS =
  "id, client_id, first_name, last_name, email, setup_token, setup_expires_at, setup_used_at, welcome_sent_at, created_at";

const TABLE_MISSING_MESSAGE =
  "The client_viewers table is missing. Run portal/supabase/client_viewers.sql in the Supabase SQL editor, then try again.";

type ServiceClient = ReturnType<typeof createServiceClient>;
type DbError = { message: string; code?: string };

export type ViewerAccess =
  | { status: "pending"; url: string; expiresAt: string }
  | { status: "expired"; expiresAt: string }
  | { status: "set"; usedAt: string }
  | { status: "none" };

export type ClientViewer = {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
  access: ViewerAccess;
  welcomeSentAt: string | null;
  createdAt: string;
};

export function describeViewerError(error: DbError) {
  const missingTable =
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.message.toLowerCase().includes("schema cache");
  return missingTable ? TABLE_MISSING_MESSAGE : error.message;
}

function accessOf(row: Record<string, unknown>): ViewerAccess {
  if (row.setup_used_at) {
    return { status: "set", usedAt: String(row.setup_used_at) };
  }
  if (!row.setup_token || !row.setup_expires_at) return { status: "none" };
  const expiresAt = String(row.setup_expires_at);
  if (Date.parse(expiresAt) <= Date.now()) return { status: "expired", expiresAt };
  return { status: "pending", url: setupUrl(String(row.setup_token)), expiresAt };
}

function asViewer(row: Record<string, unknown>): ClientViewer {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    firstName: String(row.first_name ?? ""),
    lastName: String(row.last_name ?? ""),
    email: String(row.email ?? ""),
    access: accessOf(row),
    welcomeSentAt: row.welcome_sent_at != null ? String(row.welcome_sent_at) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export type ViewerListResult =
  | { ok: true; viewers: ClientViewer[] }
  | { ok: false; error: string };

/** A client's viewers, oldest first, for the admin client page. */
export async function listClientViewers(clientId: string): Promise<ViewerListResult> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, error: "Service role key is not configured." };
  }
  const { data, error } = await createServiceClient()
    .from(TABLE)
    .select(COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: describeViewerError(error) };
  return { ok: true, viewers: (data ?? []).map((row) => asViewer(row)) };
}

export async function getViewer(
  supabase: ServiceClient,
  viewerId: string,
): Promise<{ ok: true; viewer: ClientViewer | null } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq("id", viewerId)
    .maybeSingle();
  if (error) return { ok: false, error: describeViewerError(error) };
  return { ok: true, viewer: data ? asViewer(data) : null };
}

/** The signed-in viewer's row, or null. Never throws: the portal just shows nothing. */
export async function findViewerById(viewerId: string): Promise<ClientViewer | null> {
  if (!isServiceRoleConfigured()) return null;
  try {
    const found = await getViewer(createServiceClient(), viewerId);
    return found.ok ? found.viewer : null;
  } catch {
    return null;
  }
}

// Creates a fresh set-password link for the viewer, replacing any previous
// one. A password already set keeps working until they choose a new one.
export async function issueViewerSetupLink(
  supabase: ServiceClient,
  viewerId: string,
): Promise<{ ok: true; url: string; expiresAt: string } | { ok: false; error: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SETUP_LINK_TTL_DAYS * DAY_MS).toISOString();
  const { error } = await supabase
    .from(TABLE)
    .update({ setup_token: token, setup_expires_at: expiresAt, setup_used_at: null })
    .eq("id", viewerId);
  if (error) return { ok: false, error: describeViewerError(error) };
  return { ok: true, url: setupUrl(token), expiresAt };
}

// Resolves a token to its viewer when the link is unused and unexpired.
// `viewerId: null` means the link is unknown, used or expired (or the
// viewers table isn't there, which must never break client setup links).
export async function findActiveViewerSetup(
  supabase: ServiceClient,
  token: string,
): Promise<{ viewerId: string | null }> {
  if (!TOKEN_PATTERN.test(token)) return { viewerId: null };
  const { data, error } = await supabase
    .from(TABLE)
    .select("id")
    .eq("setup_token", token)
    .is("setup_used_at", null)
    .gt("setup_expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return { viewerId: null };
  return { viewerId: String(data.id) };
}

export async function markViewerSetupUsed(
  supabase: ServiceClient,
  viewerId: string,
  token: string,
) {
  await supabase
    .from(TABLE)
    .update({ setup_used_at: new Date().toISOString() })
    .eq("id", viewerId)
    .eq("setup_token", token)
    .is("setup_used_at", null);
}

export type SetupTarget = { kind: "client" | "viewer"; userId: string };

/**
 * Whose set-password link this is: a client's or a viewer's. `target: null`
 * means the link is unknown, used or expired.
 */
export async function resolveSetupToken(
  supabase: ServiceClient,
  token: string,
): Promise<{ ok: true; target: SetupTarget | null } | { ok: false; error: string }> {
  const lookup = await findActiveSetup(supabase, token);
  if (!lookup.ok) return lookup;
  if (lookup.clientId) {
    return { ok: true, target: { kind: "client", userId: lookup.clientId } };
  }
  const { viewerId } = await findActiveViewerSetup(supabase, token);
  return {
    ok: true,
    target: viewerId ? { kind: "viewer", userId: viewerId } : null,
  };
}
