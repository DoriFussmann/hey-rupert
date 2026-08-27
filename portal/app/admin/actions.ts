"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { roleFromUser } from "@/lib/roles";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  ENGAGEMENT_STAGES,
  type AdminNotification,
  type EngagementStage,
  type FormTemplate,
} from "@/lib/types";
import {
  LIVE_ITEMS,
  SETUP_ITEMS,
  isChecklistStatus,
  type ChecklistStatus,
  type ChecklistStatusColumn,
  type OnboardingTimestampColumn,
} from "@/lib/checklists";
import { STATEMENT_OF_WORK_SLUG } from "@/lib/form-fields";
import { DEFAULT_STATEMENT_OF_WORK } from "@/lib/statement-of-work";

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

export type ActionResult =
  | { ok: true; linked?: boolean }
  | { ok: false; error: string };

type ServiceClient = ReturnType<typeof createServiceClient>;

type AdminServiceAccess =
  | { ok: true; supabase: ServiceClient }
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

async function findClientIdByEmail(supabase: ServiceClient, email: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .ilike("email", email.replace(/([%_\\])/g, "\\$1"))
    .maybeSingle();

  if (error) return { id: null as string | null, error: error.message };
  return { id: data?.id != null ? String(data.id) : null, error: null };
}

function userHasEmail(user: User, email: string) {
  if (user.email?.trim().toLowerCase() === email) return true;

  return (user.identities ?? []).some((identity) => {
    const identityEmail = identity.identity_data?.email;
    return (
      typeof identityEmail === "string" &&
      identityEmail.trim().toLowerCase() === email
    );
  });
}

async function findAuthUserByEmail(supabase: ServiceClient, email: string) {
  const perPage = 1000;
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return { user: null as User | null, error: error.message };
    }

    const match = data.users.find((user) => userHasEmail(user, email));
    if (match) return { user: match, error: null };
    if (data.users.length < perPage) return { user: null, error: null };
  }

  return {
    user: null as User | null,
    error: "Unable to look up the existing user by email.",
  };
}

async function ensureClientRole(
  supabase: ServiceClient,
  user: User,
): Promise<ActionResult> {
  if (roleFromUser(user) === "admin") {
    return {
      ok: false,
      error:
        "This email belongs to an admin account and cannot be added as a client.",
    };
  }

  if (roleFromUser(user) === "client") {
    return { ok: true };
  }

  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, role: "client" },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
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

  const existingByEmail = await findClientIdByEmail(supabase, email);
  if (existingByEmail.error) {
    return { ok: false, error: existingByEmail.error };
  }
  if (existingByEmail.id) {
    return {
      ok: false,
      error: "A client with this email is already on the client list.",
    };
  }

  const existingAuth = await findAuthUserByEmail(supabase, email);
  if (existingAuth.error) {
    return { ok: false, error: existingAuth.error };
  }

  let userId: string;
  let createdNewUser = false;

  if (existingAuth.user) {
    const { data: existingById, error: existingByIdError } = await supabase
      .from("clients")
      .select("id")
      .eq("id", existingAuth.user.id)
      .maybeSingle();

    if (existingByIdError) {
      return { ok: false, error: existingByIdError.message };
    }
    if (existingById) {
      return {
        ok: false,
        error: "A client with this email is already on the client list.",
      };
    }

    const roleResult = await ensureClientRole(supabase, existingAuth.user);
    if (!roleResult.ok) return roleResult;

    userId = existingAuth.user.id;
  } else {
    const password = randomBytes(32).toString("base64url");
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (createError || !created.user) {
      const alreadyRegistered = (createError?.message ?? "")
        .toLowerCase()
        .includes("already been registered");

      if (!alreadyRegistered) {
        return {
          ok: false,
          error: createError?.message ?? "Unable to create the client account.",
        };
      }

      const retry = await findAuthUserByEmail(supabase, email);
      if (!retry.user) {
        return {
          ok: false,
          error: createError?.message ?? "Unable to create the client account.",
        };
      }

      const roleResult = await ensureClientRole(supabase, retry.user);
      if (!roleResult.ok) return roleResult;
      userId = retry.user.id;
    } else {
      userId = created.user.id;
      createdNewUser = true;

      const { error: claimError } = await supabase.auth.admin.updateUserById(
        userId,
        { app_metadata: { role: "client" } },
      );

      if (claimError) {
        await supabase.auth.admin.deleteUser(userId);
        return { ok: false, error: claimError.message };
      }
    }
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
    stage: "sow",
  });

  if (insertError) {
    if (createdNewUser) {
      await supabase.auth.admin.deleteUser(userId);
    }
    return { ok: false, error: insertError.message };
  }

  revalidatePath("/admin");
  return { ok: true, linked: !createdNewUser };
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

  revalidateClientPaths(clientId);
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/setup");
  revalidatePath("/portal/live-campaign");
  return { ok: true };
}

function archivedAtColumnError(message: string, code?: string) {
  return (
    code === "42703" ||
    message.includes("archived_at") ||
    message.toLowerCase().includes("schema cache")
  );
}

function revalidateClientPaths(clientId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/clients/${clientId}`);
}

const CHECKLIST_COLUMNS = new Set<string>([
  ...SETUP_ITEMS.map((item) => item.column),
  ...LIVE_ITEMS.map((item) => item.column),
]);

const ONBOARDING_TIMESTAMP_COLUMNS = new Set<string>([
  "nda_signed_at",
  "intake_completed_at",
  "payment_received_at",
]);

function revalidateProgressPaths(clientId: string) {
  revalidateClientPaths(clientId);
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/onboarding");
  revalidatePath("/portal/setup");
  revalidatePath("/portal/live-campaign");
}

export async function updateChecklistStatus(
  clientId: string,
  column: ChecklistStatusColumn,
  status: ChecklistStatus,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  if (!CHECKLIST_COLUMNS.has(column) || !isChecklistStatus(status)) {
    return { ok: false, error: "Invalid checklist update." };
  }

  const { error } = await access.supabase
    .from("clients")
    .update({ [column]: status })
    .eq("id", clientId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidateProgressPaths(clientId);
  return { ok: true };
}

export async function updateOnboardingTimestamp(
  clientId: string,
  column: OnboardingTimestampColumn,
  done: boolean,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  if (!ONBOARDING_TIMESTAMP_COLUMNS.has(column)) {
    return { ok: false, error: "Invalid onboarding update." };
  }

  const { error } = await access.supabase
    .from("clients")
    .update({ [column]: done ? new Date().toISOString() : null })
    .eq("id", clientId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidateProgressPaths(clientId);
  return { ok: true };
}

export async function archiveClient(
  clientId: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { error } = await access.supabase
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", clientId);

  if (error) {
    if (archivedAtColumnError(error.message, error.code)) {
      return {
        ok: false,
        error:
          "The archived_at column is missing. Run portal/supabase/clients_archive.sql in the Supabase SQL editor, then try again.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidateClientPaths(clientId);
  return { ok: true };
}

export async function unarchiveClient(
  clientId: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { error } = await access.supabase
    .from("clients")
    .update({ archived_at: null })
    .eq("id", clientId);

  if (error) {
    if (archivedAtColumnError(error.message, error.code)) {
      return {
        ok: false,
        error:
          "The archived_at column is missing. Run portal/supabase/clients_archive.sql in the Supabase SQL editor, then try again.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidateClientPaths(clientId);
  return { ok: true };
}

export async function deleteClient(
  clientId: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { supabase } = access;

  await supabase.from("notifications").delete().eq("client_id", clientId);

  const { error } = await supabase.from("clients").delete().eq("id", clientId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await supabase.auth.admin.deleteUser(clientId);

  revalidatePath("/admin");
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
    .update({ statement_of_work_content: content })
    .eq("id", clientId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

function clientDisplayName(row: Record<string, unknown>) {
  const firstName = row.first_name != null ? String(row.first_name).trim() : "";
  const lastName = row.last_name != null ? String(row.last_name).trim() : "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  if (fullName) return fullName;

  const founder =
    row.founder_name != null ? String(row.founder_name).trim() : "";
  if (founder) return founder;

  const company =
    row.company_name != null ? String(row.company_name).trim() : "";
  if (company) return company;

  const email = row.email != null ? String(row.email).trim() : "";
  if (email) return email;

  return "Unknown";
}

export async function listAdminNotifications(): Promise<AdminNotification[]> {
  const access = await requireAdminService();
  if (!access.ok) return [];

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
      .select("id, first_name, last_name, founder_name, company_name, email")
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

export async function getFormTemplate(
  slug: string = STATEMENT_OF_WORK_SLUG,
): Promise<FormTemplate> {
  const empty: FormTemplate = {
    slug,
    title: "Statement of Work",
    content: DEFAULT_STATEMENT_OF_WORK,
    updated_at: null,
  };

  const access = await requireAdminService();
  if (!access.ok) return empty;

  const { data, error } = await access.supabase
    .from("form_templates")
    .select("slug, title, content, updated_at")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return empty;

  const content = String(data.content ?? "").trim();
  const staleMergeTemplate = content.includes("{{");

  return {
    slug: String(data.slug ?? slug),
    title: String(data.title ?? "Statement of Work"),
    content:
      content && !staleMergeTemplate ? content : DEFAULT_STATEMENT_OF_WORK,
    updated_at: data.updated_at != null ? String(data.updated_at) : null,
  };
}

export async function saveFormTemplate(
  slug: string,
  content: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { error } = await access.supabase.from("form_templates").upsert({
    slug,
    title: "Statement of Work",
    content,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    if (error.message.includes("form_templates") || error.code === "42P01") {
      return {
        ok: false,
        error:
          "The form_templates table is missing. Run portal/supabase/form_templates.sql in the Supabase SQL editor, then save again.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/forms/statement-of-work");
  return { ok: true };
}

export async function generateStatementOfWork(
  clientId: string,
): Promise<ActionResult & { content?: string }> {
  const access = await requireAdminService();
  if (!access.ok) return access;
  void clientId;

  const template = await getFormTemplate(STATEMENT_OF_WORK_SLUG);
  const content = template.content.trim() || DEFAULT_STATEMENT_OF_WORK;

  return { ok: true, content };
}

export async function sendStatementOfWork(
  clientId: string,
  content: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  if (!content.trim()) {
    return { ok: false, error: "Generate the Statement of Work before sending." };
  }

  const { data: activeSends, error: activeError } = await access.supabase
    .from("statement_of_work_sends")
    .select("id")
    .eq("client_id", clientId)
    .is("archived_at", null)
    .limit(1);

  if (activeError) {
    if (sowSendsTableError(activeError.message, activeError.code)) {
      return {
        ok: false,
        error:
          "The statement_of_work_sends table is missing. Run portal/supabase/sow_sends.sql in the Supabase SQL editor, then try again.",
      };
    }
    return { ok: false, error: activeError.message };
  }

  if (activeSends && activeSends.length > 0) {
    return {
      ok: false,
      error:
        "A Statement of Work has already been sent. Archive that record to send again.",
    };
  }

  const sentAt = new Date().toISOString();
  const { error: insertError } = await access.supabase
    .from("statement_of_work_sends")
    .insert({
      client_id: clientId,
      content,
      sent_at: sentAt,
    });

  if (insertError) {
    if (sowSendsTableError(insertError.message, insertError.code)) {
      return {
        ok: false,
        error:
          "The statement_of_work_sends table is missing. Run portal/supabase/sow_sends.sql in the Supabase SQL editor, then try again.",
      };
    }
    if (
      insertError.code === "23505" ||
      insertError.message.toLowerCase().includes("duplicate")
    ) {
      return {
        ok: false,
        error:
          "A Statement of Work has already been sent. Archive that record to send again.",
      };
    }
    return { ok: false, error: insertError.message };
  }

  const { error } = await access.supabase
    .from("clients")
    .update({
      statement_of_work_content: content,
      sow_confirmed_at: null,
    })
    .eq("id", clientId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/portal/statement-of-work");
  return { ok: true };
}

function sowSendsTableError(message: string, code?: string) {
  return (
    code === "42P01" ||
    message.includes("statement_of_work_sends") ||
    message.toLowerCase().includes("schema cache")
  );
}

export async function archiveSowSend(
  clientId: string,
  sendId: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { error } = await access.supabase
    .from("statement_of_work_sends")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", sendId)
    .eq("client_id", clientId);

  if (error) {
    if (sowSendsTableError(error.message, error.code)) {
      return {
        ok: false,
        error:
          "The statement_of_work_sends table is missing. Run portal/supabase/sow_sends.sql in the Supabase SQL editor, then try again.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

export async function unarchiveSowSend(
  clientId: string,
  sendId: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { data: activeSends, error: activeError } = await access.supabase
    .from("statement_of_work_sends")
    .select("id")
    .eq("client_id", clientId)
    .is("archived_at", null)
    .neq("id", sendId)
    .limit(1);

  if (activeError) {
    if (sowSendsTableError(activeError.message, activeError.code)) {
      return {
        ok: false,
        error:
          "The statement_of_work_sends table is missing. Run portal/supabase/sow_sends.sql in the Supabase SQL editor, then try again.",
      };
    }
    return { ok: false, error: activeError.message };
  }

  if (activeSends && activeSends.length > 0) {
    return {
      ok: false,
      error: "Archive the current send before restoring another record.",
    };
  }

  const { error } = await access.supabase
    .from("statement_of_work_sends")
    .update({ archived_at: null })
    .eq("id", sendId)
    .eq("client_id", clientId);

  if (error) {
    if (sowSendsTableError(error.message, error.code)) {
      return {
        ok: false,
        error:
          "The statement_of_work_sends table is missing. Run portal/supabase/sow_sends.sql in the Supabase SQL editor, then try again.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}
