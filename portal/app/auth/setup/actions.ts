"use server";

import { revalidatePath } from "next/cache";
import { isServiceRoleConfigured, isSupabaseConfigured } from "@/lib/env";
import {
  SETUP_LINK_UNAVAILABLE_MESSAGE,
  validateNewPassword,
} from "@/lib/password-policy";
import { findActiveSetup, markSetupUsed } from "@/lib/password-setup";
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

  const lookup = await findActiveSetup(supabase, token);
  if (!lookup.ok) return { ok: false, error: GENERIC_ERROR };
  if (!lookup.clientId) {
    return {
      ok: false,
      error: SETUP_LINK_UNAVAILABLE_MESSAGE,
      unavailable: true,
    };
  }

  const clientId = lookup.clientId;
  const { data: userData, error: userError } =
    await supabase.auth.admin.getUserById(clientId);
  const user = userData?.user;

  if (userError || !user?.email || roleFromUser(user) !== "client") {
    return { ok: false, error: GENERIC_ERROR };
  }

  const { error: passwordError } = await supabase.auth.admin.updateUserById(
    clientId,
    { password, email_confirm: true },
  );
  // Supabase reports its own password-policy failures here; show them as-is.
  if (passwordError) return { ok: false, error: passwordError.message };

  // The password is already saved, so the client must not be blocked by a
  // bookkeeping failure: a link that fails to be marked used simply stays
  // valid until it expires or is replaced by a reset.
  await markSetupUsed(supabase, clientId, token);

  // Best effort: the admin notification must not block the client.
  await supabase
    .from("notifications")
    .insert({ client_id: clientId, type: "password_set" });

  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);

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

  return { ok: true, redirectTo: "/portal/onboarding" };
}
