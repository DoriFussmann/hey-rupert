import "server-only";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

const VIEW_AS_ERROR =
  "You are viewing this portal as the client. Actions are disabled.";

/**
 * Client actions run only for the client's own login. Admins previewing the
 * portal ("view as client") are refused here, whatever the UI shows.
 */
export async function requirePortalService() {
  const { user, role } = await getAuthContext();

  if (user && role === "admin") {
    return { ok: false as const, error: VIEW_AS_ERROR };
  }

  if (!user || role !== "client") {
    return {
      ok: false as const,
      error: "You do not have permission to do that.",
    };
  }

  if (!isServiceRoleConfigured()) {
    return {
      ok: false as const,
      error: "Service role key is not configured.",
    };
  }

  return {
    ok: true as const,
    user,
    supabase: createServiceClient(),
  };
}

export type PortalAccess = Extract<
  Awaited<ReturnType<typeof requirePortalService>>,
  { ok: true }
>;
