"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  ENGAGEMENT_STAGES,
  type AdminNotification,
  type EngagementStage,
} from "@/lib/types";

const RAISE_STAGES = new Set<string>(["Pre-seed", "Seed", "Series A"]);

export type CreateClientInput = {
  first_name: string;
  last_name: string;
  email: string;
  company_name: string;
  raise_amount: string;
  raise_stage: string;
  vertical: string;
  geography: string;
  fund_match_count: string;
  admin_notes: string;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

type AdminServiceAccess =
  | { ok: true; supabase: ReturnType<typeof createServiceClient> }
  | { ok: false; error: string };

async function requireAdminService(): Promise<AdminServiceAccess> {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false, error: "You do not have permission to do that." };
  }

  if (!isServiceRoleConfigured()) {
    return { ok: false, error: "Service role key is not configured." };
  }

  return { ok: true, supabase: createServiceClient() };
}

function blankToNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createClientRecord(
  input: CreateClientInput,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const firstName = input.first_name.trim();
  const lastName = input.last_name.trim();
  const email = input.email.trim().toLowerCase();
  const companyName = input.company_name.trim();

  if (!firstName || !lastName || !email || !companyName) {
    return { ok: false, error: "First name, last name, email, and company name are required." };
  }

  if (!email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const raiseStage = blankToNull(input.raise_stage);
  if (raiseStage && !RAISE_STAGES.has(raiseStage)) {
    return { ok: false, error: "Raise stage must be Pre-seed, Seed, or Series A." };
  }

  let fundMatchCount: number | null = null;
  const fundMatchRaw = blankToNull(input.fund_match_count);
  if (fundMatchRaw) {
    fundMatchCount = Number(fundMatchRaw);
    if (!Number.isFinite(fundMatchCount)) {
      return { ok: false, error: "Fund match count must be a number." };
    }
  }

  const { supabase } = access;
  const password = randomBytes(32).toString("base64url");

  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (createError || !created.user) {
    return {
      ok: false,
      error: createError?.message ?? "Unable to create the client account.",
    };
  }

  const userId = created.user.id;

  const { error: claimError } = await supabase.auth.admin.updateUserById(
    userId,
    { app_metadata: { role: "client" } },
  );

  if (claimError) {
    await supabase.auth.admin.deleteUser(userId);
    return { ok: false, error: claimError.message };
  }

  const { error: insertError } = await supabase.from("clients").insert({
    id: userId,
    first_name: firstName,
    last_name: lastName,
    email,
    company_name: companyName,
    raise_amount: blankToNull(input.raise_amount),
    raise_stage: raiseStage,
    vertical: blankToNull(input.vertical),
    geography: blankToNull(input.geography),
    fund_match_count: fundMatchCount,
    admin_notes: blankToNull(input.admin_notes),
    stage: "scope_of_work",
  });

  if (insertError) {
    await supabase.auth.admin.deleteUser(userId);
    return { ok: false, error: insertError.message };
  }

  return { ok: true };
}

const STAGE_VALUES = new Set<string>(
  ENGAGEMENT_STAGES.map((stage) => stage.value),
);

export async function updateClientStage(
  clientId: string,
  stage: EngagementStage,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  if (!STAGE_VALUES.has(stage)) {
    return { ok: false, error: "Invalid stage." };
  }

  const { error } = await access.supabase
    .from("clients")
    .update({ stage })
    .eq("id", clientId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function updateScopeOfWork(
  clientId: string,
  content: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { error } = await access.supabase
    .from("clients")
    .update({ scope_of_work_content: content })
    .eq("id", clientId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

function clientDisplayName(row: Record<string, unknown>) {
  const firstName = row.first_name != null ? String(row.first_name) : "";
  const lastName = row.last_name != null ? String(row.last_name) : "";
  return (
    [firstName, lastName].filter(Boolean).join(" ") ||
    (row.founder_name != null ? String(row.founder_name) : "") ||
    "Unknown"
  );
}

function asClientRow(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : null;
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

export async function listAdminNotifications(): Promise<AdminNotification[]> {
  const access = await requireAdminService();
  if (!access.ok) return [];

  const { data: nestedRows, error: nestedError } = await access.supabase
    .from("notifications")
    .select(
      "id, client_id, type, read, created_at, clients(first_name, last_name, founder_name, company_name)",
    )
    .order("created_at", { ascending: false });

  if (!nestedError && nestedRows) {
    return nestedRows.map((row) => {
      const client = asClientRow((row as { clients?: unknown }).clients);
      return {
        id: String(row.id),
        client_id: String(row.client_id ?? ""),
        type: String(row.type ?? ""),
        read: row.read === true,
        created_at: String(row.created_at ?? new Date().toISOString()),
        client_name: client ? clientDisplayName(client) : "Unknown",
        company_name:
          client?.company_name != null ? String(client.company_name) : "",
      };
    });
  }

  const { data: rows, error } = await access.supabase
    .from("notifications")
    .select("id, client_id, type, read, created_at")
    .order("created_at", { ascending: false });

  if (error || !rows) return [];

  const clientIds = Array.from(
    new Set(
      rows
        .map((row) => (row.client_id != null ? String(row.client_id) : ""))
        .filter(Boolean),
    ),
  );

  const clientsById = new Map<string, Record<string, unknown>>();
  if (clientIds.length > 0) {
    const { data: clients } = await access.supabase
      .from("clients")
      .select("id, first_name, last_name, founder_name, company_name")
      .in("id", clientIds);

    for (const client of clients ?? []) {
      const row = client as Record<string, unknown>;
      clientsById.set(String(row.id), row);
    }
  }

  return rows.map((row) => {
    const client = clientsById.get(String(row.client_id ?? ""));
    return {
      id: String(row.id),
      client_id: String(row.client_id ?? ""),
      type: String(row.type ?? ""),
      read: row.read === true,
      created_at: String(row.created_at ?? new Date().toISOString()),
      client_name: client ? clientDisplayName(client) : "Unknown",
      company_name:
        client?.company_name != null ? String(client.company_name) : "",
    };
  });
}

export async function countUnreadNotifications(): Promise<number> {
  const access = await requireAdminService();
  if (!access.ok) return 0;

  const { count, error } = await access.supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .or("read.eq.false,read.is.null");

  if (error) {
    const notifications = await listAdminNotifications();
    return notifications.filter((item) => !item.read).length;
  }

  return count ?? 0;
}

export async function markNotificationRead(
  notificationId: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { error } = await access.supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin", "layout");
  return { ok: true };
}
