import type { User } from "@supabase/supabase-js";

export type AppRole = "admin" | "client";

type JwtClaims = {
  role?: unknown;
  app_metadata?: { role?: unknown };
  user_metadata?: { role?: unknown };
};

function decodeJwtClaims(accessToken: string): JwtClaims | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export function roleFromValue(value: unknown): AppRole | null {
  return value === "admin" || value === "client" ? value : null;
}

/** Reads `role` from JWT claims (`auth.jwt() ->> 'role'`). */
export function getRole(accessToken: string | null | undefined): AppRole | null {
  if (!accessToken) return null;

  const claims = decodeJwtClaims(accessToken);
  if (!claims) return null;

  return (
    roleFromValue(claims.role) ??
    roleFromValue(claims.app_metadata?.role) ??
    roleFromValue(claims.user_metadata?.role)
  );
}

export function roleFromUser(user: User | null): AppRole | null {
  if (!user) return null;

  return (
    roleFromValue(user.app_metadata?.role) ??
    roleFromValue(user.user_metadata?.role)
  );
}

export function homePathForRole(role: AppRole | null) {
  if (role === "admin") return "/admin";
  if (role === "client") return "/portal";
  return "/login";
}

export function isAdmin(role: AppRole | null) {
  return role === "admin";
}

export function isClient(role: AppRole | null) {
  return role === "client";
}
