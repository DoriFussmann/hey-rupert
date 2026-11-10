"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { sendClientEmail } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import { VIEWER_WELCOME_KEY, renderEmail } from "@/lib/email-templates";
import { isServiceRoleConfigured } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { PORTAL_HOST } from "@/lib/portal-url";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  describeViewerError,
  getViewer,
  issueViewerSetupLink,
} from "@/lib/viewers";

// Viewers: view-only portal logins a client asked to be added. Managed from
// the client page (Client details & account → Viewers).

export type ViewerActionResult = { ok: true } | { ok: false; error: string };

async function requireAdminService() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false as const, error: "Service role key is not configured." };
  }
  return { ok: true as const, supabase: createServiceClient() };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adds a view-only login for this client's portal. No password is set and no
 * email goes out here: the viewer gets in once Rupert sends the welcome
 * email and they set a password with its link.
 */
export async function addClientViewer(
  clientId: string,
  input: { first_name: string; last_name: string; email: string },
): Promise<ViewerActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;
  const { supabase } = access;

  const firstName = input.first_name.trim();
  const lastName = input.last_name.trim();
  const email = input.email.trim().toLowerCase();
  if (!firstName || !lastName || !email) {
    return { ok: false, error: "First name, last name and email are required." };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client not found." };

  // Fail before creating a login when the table isn't there yet.
  const { error: tableError } = await supabase
    .from("client_viewers")
    .select("id")
    .limit(1);
  if (tableError) return { ok: false, error: describeViewerError(tableError) };

  // No password: nobody can sign in until the viewer sets one via the link.
  // An email that already has a login (a client, an admin or another
  // viewer) is refused: one login can't be both.
  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { role: "viewer" },
    });
  if (createError || !created.user) {
    const message = createError?.message ?? "Unable to create the viewer's login.";
    return {
      ok: false,
      error: /already (been )?registered|already exists/i.test(message)
        ? "This email already has a Rupert login (a client, an admin or another viewer), so it can't be added as a viewer."
        : message,
    };
  }
  const viewerId = created.user.id;

  const { error: insertError } = await supabase.from("client_viewers").insert({
    id: viewerId,
    client_id: clientId,
    first_name: firstName,
    last_name: lastName,
    email,
  });
  if (insertError) {
    await supabase.auth.admin.deleteUser(viewerId);
    return { ok: false, error: describeViewerError(insertError) };
  }

  const issued = await issueViewerSetupLink(supabase, viewerId);
  if (!issued.ok) {
    await supabase.auth.admin.deleteUser(viewerId);
    return issued;
  }

  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/**
 * Emails the viewer their welcome email (Forms → Emails → "Welcome email
 * (viewer)") with a set-password link. A link that is still valid is reused;
 * an expired or already-used one is replaced, so this also works as "send a
 * new password link". The email is recorded in the client's email history.
 */
export async function sendViewerWelcomeEmail(
  viewerId: string,
): Promise<ViewerActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;
  const { supabase } = access;

  const found = await getViewer(supabase, viewerId);
  if (!found.ok) return found;
  const viewer = found.viewer;
  if (!viewer) return { ok: false, error: "Viewer not found." };

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("company_name")
    .eq("id", viewer.clientId)
    .maybeSingle();
  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client not found." };

  let link: { url: string; expiresAt: string };
  if (viewer.access.status === "pending") {
    link = { url: viewer.access.url, expiresAt: viewer.access.expiresAt };
  } else {
    const issued = await issueViewerSetupLink(supabase, viewerId);
    if (!issued.ok) return issued;
    link = issued;
  }

  const settings = await loadEmailSettings(supabase);
  const firstName = viewer.firstName.trim();
  const rendered = renderEmail(settings.templates[VIEWER_WELCOME_KEY], {
    greeting: firstName ? `Hi ${firstName},` : "Hi,",
    first_name: firstName || "there",
    company: String(client.company_name ?? "").trim() || "Your colleague",
    setup_link: link.url,
    link_expires: formatDate(link.expiresAt),
    login_email: viewer.email,
    portal_host: PORTAL_HOST,
    signature: settings.signature,
  });

  const sent = await sendClientEmail(supabase, {
    clientId: viewer.clientId,
    kind: "manual",
    templateKey: VIEWER_WELCOME_KEY,
    to: [viewer.email],
    subject: rendered.subject,
    text: rendered.body,
  });

  revalidatePath(`/admin/clients/${viewer.clientId}`);
  if (!sent.ok) return { ok: false, error: sent.reason };

  await supabase
    .from("client_viewers")
    .update({ welcome_sent_at: new Date().toISOString() })
    .eq("id", viewerId);
  return { ok: true };
}

/** Removes the viewer and their login. They lose access immediately. */
export async function removeClientViewer(
  viewerId: string,
): Promise<ViewerActionResult> {
  const access = await requireAdminService();
  if (!access.ok) return access;
  const { supabase } = access;

  const found = await getViewer(supabase, viewerId);
  if (!found.ok) return found;
  if (!found.viewer) return { ok: false, error: "Viewer not found." };

  // Only ever delete a login that is a viewer's.
  const { data: userData } = await supabase.auth.admin.getUserById(viewerId);
  if (userData?.user && userData.user.app_metadata?.role !== "viewer") {
    return { ok: false, error: "This login is not a viewer and can't be removed here." };
  }

  // Deleting the login removes the viewer row with it (on delete cascade).
  if (userData?.user) {
    const { error } = await supabase.auth.admin.deleteUser(viewerId);
    if (error) return { ok: false, error: error.message };
  }
  await supabase.from("client_viewers").delete().eq("id", viewerId);

  revalidatePath(`/admin/clients/${found.viewer.clientId}`);
  return { ok: true };
}
