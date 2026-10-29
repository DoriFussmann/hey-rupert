"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { draftNudge, sendNudge } from "@/lib/nudge-server";
import { settleReadyNudge } from "@/lib/reminders";
import { createServiceClient } from "@/lib/supabase/admin";
import type { EmailResult } from "@/lib/email";
import type { ClientEmailDraft } from "@/lib/setup";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function requireAdmin() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false as const, error: "Service role key is not configured." };
  }
  return { ok: true as const, supabase: createServiceClient() };
}

/** Drafts a nudge for one step waiting on the client. Nothing is sent or saved. */
export async function draftClientNudge(
  clientId: string,
  turnKey: string,
): Promise<Result<{ email: ClientEmailDraft; pausedNote: string | null }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  return draftNudge(access.supabase, String(clientId), String(turnKey));
}

/** Sends the nudge as written and records it. */
export async function sendClientNudge(
  clientId: string,
  turnKey: string,
  email: ClientEmailDraft,
): Promise<Result<{ sent: EmailResult; warning: string | null }>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const result = await sendNudge(access.supabase, String(clientId), String(turnKey), email);
  if (result.ok) {
    revalidatePath("/admin/nudge");
    revalidatePath(`/admin/clients/${clientId}`);
  }
  return result;
}

/** Sends (or skips) the reminder ready for a client under Notify & Nudge → Ready to send. */
export async function settleReadyNudgeAction(clientId: string, decision: "send" | "skip"): Promise<Result<object>> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const settled = await settleReadyNudge(access.supabase, String(clientId), decision === "skip" ? "skip" : "send");
  if (!settled.ok) return settled;
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/nudge");
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}
