"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type ServiceOrderAgreement = {
  linkedin_url: string;
  booking_link: string;
  company_website: string;
  company_description: string;
};

async function requirePortalService() {
  const { user, role } = await getAuthContext();
  if (!user || (role !== "client" && role !== "admin")) {
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

function revalidateOnboarding() {
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/onboarding");
}

export async function confirmStatementOfWork(): Promise<ActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const confirmedAt = new Date().toISOString();
  const { user, supabase } = access;

  const { data: existing, error: loadError } = await supabase
    .from("clients")
    .select("id, sow_confirmed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (loadError) {
    return { ok: false, error: loadError.message };
  }

  if (!existing) {
    return { ok: false, error: "Client record not found." };
  }

  if (existing.sow_confirmed_at) {
    return { ok: true };
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ sow_confirmed_at: confirmedAt })
    .eq("id", user.id);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  const { error: insertError } = await supabase.from("notifications").insert({
    client_id: user.id,
    type: "sow_confirmed",
  });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  revalidateOnboarding();
  revalidatePath("/portal/statement-of-work");
  return { ok: true };
}

function requiredText(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false as const, error: `${label} is required.` };
  return { ok: true as const, value: trimmed };
}

export async function agreeToServiceOrder(
  input: ServiceOrderAgreement,
): Promise<ActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const linkedin = requiredText(input.linkedin_url, "LinkedIn URL");
  if (!linkedin.ok) return linkedin;
  const booking = requiredText(input.booking_link, "Booking link");
  if (!booking.ok) return booking;
  const website = requiredText(input.company_website, "Company website");
  if (!website.ok) return website;
  const description = requiredText(
    input.company_description,
    "Company description",
  );
  if (!description.ok) return description;

  const { user, supabase } = access;
  const agreedAt = new Date().toISOString();

  const { data: existing, error: loadError } = await supabase
    .from("clients")
    .select("id, stage, sow_confirmed_at, service_order_agreed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (loadError) {
    return { ok: false, error: loadError.message };
  }

  if (!existing) {
    return { ok: false, error: "Client record not found." };
  }

  if (
    !existing.sow_confirmed_at &&
    existing.stage !== "service_order" &&
    existing.stage !== "live"
  ) {
    return { ok: false, error: "The service order is not available yet." };
  }

  if (existing.service_order_agreed_at) {
    return { ok: true };
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({
      linkedin_url: linkedin.value,
      booking_link: booking.value,
      company_website: website.value,
      company_description: description.value,
      service_order_agreed_at: agreedAt,
    })
    .eq("id", user.id);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  const { error: insertError } = await supabase.from("notifications").insert({
    client_id: user.id,
    type: "service_order_agreed",
  });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  revalidateOnboarding();
  revalidatePath("/portal/service-order");
  return { ok: true };
}

export async function confirmNda(): Promise<ActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const signedAt = new Date().toISOString();
  const { user, supabase } = access;

  const { data: existing, error: loadError } = await supabase
    .from("clients")
    .select("id, sow_confirmed_at, service_order_agreed_at, nda_signed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (loadError) {
    return { ok: false, error: loadError.message };
  }

  if (!existing) {
    return { ok: false, error: "Client record not found." };
  }

  if (!existing.sow_confirmed_at || !existing.service_order_agreed_at) {
    return { ok: false, error: "The NDA is not available yet." };
  }

  if (existing.nda_signed_at) {
    return { ok: true };
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ nda_signed_at: signedAt })
    .eq("id", user.id);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  const { error: insertError } = await supabase.from("notifications").insert({
    client_id: user.id,
    type: "nda_signed",
  });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  revalidateOnboarding();
  revalidatePath("/portal/nda");
  return { ok: true };
}
