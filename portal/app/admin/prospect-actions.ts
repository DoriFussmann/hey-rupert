"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { isProspectStatus, type MatchEstimate, type ProspectBrief } from "@/lib/prospects/core";
import {
  buildBriefAndEstimate,
  deleteProspect as deleteProspectRow,
  draftFollowUp,
  recomputeEstimate,
  saveOutcome,
  scheduleCallEmails,
  sendFollowUp,
  updateProspect as updateProspectRow,
  type ProspectEdit,
} from "@/lib/prospects/server";
import { createServiceClient } from "@/lib/supabase/admin";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function access() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return { ok: false as const, error: "You do not have permission to do that." };
  if (!isServiceRoleConfigured()) return { ok: false as const, error: "Service role key is not configured." };
  return { ok: true as const, supabase: createServiceClient(), email: user.email ?? null };
}

const validId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
const page = (id: string) => `/admin/prospects/${id}`;

/** Researches again and recomputes the estimate. A prep email still waiting to go out is replaced with the new brief. */
export async function refreshProspectBrief(id: string): Promise<Result<object>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown prospect." };
  const built = await buildBriefAndEstimate(a.supabase, id, a.email);
  if (!built.ok) return built;
  await scheduleCallEmails(a.supabase, id, { resend: true });
  revalidatePath(page(id));
  return { ok: true };
}

/** The estimate with filters you chose. */
export async function updateProspectEstimate(id: string, fit: ProspectBrief["fit"]): Promise<Result<{ match: MatchEstimate }>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown prospect." };
  const result = await recomputeEstimate(a.supabase, id, fit);
  if (result.ok) revalidatePath(page(id));
  return result;
}

/** Sends the prep email again now, or reschedules it with the current brief. */
export async function resendProspectPrep(id: string): Promise<Result<{ scheduled: number; notes: string[] }>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown prospect." };
  const result = await scheduleCallEmails(a.supabase, id, { resend: true });
  revalidatePath(page(id));
  return result;
}

export async function saveProspectOutcome(id: string, status: string, notes: string): Promise<Result<object>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown prospect." };
  if (!isProspectStatus(status) || status === "converted") return { ok: false, error: "Choose an outcome." };
  const saved = await saveOutcome(a.supabase, id, status, notes, a.email);
  if (saved.ok) {
    revalidatePath(page(id));
    revalidatePath("/admin");
  }
  return saved;
}

export async function draftProspectFollowUp(id: string): Promise<Result<{ subject: string; body: string }>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown prospect." };
  return draftFollowUp(a.supabase, id, a.email);
}

export async function sendProspectFollowUp(id: string, subject: string, body: string): Promise<Result<object>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown prospect." };
  const sent = await sendFollowUp(a.supabase, id, String(subject ?? ""), String(body ?? ""));
  if (sent.ok) revalidatePath(page(id));
  return sent;
}

/** Edits a booked call from the admin list: the founder's details, status and the call time. */
export async function updateProspect(id: string, edit: ProspectEdit): Promise<Result<{ notes: string[] }>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown prospect." };
  if (edit.callId != null && !validId(edit.callId)) return { ok: false, error: "Unknown call." };
  const result = await updateProspectRow(a.supabase, id, {
    name: String(edit.name ?? ""),
    email: String(edit.email ?? ""),
    companyName: String(edit.companyName ?? ""),
    website: String(edit.website ?? ""),
    status: edit.status,
    callId: edit.callId ?? null,
    callStart: edit.callStart ? String(edit.callStart) : null,
  });
  if (result.ok) {
    revalidatePath(page(id));
    revalidatePath("/admin");
  }
  return result;
}

/** Deletes a booked call (the prospect and their calls) from the admin list. */
export async function deleteProspect(id: string): Promise<Result<object>> {
  const a = await access();
  if (!a.ok) return a;
  if (!validId(id)) return { ok: false, error: "Unknown prospect." };
  const result = await deleteProspectRow(a.supabase, id);
  if (result.ok) revalidatePath("/admin");
  return result;
}
