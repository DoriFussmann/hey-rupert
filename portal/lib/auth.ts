import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  getRole,
  homePathForRole,
  isAdmin,
  isClient,
  roleFromUser,
  type AppRole,
} from "@/lib/roles";

export type { AppRole };
export { getRole, homePathForRole, isAdmin, isClient, roleFromUser };

export type AuthContext = {
  user: User | null;
  role: AppRole | null;
};

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  return Buffer.from(padded, "base64").toString("utf8");
}

function accessTokenFromCookies() {
  const chunks = cookies()
    .getAll()
    .filter(
      (cookie) =>
        cookie.name.includes("auth-token") &&
        !cookie.name.includes("code-verifier"),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  if (chunks.length === 0) return null;

  const raw = chunks.map((cookie) => cookie.value).join("");
  const json = raw.startsWith("base64-")
    ? fromBase64Url(raw.slice("base64-".length))
    : raw;

  try {
    const parsed = JSON.parse(json) as
      | { access_token?: string }
      | [string, ...unknown[]];
    if (Array.isArray(parsed)) return parsed[0] ?? null;
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
}

export async function getAuthContext(): Promise<AuthContext> {
  if (!isSupabaseConfigured()) {
    return { user: null, role: null };
  }

  const supabase = createClient();
  const cookieToken = accessTokenFromCookies();
  const {
    data: { user },
  } = cookieToken
    ? await supabase.auth.getUser(cookieToken)
    : await supabase.auth.getUser();

  if (!user) {
    return { user: null, role: null };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const role =
    getRole(session?.access_token) ??
    getRole(cookieToken) ??
    roleFromUser(user);

  return { user, role };
}

export async function requireAdmin() {
  const context = await getAuthContext();

  if (!context.user || context.role !== "admin") {
    redirect("/login");
  }

  return context;
}

export async function requirePortalUser() {
  const context = await getAuthContext();

  if (!context.user || (context.role !== "client" && context.role !== "admin")) {
    redirect("/login");
  }

  return context;
}
