import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { EmailResult } from "@/lib/email";
import { sendClientEmail } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import { renderEmail, tidyBody, updatedSubject } from "@/lib/email-templates";
import { clientAddress, firstNameOf, greetingFor } from "@/lib/notify";
import { PORTAL_URL } from "@/lib/portal-url";
import { isStripeInvoiceLink, STRIPE_INVOICE_LINK_ERROR } from "@/lib/service-order";
import { loadSetupStep } from "@/lib/setup-server";
import { loadLiveState, setInvoiceUrl } from "@/lib/outreach/live-server";

// Setup step 4, Go Live: Rupert pushes it to the client with the invoice link
// and an email; the client connects their inbox, pays and clicks Go Live,
// which confirms the step. See claude/rupert-outreach-spec.md in the project.

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const GO_LIVE_TEMPLATE_KEY = "client:go_live_ready";
const GO_LIVE_PATH = "/portal/setup/go-live";

export type GoLiveEmail = { subject: string; body: string };

async function loadClient(supabase: ServiceClient, clientId: string) {
  const { data, error } = await supabase.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client not found." };
  const row = data as Record<string, unknown>;
  const to = clientAddress(row);
  if (!to) return { ok: false as const, error: "This client has no email address." };
  return { ok: true as const, row, to };
}

/** The Go Live email, filled from Forms → Emails. Rupert edits it before sending. */
export async function renderGoLiveEmail(
  supabase: ServiceClient,
  clientId: string,
  invoiceUrl: string,
): Promise<Result<{ email: GoLiveEmail; to: string; paused: boolean; version: number }>> {
  const [client, step] = await Promise.all([loadClient(supabase, clientId), loadSetupStep(supabase, clientId, "go_live")]);
  if (!client.ok) return client;
  if (!step.ok) return step;
  const version = (step.row?.version ?? 0) + 1;
  const settings = await loadEmailSettings(supabase);
  const rendered = renderEmail(settings.templates[GO_LIVE_TEMPLATE_KEY], {
    greeting: greetingFor(client.row),
    first_name: firstNameOf(client.row),
    company: String(client.row.company_name ?? "").trim(),
    portal_link: `${PORTAL_URL}${GO_LIVE_PATH}`,
    note: "",
    updated_line: "",
    signature: settings.signature,
    invoice_link: invoiceUrl.trim() || "(in your portal)",
  });
  return {
    ok: true,
    value: {
      email: { subject: version > 1 ? updatedSubject(rendered.subject) : rendered.subject, body: tidyBody(rendered.body) },
      to: client.to,
      paused: client.row.emails_paused === true,
      version,
    },
  };
}

/**
 * Push to client & email: saves the invoice link, makes Go Live the client's
 * turn (a new version), and sends Rupert's email. The email goes even when
 * automatic emails are paused: Rupert sends it himself. If it fails, the push
 * stands and the reason is returned.
 */
export async function pushGoLive(
  supabase: ServiceClient,
  clientId: string,
  input: { invoiceUrl: string; email: GoLiveEmail },
): Promise<Result<{ version: number; clientEmail: EmailResult }>> {
  const invoiceUrl = String(input.invoiceUrl ?? "").trim();
  const subject = String(input.email?.subject ?? "").replace(/\s+/g, " ").trim();
  const body = String(input.email?.body ?? "").trim();
  if (!subject || !body) return { ok: false, error: "Write the email's subject and text first." };

  const [copy, step, live, client] = await Promise.all([
    loadSetupStep(supabase, clientId, "email_copy"),
    loadSetupStep(supabase, clientId, "go_live"),
    loadLiveState(supabase, clientId),
    loadClient(supabase, clientId),
  ]);
  if (!copy.ok) return copy;
  if (!step.ok) return step;
  if (!live.ok) return live;
  if (!client.ok) return client;
  if (copy.row?.status !== "confirmed" && copy.row?.status !== "published") {
    return { ok: false, error: "The client hasn't confirmed the email copy yet." };
  }
  if (live.value.live) return { ok: false, error: "The campaign is already live." };
  if (!live.value.campaignReady) return { ok: false, error: live.value.campaignNote ?? "Build the campaign first." };
  if (!live.value.invoice.paidAt) {
    if (!invoiceUrl) return { ok: false, error: "Paste the Stripe invoice link for the first monthly invoice." };
    if (!isStripeInvoiceLink(invoiceUrl)) return { ok: false, error: STRIPE_INVOICE_LINK_ERROR };
  }
  if (invoiceUrl && invoiceUrl !== live.value.invoice.url) {
    const saved = await setInvoiceUrl(supabase, clientId, invoiceUrl);
    if (!saved.ok) return saved;
  }

  const row = step.row;
  const at = new Date().toISOString();
  const version = (row?.version ?? 0) + 1;
  const values = {
    client_id: clientId,
    step: "go_live",
    status: "with_client",
    draft: {},
    published: { invoice_url: invoiceUrl || live.value.invoice.url },
    version,
    published_at: at,
    response: null,
    history: [...(row?.history ?? []), { version, published_at: at, response: null }],
    turn_since: at,
    completed_at: null,
    client_viewed_at: null,
    updated_at: at,
  };
  if (row) {
    const { data, error } = await supabase
      .from("setup_steps")
      .update(values)
      .eq("client_id", clientId)
      .eq("step", "go_live")
      .eq("version", row.version)
      .select("client_id");
    if (error) return { ok: false, error: stepTableError(error.message) };
    if (!data || data.length === 0) return { ok: false, error: "Go Live changed meanwhile. Refresh and try again." };
  } else {
    const { error } = await supabase.from("setup_steps").insert(values);
    if (error) return { ok: false, error: error.code === "23505" ? "Go Live changed meanwhile. Refresh and try again." : stepTableError(error.message) };
  }

  const clientEmail = await sendClientEmail(supabase, {
    clientId,
    kind: "manual",
    templateKey: GO_LIVE_TEMPLATE_KEY,
    to: [client.to],
    subject,
    text: body,
  });
  if (clientEmail.ok) {
    await supabase
      .from("setup_steps")
      .update({ history: values.history.map((entry) => (entry.version === version ? { ...entry, emailed_at: new Date().toISOString() } : entry)) })
      .eq("client_id", clientId)
      .eq("step", "go_live")
      .eq("version", version);
  }
  return { ok: true, value: { version, clientEmail } };
}

/** Marks Go Live confirmed once the campaign is live. Best effort: the campaign is already running. */
export async function confirmGoLiveStep(supabase: ServiceClient, clientId: string, actor: string | null) {
  const step = await loadSetupStep(supabase, clientId, "go_live");
  if (!step.ok) return;
  const at = new Date().toISOString();
  const row = step.row;
  const version = Math.max(row?.version ?? 0, 1);
  const response = { decision: "confirmed", note: "", item_notes: {}, version, at, by: actor };
  const history = row?.history?.length
    ? row.history.map((entry) => (entry.version === version ? { ...entry, response } : entry))
    : [{ version, published_at: at, response }];
  const values = { status: "confirmed", version, response, history, completed_at: at, turn_since: null, updated_at: at };
  const { error } = row
    ? await supabase.from("setup_steps").update(values).eq("client_id", clientId).eq("step", "go_live")
    : await supabase.from("setup_steps").insert({ client_id: clientId, step: "go_live", draft: {}, published: {}, published_at: at, ...values });
  if (error) console.error(`Go Live step not confirmed: ${error.message}`);
}

function stepTableError(message: string) {
  return /setup_steps_step_check|violates check constraint/i.test(message)
    ? "The database doesn't know the Go Live step yet: run supabase/setup_go_live_step.sql in Supabase."
    : message;
}
