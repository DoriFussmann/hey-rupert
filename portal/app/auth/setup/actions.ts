"use server";

import { revalidatePath } from "next/cache";
import { isServiceRoleConfigured, isSupabaseConfigured } from "@/lib/env";
import {
  SETUP_LINK_UNAVAILABLE_MESSAGE,
  validateNewPassword,
} from "@/lib/password-policy";
import { notifyAdmin } from "@/lib/notify";
import { markSetupUsed } from "@/lib/password-setup";
import { getViewer, markViewerSetupUsed, resolveSetupToken } from "@/lib/viewers";
import { roleFromUser } from "@/lib/roles";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type CompleteSetupResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string; unavailable?: boolean };

const GENERIC_ERROR =
  "Something went wrong. Please try again, or contact Dori if it keeps happening.";

export async function completePasswordSetup(
  token: string,
  password: string,
  confirm: string,
): Promise<CompleteSetupResult> {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const invalid = validateNewPassword(password, confirm);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createServiceClient();

  const lookup = await resolveSetupToken(supabase, token);
  if (!lookup.ok) return { ok: false, error: GENERIC_ERROR };
  if (!lookup.target) {
    return {
      ok: false,
      error: SETUP_LINK_UNAVAILABLE_MESSAGE,
      unavailable: true,
    };
  }

  const { kind, userId } = lookup.target;
  const { data: userData, error: userError } =
    await supabase.auth.admin.getUserById(userId);
  const user = userData?.user;

  // A client link only ever sets a client's password, a viewer link a viewer's.
  if (userError || !user?.email || roleFromUser(user) !== kind) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const { error: passwordError } = await supabase.auth.admin.updateUserById(
    userId,
    { password, email_confirm: true },
  );
  // Supabase reports its own password-policy failures here; show them as-is.
  if (passwordError) return { ok: false, error: passwordError.message };

  if (kind === "viewer") {
    const found = await getViewer(supabase, userId);
    await markViewerSetupUsed(supabase, userId, token);
    if (found.ok && found.viewer) {
      revalidatePath(`/admin/clients/${found.viewer.clientId}`);
    }
  } else {
    // The password is already saved, so the client must not be blocked by a
    // bookkeeping failure: a link that fails to be marked used simply stays
    // valid until it expires or is replaced by a reset.
    await markSetupUsed(supabase, userId, token);

    // Best effort: the admin notification must not block the client.
    await notifyAdmin(supabase, userId, "password_set", { email: true });

    revalidatePath("/admin", "layout");
    revalidatePath(`/admin/clients/${userId}`);
  }

  const session = createClient();
  const { error: signInError } = await session.auth.signInWithPassword({
    email: user.email,
    password,
  });

  if (signInError) {
    return {
      ok: true,
      redirectTo: `/login?email=${encodeURIComponent(user.email)}`,
    };
  }

  return { ok: true, redirectTo: "/portal" };
}
