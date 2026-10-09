import "server-only";
import { randomBytes } from "crypto";
import { isServiceRoleConfigured } from "@/lib/env";
import { PORTAL_URL } from "@/lib/portal-url";
import { createServiceClient } from "@/lib/supabase/admin";
import type { ClientAccess } from "@/lib/types";

export const SETUP_LINK_TTL_DAYS = 14;

const TABLE = "client_password_setups";
const DAY_MS = 24 * 60 * 60 * 1000;
// 32 random bytes encoded as base64url is always 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const TABLE_MISSING_MESSAGE =
  "The client_password_setups table is missing. Run portal/supabase/client_password_setups.sql in the Supabase SQL editor, then try again.";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type SetupLink = { url: string; expiresAt: string };

type DbError = { message: string; code?: string };

function describeError(error: DbError) {
  const missingTable =
    error.code === "42P01" ||
    error.message.includes(TABLE) ||
    error.message.toLowerCase().includes("schema cache");
  return missingTable ? TABLE_MISSING_MESSAGE : error.message;
}

export function setupUrl(token: string) {
  return `${PORTAL_URL}/auth/setup?token=${encodeURIComponent(token)}`;
}

// Creates a fresh link for the client, replacing any previous one. The old
// token stops working immediately because there is one row per client.
export async function issueSetupLink(
  supabase: ServiceClient,
  clientId: string,
): Promise<{ ok: true; link: SetupLink } | { ok: false; error: string }> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + SETUP_LINK_TTL_DAYS * DAY_MS).toISOString();

  const { error } = await supabase.from(TABLE).upsert(
    {
      client_id: clientId,
      token,
      expires_at: expiresAt,
      used_at: null,
      created_at: new Date(now).toISOString(),
    },
    { onConflict: "client_id" },
  );

  if (error) return { ok: false, error: describeError(error) };
  return { ok: true, link: { url: setupUrl(token), expiresAt } };
}

// Admin view of a client's login state. Clients created before setup links
// existed have no row and report as "legacy".
export async function getClientAccess(clientId: string): Promise<ClientAccess> {
  if (!isServiceRoleConfigured()) {
    return { status: "unavailable", error: "Service role key is not configured." };
  }

  const { data, error } = await createServiceClient()
    .from(TABLE)
    .select("token, expires_at, used_at")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) return { status: "unavailable", error: describeError(error) };
  if (!data) return { status: "legacy" };
  if (data.used_at) return { status: "set", usedAt: String(data.used_at) };

  const expiresAt = String(data.expires_at);
  if (Date.parse(expiresAt) <= Date.now()) {
    return { status: "expired", expiresAt };
  }

  return { status: "pending", url: setupUrl(String(data.token)), expiresAt };
}

// Resolves a token to its client when the link is unused and unexpired.
// `clientId: null` means the link is unknown, used or expired.
export async function findActiveSetup(
  supabase: ServiceClient,
  token: string,
): Promise<{ ok: true; clientId: string | null } | { ok: false; error: string }> {
  if (!TOKEN_PATTERN.test(token)) return { ok: true, clientId: null };

  const { data, error } = await supabase
    .from(TABLE)
    .select("client_id")
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) return { ok: false, error: describeError(error) };
  return { ok: true, clientId: data ? String(data.client_id) : null };
}

export async function markSetupUsed(
  supabase: ServiceClient,
  clientId: string,
  token: string,
) {
  const { error } = await supabase
    .from(TABLE)
    .update({ used_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("token", token)
    .is("used_at", null);

  return error ? describeError(error) : null;
}
