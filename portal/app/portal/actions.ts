"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { advanceToKickoff } from "@/lib/kickoff";
import { notifyAdmin } from "@/lib/notify";
import {
  isKickoffReady,
  mergeServiceOrder,
  validateServiceOrderFields,
  type FieldErrors,
  type ServiceOrderFields,
} from "@/lib/service-order";
import { createServiceClient } from "@/lib/supabase/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type SignServiceOrderInput = ServiceOrderFields & { consent: boolean };

export type SignServiceOrderResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

const VIEW_AS_ERROR =
  "You are viewing this portal as the client. Actions are disabled.";

// Client actions run only for the client's own login. Admins previewing the
// portal ("view as client") are refused here, whatever the UI shows.
async function requirePortalService() {
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

function revalidateOnboarding(clientId: string) {
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/onboarding");
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);
}

export async function confirmStatementOfWork(): Promise<ActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const { user, supabase } = access;

  const { data: existing, error: loadError } = await supabase
    .from("clients")
    .select("id, sow_confirmed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!existing) return { ok: false, error: "Client record not found." };
  if (existing.sow_confirmed_at) return { ok: true };

  const { error: updateError } = await supabase
    .from("clients")
    .update({ sow_confirmed_at: new Date().toISOString() })
    .eq("id", user.id);

  if (updateError) return { ok: false, error: updateError.message };

  await notifyAdmin(supabase, user.id, "sow_confirmed", { email: true });

  revalidateOnboarding(user.id);
  revalidatePath("/portal/statement-of-work");
  return { ok: true };
}

function requestOrigin() {
  const list = headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || list.get("x-real-ip") || null,
    userAgent: list.get("user-agent")?.slice(0, 500) || null,
  };
}

export async function signServiceOrder(
  input: SignServiceOrderInput,
): Promise<SignServiceOrderResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const validated = validateServiceOrderFields(input);
  if (!validated.ok) {
    return {
      ok: false,
      error: "Please complete the highlighted fields.",
      fieldErrors: validated.errors,
    };
  }

  if (input.consent !== true) {
    return {
      ok: false,
      error: "Please confirm you agree to sign electronically.",
    };
  }

  const { user, supabase } = access;

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, sow_confirmed_at, service_order_agreed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client record not found." };
  if (!client.sow_confirmed_at) {
    return {
      ok: false,
      error: "Confirm the Statement of Work before signing the Service Order.",
    };
  }
  if (client.service_order_agreed_at) return { ok: true };

  const { data: send, error: sendError } = await supabase
    .from("service_order_sends")
    .select("id, content, signed_at")
    .eq("client_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (sendError) return { ok: false, error: sendError.message };
  if (!send || !String(send.content ?? "").trim()) {
    return { ok: false, error: "The Service Order has not been issued yet." };
  }
  if (send.signed_at) return { ok: true };

  const fields = validated.value;
  const signedAt = new Date().toISOString();
  const { ip, userAgent } = requestOrigin();

  // The signed copy is rebuilt here from the stored content, never taken
  // from the browser, so it is exactly the text that was issued.
  const { data: signedRows, error: signError } = await supabase
    .from("service_order_sends")
    .update({
      signed_at: signedAt,
      signer_company: fields.company_name,
      signer_name: fields.signer_name,
      signer_email: fields.signer_email,
      signer_title: fields.signer_title,
      signed_content: mergeServiceOrder(String(send.content), fields),
      signed_ip: ip,
      signed_user_agent: userAgent,
    })
    .eq("id", send.id)
    .is("signed_at", null)
    .select("id");

  if (signError) return { ok: false, error: signError.message };
  if (!signedRows || signedRows.length === 0) return { ok: true };

  const { error: clientUpdateError } = await supabase
    .from("clients")
    .update({ service_order_agreed_at: signedAt })
    .eq("id", user.id);

  if (clientUpdateError) {
    return { ok: false, error: clientUpdateError.message };
  }

  await notifyAdmin(supabase, user.id, "service_order_agreed", {
    email: true,
  });
  await advanceToKickoff(supabase, user.id, { email: true });

  revalidateOnboarding(user.id);
  revalidatePath("/portal/service-order");
  return { ok: true };
}

export async function confirmNda(): Promise<ActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const { user, supabase } = access;

  const { data: existing, error: loadError } = await supabase
    .from("clients")
    .select("id, service_order_agreed_at, payment_received_at, nda_signed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!existing) return { ok: false, error: "Client record not found." };
  if (!isKickoffReady(existing)) {
    return { ok: false, error: "The NDA is not available yet." };
  }
  if (existing.nda_signed_at) return { ok: true };

  const { error: updateError } = await supabase
    .from("clients")
    .update({ nda_signed_at: new Date().toISOString() })
    .eq("id", user.id);

  if (updateError) return { ok: false, error: updateError.message };

  await notifyAdmin(supabase, user.id, "nda_signed", { email: true });

  revalidateOnboarding(user.id);
  revalidatePath("/portal/nda");
  return { ok: true };
}
