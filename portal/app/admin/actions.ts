"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { roleFromUser } from "@/lib/roles";
import { issueSetupLink } from "@/lib/password-setup";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  ENGAGEMENT_STAGES,
  type AdminNotification,
  type EngagementStage,
  type FormTemplate,
} from "@/lib/types";
import {
  LIVE_ITEMS,
  isChecklistStatus,
  type ChecklistStatus,
  type ChecklistStatusColumn,
  type OnboardingTimestampColumn,
} from "@/lib/checklists";
import {
  FORM_TITLES,
  NDA_SLUG,
  SERVICE_ORDER_SLUG,
  STATEMENT_OF_WORK_SLUG,
  isFormSlug,
  type FormSlug,
} from "@/lib/form-fields";
import { clientDisplayName } from "@/lib/format";
import { sendAdminEmail, type EmailResult } from "@/lib/email";
import { advanceStage, advanceToKickoff } from "@/lib/kickoff";
import { DEFAULT_NDA } from "@/lib/nda";
import {
  DEFAULT_INTAKE_PROMPT,
  DEFAULT_INTAKE_TOPICS,
  INTAKE_PROMPT_SLUG,
  INTAKE_TOPICS_SLUG,
  parseIntakeTopics,
  type IntakeTopic,
} from "@/lib/intake";
import { callClaudeTool } from "@/lib/anthropic";
import { loadIntakeSettings } from "@/lib/intake-server";
import { notifyClient } from "@/lib/notify";
import {
  DEFAULT_SERVICE_ORDER,
  isKickoffReady,
  STRIPE_INVOICE_LINK_ERROR,
  isStripeInvoiceLink,
} from "@/lib/service-order";
import { DEFAULT_STATEMENT_OF_WORK } from "@/lib/statement-of-work";
import { voidInvoice } from "@/lib/stripe";
import {
  TEST_PILOT_MIGRATION_MISSING,
  isTestPilotColumnError,
  testPilotEmail,
} from "@/lib/test-pilot";

const RAISE_STAGES = new Set<string>(["Pre-seed", "Seed", "Series A"]);

export type CreateClientInput = {
  first_name: string;
  last_name: string;
  email: string;
  company_name: string;
  company_website: string;
  /** Internal test client: no setup link, client emails and reminders off. */
  is_test_pilot: boolean;
  /** Push the Forms SoW template into the portal right after the client is created. */
  push_statement_of_work?: boolean;
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

// Pushing a document to the portal also emails the client; the email result
// is reported separately because a failed email does not undo the push.
export type SendToClientResult =
  | {
      ok: true;
      clientEmail: EmailResult;
      /** The first push is not emailed; it goes out with the welcome email. */
      firstPush?: boolean;
    }
  | { ok: false; error: string };

// On success the admin gets the client's set-password link to email them
// (none for a test pilot client). `linked` is true when the client was
// attached to a login that already existed.
export type CreateClientResult =
  | {
      ok: true;
      clientId: string;
      testPilot: boolean;
      linked: boolean;
      email: string;
      setupUrl: string | null;
      expiresAt: string | null;
      /** Set when the form asked to push the Statement of Work. */
      sow?: { ok: true } | { ok: false; error: string };
    }
  | { ok: false; error: string };

export type SetupLinkResult =
  | { ok: true; email: string; setupUrl: string; expiresAt: string }
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
): Promise<CreateClientResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const testPilot = input.is_test_pilot === true;
  // A test pilot only needs a company name; the rest gets placeholders.
  const firstName = input.first_name.trim() || (testPilot ? "Test" : "");
  const lastName = input.last_name.trim() || (testPilot ? "Pilot" : "");
  const email =
    input.email.trim().toLowerCase() ||
    (testPilot ? testPilotEmail(randomUUID().slice(0, 8)) : "");
  const companyName = input.company_name.trim();
  const website = input.company_website.trim();

  if (!firstName || !lastName || !email || !companyName) {
    return {
      ok: false,
      error: "First name, last name, email, and company name are required.",
    };
  }
  if (website && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(website)) {
    return { ok: false, error: "Enter a valid company website, e.g. acme.com." };
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
  const existingUser = existingAuth.user;

  if (existingUser) {
    // Link the existing login. Its password is left alone; the setup link
    // lets the client choose a new one.
    if (roleFromUser(existingUser) === "admin") {
      return {
        ok: false,
        error:
          "This email belongs to an admin account and cannot be added as a client.",
      };
    }

    const { data: existingById, error: existingByIdError } = await supabase
      .from("clients")
      .select("id")
      .eq("id", existingUser.id)
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

    userId = existingUser.id;
  } else {
    // No password: nobody can sign in until the client sets one via the link.
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { role: "client" },
      });

    if (createError || !created.user) {
      return {
        ok: false,
        error: createError?.message ?? "Unable to create the client account.",
      };
    }

    userId = created.user.id;
  }

  // Undo everything this request created. An existing login keeps its
  // password; only a role it was given here may remain.
  async function rollback() {
    await supabase.from("clients").delete().eq("id", userId);
    if (!existingUser) {
      await supabase.auth.admin.deleteUser(userId);
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
    ...(website ? { company_website: website } : {}),
    stage: "sow",
    ...(testPilot ? { is_test_pilot: true, emails_paused: true } : {}),
  });

  if (insertError) {
    if (!existingUser) {
      await supabase.auth.admin.deleteUser(userId);
    }
    return {
      ok: false,
      error: isTestPilotColumnError(insertError.message)
        ? TEST_PILOT_MIGRATION_MISSING
        : insertError.message,
    };
  }

  if (existingUser) {
    const roleResult = await ensureClientRole(supabase, existingUser);
    if (!roleResult.ok) {
      await rollback();
      return roleResult;
    }
  }

  // A test pilot is never signed into: Rupert views it as the client.
  let setupUrl: string | null = null;
  let expiresAt: string | null = null;
  if (!testPilot) {
    const issued = await issueSetupLink(supabase, userId);
    if (!issued.ok) {
      await rollback();
      return issued;
    }
    setupUrl = issued.link.url;
    expiresAt = issued.link.expiresAt;
  }

  let sow: { ok: true } | { ok: false; error: string } | undefined;
  if (input.push_statement_of_work) {
    const pushed = await sendDefaultStatementOfWork(userId);
    sow = pushed.ok ? { ok: true } : { ok: false, error: pushed.error };
  }

  revalidatePath("/admin");
  return {
    ok: true,
    clientId: userId,
    testPilot,
    linked: Boolean(existingUser),
    email,
    setupUrl,
    expiresAt,
    sow,
  };
}

// Issue a new set-password link for an existing client. Any previous link
// stops working immediately; the current password keeps working until the
// client sets a new one.
export async function issueClientSetupLink(
  clientId: string,
): Promise<SetupLinkResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { supabase } = access;

  // The client id is the auth user id.
  const { data: userData, error: getError } =
    await supabase.auth.admin.getUserById(clientId);

  if (getError || !userData?.user) {
    return {
      ok: false,
      error: getError?.message ?? "Could not find this client's login.",
    };
  }

  const user = userData.user;
  if (!user.email) {
    return { ok: false, error: "This client's login has no email address." };
  }

  if (roleFromUser(user) === "admin") {
    return {
      ok: false,
      error: "This login is an admin account and can't be reset here.",
    };
  }

  // Repairs logins created directly in Supabase without the client role.
  const roleResult = await ensureClientRole(supabase, user);
  if (!roleResult.ok) return roleResult;

  const issued = await issueSetupLink(supabase, clientId);
  if (!issued.ok) return issued;

  revalidatePath(`/admin/clients/${clientId}`);
  return {
    ok: true,
    email: user.email,
    setupUrl: issued.link.url,
    expiresAt: issued.link.expiresAt,
  };
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

const CHECKLIST_COLUMNS = new Set<string>(LIVE_ITEMS.map((item) => item.column));

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

  if (column === "payment_received_at" && done) {
    // The admin is the one acting here, so no email; kick-off still records
    // its in-app notification.
    await advanceToKickoff(access.supabase, clientId);
  }

  if (column === "nda_signed_at" && done) {
    await advanceStage(access.supabase, clientId, ["nda"], "intake");
  }

  // Intake complete does not open Setup. Company Materials is the last
  // Onboarding step; submitting them moves the stage to setup.

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
      .select("*")
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
      client_name: client ? clientDisplayName(client) : "Deleted client",
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

/** Removes every admin notification. Does not affect emails already sent. */
export async function clearAllNotifications(): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { error } = await access.supabase
    .from("notifications")
    .delete()
    .not("id", "is", null);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin", "layout");
  revalidatePath("/admin/notifications");
  return { ok: true };
}

const FORM_DEFAULTS: Record<FormSlug, string> = {
  [STATEMENT_OF_WORK_SLUG]: DEFAULT_STATEMENT_OF_WORK,
  [SERVICE_ORDER_SLUG]: DEFAULT_SERVICE_ORDER,
  [NDA_SLUG]: DEFAULT_NDA,
};

const FORM_PATHS: Record<FormSlug, string> = {
  [STATEMENT_OF_WORK_SLUG]: "/admin/forms/statement-of-work",
  [SERVICE_ORDER_SLUG]: "/admin/forms/service-order",
  [NDA_SLUG]: "/admin/forms/nda",
};

export async function getFormTemplate(
  slug: FormSlug = STATEMENT_OF_WORK_SLUG,
): Promise<FormTemplate & { defaultContent: string }> {
  const defaultContent = FORM_DEFAULTS[slug];
  const empty = {
    slug,
    title: FORM_TITLES[slug],
    content: defaultContent,
    updated_at: null,
    defaultContent,
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
  // Early Statement of Work templates used {{merge}} fields that no longer exist.
  const staleMergeTemplate =
    slug === STATEMENT_OF_WORK_SLUG && content.includes("{{");

  return {
    slug,
    title: FORM_TITLES[slug],
    content: content && !staleMergeTemplate ? content : defaultContent,
    updated_at: data.updated_at != null ? String(data.updated_at) : null,
    defaultContent,
  };
}

export async function saveFormTemplate(
  slug: string,
  content: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  if (!isFormSlug(slug)) {
    return { ok: false, error: "Unknown form." };
  }

  if (!content.trim()) {
    return { ok: false, error: "The document cannot be empty." };
  }

  const { error } = await access.supabase.from("form_templates").upsert({
    slug,
    title: FORM_TITLES[slug],
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

  revalidatePath(FORM_PATHS[slug]);
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
): Promise<SendToClientResult> {
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

  const { count: priorSends, error: priorError } = await access.supabase
    .from("statement_of_work_sends")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);

  if (priorError) {
    if (sowSendsTableError(priorError.message, priorError.code)) {
      return {
        ok: false,
        error:
          "The statement_of_work_sends table is missing. Run portal/supabase/sow_sends.sql in the Supabase SQL editor, then try again.",
      };
    }
    return { ok: false, error: priorError.message };
  }

  // Any earlier row is archived (an active one would have blocked the push).
  const revised = (priorSends ?? 0) > 0;

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

  // The first push is not emailed. The welcome email Dori sends is the
  // client's first message, and it already says the SoW is in the portal.
  const clientEmail = revised
    ? await notifyClient(access.supabase, clientId, "statement_of_work_ready", {
        updated: true,
      })
    : {
        ok: false as const,
        reason: "No email sent: it goes with your welcome email.",
      };

  revalidatePath("/admin");
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/portal/statement-of-work");
  return { ok: true, clientEmail, firstPush: !revised };
}

/** Generate & send in one step: the SoW from the Forms template, pushed as is. */
export async function sendDefaultStatementOfWork(
  clientId: string,
): Promise<SendToClientResult> {
  const generated = await generateStatementOfWork(clientId);
  if (!generated.ok) return generated;
  if (!generated.content?.trim()) {
    return { ok: false, error: "The Statement of Work template is empty." };
  }
  return sendStatementOfWork(clientId, generated.content);
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

const SERVICE_ORDER_TABLE_MISSING =
  "The service_order_sends table is missing. Run portal/supabase/service_order.sql in the Supabase SQL editor, then try again.";

function serviceOrderTableError(message: string, code?: string) {
  return (
    code === "42P01" ||
    code === "42703" ||
    message.includes("service_order_sends") ||
    message.includes("setup_invoice_url") ||
    message.toLowerCase().includes("schema cache")
  );
}

function serviceOrderError(
  message: string,
  code?: string,
): { ok: false; error: string } {
  return {
    ok: false,
    error: isTestPilotColumnError(message)
      ? TEST_PILOT_MIGRATION_MISSING
      : serviceOrderTableError(message, code)
        ? SERVICE_ORDER_TABLE_MISSING
        : message,
  };
}

function revalidateServiceOrderPaths(clientId: string) {
  revalidateClientPaths(clientId);
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/onboarding");
  revalidatePath("/portal/service-order");
}

export async function generateServiceOrder(
  clientId: string,
): Promise<ActionResult & { content?: string }> {
  const access = await requireAdminService();
  if (!access.ok) return access;
  void clientId;

  const template = await getFormTemplate(SERVICE_ORDER_SLUG);
  return { ok: true, content: template.content.trim() || DEFAULT_SERVICE_ORDER };
}

export async function sendServiceOrder(
  clientId: string,
  content: string,
  paymentLink: string,
): Promise<SendToClientResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  if (!content.trim()) {
    return { ok: false, error: "Generate the Service Order before sending." };
  }

  const { supabase } = access;

  const { data: client, error: loadError } = await supabase
    .from("clients")
    .select("id, is_test_pilot")
    .eq("id", clientId)
    .maybeSingle();
  if (loadError) return serviceOrderError(loadError.message, loadError.code);
  if (!client) return { ok: false, error: "Client not found." };
  const testPilot = client.is_test_pilot === true;

  // Test pilots have no invoice. Every other client needs a hosted invoice
  // link; the webhook matches invoice.paid against setup_invoice_url.
  const pasted = paymentLink.trim();
  if (!testPilot && !pasted) {
    return {
      ok: false,
      error: "Add the Stripe invoice link for the Setup Fee invoice.",
    };
  }
  if (pasted && !isStripeInvoiceLink(pasted)) {
    return { ok: false, error: STRIPE_INVOICE_LINK_ERROR };
  }

  const { data: activeSends, error: activeError } = await supabase
    .from("service_order_sends")
    .select("id")
    .eq("client_id", clientId)
    .is("archived_at", null)
    .limit(1);

  if (activeError) return serviceOrderError(activeError.message, activeError.code);

  const alreadySent =
    "A Service Order has already been sent. Archive it to send a new one.";
  if (activeSends && activeSends.length > 0) {
    return { ok: false, error: alreadySent };
  }

  const { error: insertError } = await supabase
    .from("service_order_sends")
    .insert({ client_id: clientId, content, payment_link: pasted });

  if (insertError) {
    if (insertError.code === "23505") return { ok: false, error: alreadySent };
    return serviceOrderError(insertError.message, insertError.code);
  }

  const { error: clientError } = await supabase
    .from("clients")
    .update({
      service_order_content: content,
      setup_invoice_url: pasted || null,
      stripe_invoice_id: null,
      service_order_agreed_at: null,
    })
    .eq("id", clientId);

  if (clientError) return serviceOrderError(clientError.message, clientError.code);

  // Move a client still at the Statement of Work stage forward.
  await supabase
    .from("clients")
    .update({ stage: "service_order" })
    .eq("id", clientId)
    .or("stage.is.null,stage.eq.sow");

  const clientEmail = await notifyClient(
    supabase,
    clientId,
    "service_order_ready",
  );

  revalidateServiceOrderPaths(clientId);
  return { ok: true, clientEmail };
}

/**
 * Archiving the active Service Order voids it: it disappears from the portal
 * (including any signature) so a new one can be issued. The client's stage
 * and payment status are left as they are.
 */
export async function archiveServiceOrder(
  clientId: string,
  sendId: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { supabase } = access;

  const { data: archived, error } = await supabase
    .from("service_order_sends")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", sendId)
    .eq("client_id", clientId)
    .is("archived_at", null)
    .select("id");

  if (error) return serviceOrderError(error.message, error.code);
  if (!archived || archived.length === 0) {
    return { ok: false, error: "That Service Order is already archived." };
  }

  const { data: invoiceRow } = await supabase
    .from("clients")
    .select("stripe_invoice_id, payment_received_at")
    .eq("id", clientId)
    .maybeSingle();

  const { error: clientError } = await supabase
    .from("clients")
    .update({
      service_order_content: null,
      setup_invoice_url: null,
      stripe_invoice_id: null,
      service_order_agreed_at: null,
    })
    .eq("id", clientId);

  if (clientError) return serviceOrderError(clientError.message, clientError.code);

  // An unpaid automatic invoice is voided so it cannot be paid by mistake.
  if (invoiceRow?.stripe_invoice_id && !invoiceRow.payment_received_at) {
    const voided = await voidInvoice(String(invoiceRow.stripe_invoice_id));
    if (!voided.ok) {
      console.error(`Setup Fee invoice not voided: ${voided.error}`);
    }
  }

  revalidateServiceOrderPaths(clientId);
  return { ok: true };
}

/** Sends a test email to the admin address so email setup can be checked. */
export async function sendTestEmail(): Promise<EmailResult> {
  const access = await requireAdminService();
  if (!access.ok) return { ok: false, reason: access.error };

  return sendAdminEmail(
    "Rupert test email",
    "Email notifications from the Rupert portal are working.",
  );
}

// ---------------------------------------------------------------------------
// NDA (stored in signed_documents)

const SIGNED_DOCUMENTS_TABLE_MISSING =
  "The signed_documents table is missing. Run portal/supabase/signed_documents.sql in the Supabase SQL editor, then try again.";

function signedDocumentsError(
  message: string,
  code?: string,
): { ok: false; error: string } {
  const missing =
    code === "42P01" ||
    code === "42703" ||
    message.includes("signed_documents") ||
    message.includes("nda_sent_at") ||
    message.toLowerCase().includes("schema cache");
  return { ok: false, error: missing ? SIGNED_DOCUMENTS_TABLE_MISSING : message };
}

function revalidateNdaPaths(clientId: string) {
  revalidateClientPaths(clientId);
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/onboarding");
  revalidatePath("/portal/nda");
}

export async function generateNda(
  clientId: string,
): Promise<ActionResult & { content?: string }> {
  const access = await requireAdminService();
  if (!access.ok) return access;
  void clientId;

  const template = await getFormTemplate(NDA_SLUG);
  return { ok: true, content: template.content.trim() || DEFAULT_NDA };
}

export async function sendNda(
  clientId: string,
  content: string,
): Promise<SendToClientResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  if (!content.trim()) {
    return { ok: false, error: "Generate the NDA before sending." };
  }

  const { supabase } = access;

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, service_order_agreed_at, payment_received_at")
    .eq("id", clientId)
    .maybeSingle();

  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client not found." };
  if (!isKickoffReady(client)) {
    return {
      ok: false,
      error:
        "The NDA can be sent after kick-off: the Service Order must be signed and the Setup Fee received.",
    };
  }

  const alreadySent = "An NDA has already been sent. Archive it to send a new one.";

  const { data: active, error: activeError } = await supabase
    .from("signed_documents")
    .select("id")
    .eq("client_id", clientId)
    .eq("doc_type", "nda")
    .is("archived_at", null)
    .limit(1);

  if (activeError) return signedDocumentsError(activeError.message, activeError.code);
  if (active && active.length > 0) return { ok: false, error: alreadySent };

  const sentAt = new Date().toISOString();
  const { error: insertError } = await supabase
    .from("signed_documents")
    .insert({ client_id: clientId, doc_type: "nda", content, sent_at: sentAt });

  if (insertError) {
    if (insertError.code === "23505") return { ok: false, error: alreadySent };
    return signedDocumentsError(insertError.message, insertError.code);
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ nda_sent_at: sentAt, nda_signed_at: null })
    .eq("id", clientId);

  if (updateError) return signedDocumentsError(updateError.message, updateError.code);

  const clientEmail = await notifyClient(supabase, clientId, "nda_ready");

  revalidateNdaPaths(clientId);
  return { ok: true, clientEmail };
}

/**
 * Archiving the active NDA voids it: it disappears from the portal
 * (including any signature) so a new one can be issued.
 */
export async function archiveNda(
  clientId: string,
  sendId: string,
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const { supabase } = access;

  const { data: archived, error } = await supabase
    .from("signed_documents")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", sendId)
    .eq("client_id", clientId)
    .eq("doc_type", "nda")
    .is("archived_at", null)
    .select("id");

  if (error) return signedDocumentsError(error.message, error.code);
  if (!archived || archived.length === 0) {
    return { ok: false, error: "That NDA is already archived." };
  }

  const { error: clientError } = await supabase
    .from("clients")
    .update({ nda_sent_at: null, nda_signed_at: null })
    .eq("id", clientId);

  if (clientError) return signedDocumentsError(clientError.message, clientError.code);

  revalidateNdaPaths(clientId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Intake Interviewer settings (stored in form_templates)

export async function getIntakeSettings(): Promise<{
  prompt: string;
  topics: IntakeTopic[];
  defaults: { prompt: string; topics: IntakeTopic[] };
}> {
  const defaults = { prompt: DEFAULT_INTAKE_PROMPT, topics: DEFAULT_INTAKE_TOPICS };
  const access = await requireAdminService();
  if (!access.ok) return { ...defaults, defaults };

  const settings = await loadIntakeSettings(access.supabase);
  return { ...settings, defaults };
}

const INTAKE_PROMPT_MAX_CHARS = 8000;

export async function saveIntakeSettings(
  prompt: string,
  topics: IntakeTopic[],
): Promise<ActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;

  const cleanPrompt = String(prompt ?? "").trim();
  if (!cleanPrompt) return { ok: false, error: "The instructions cannot be empty." };
  if (cleanPrompt.length > INTAKE_PROMPT_MAX_CHARS) {
    return {
      ok: false,
      error: `Keep the instructions under ${INTAKE_PROMPT_MAX_CHARS} characters.`,
    };
  }

  const cleanTopics = parseIntakeTopics(topics);
  if (!cleanTopics) {
    return {
      ok: false,
      error: "Each topic needs a title, and there must be between 1 and 20 topics.",
    };
  }

  const updatedAt = new Date().toISOString();
  const { error } = await access.supabase.from("form_templates").upsert([
    {
      slug: INTAKE_PROMPT_SLUG,
      title: "Intake Interviewer instructions",
      content: cleanPrompt,
      updated_at: updatedAt,
    },
    {
      slug: INTAKE_TOPICS_SLUG,
      title: "Intake Interviewer topics",
      content: JSON.stringify(cleanTopics),
      updated_at: updatedAt,
    },
  ]);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/forms/intake");
  return { ok: true };
}

/** Sends a tiny request to Claude so the admin can check the AI setup. */
export async function testClaudeConnection(): Promise<
  { ok: true; reply: string; model: string } | { ok: false; reason: string }
> {
  const access = await requireAdminService();
  if (!access.ok) return { ok: false, reason: access.error };

  const result = await callClaudeTool<{ reply?: unknown }>({
    system:
      "You are a connection test. Reply by calling the respond tool with one short friendly sentence.",
    messages: [{ role: "user", content: "Say hello from Rupert." }],
    tool: {
      name: "respond",
      description: "Send the reply.",
      input_schema: {
        type: "object",
        properties: { reply: { type: "string" } },
        required: ["reply"],
      },
    },
    maxTokens: 200,
    fallbackFromText: (text) => ({ reply: text }),
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    reply: String(result.input.reply ?? "").trim() || "(empty reply)",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  };
}
