import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { EmailResult } from "@/lib/email";
import { sendClientEmail } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import {
  emailTemplate,
  renderEmail,
  tidyBody,
  updatedSubject,
  type EmailToken,
} from "@/lib/email-templates";
import { adminFirstName, investorListEmailHtml, investorListEmailText } from "@/lib/investor-list-email";
import { withClientNote } from "@/lib/investor-list-note";
import { clientAddress, firstNameOf, greetingFor } from "@/lib/notify";
import { PORTAL_URL } from "@/lib/portal-url";
import type { ClientEmailDraft, InvestorListPayload, SetupDocumentStep } from "@/lib/setup";

// The email that goes with Push to Client Portal & Send (the narrative, with
// the Company Materials Feedback, and the investor list): drafted by Claude or filled from Forms → Emails, edited by
// Rupert, then sent as he wrote it.

type ServiceClient = ReturnType<typeof createServiceClient>;

const TEMPLATE_KEY = {
  framing: "client:framing_ready",
  investor_list: "client:investor_list_ready",
} as const satisfies Record<SetupDocumentStep, string>;

export const STEP_EMAIL_PAUSED_NOTE =
  "Automatic emails are paused for this client. This one still goes out, because you send it yourself.";

type Prepared =
  | { ok: true; email: ClientEmailDraft; to: string; paused: boolean }
  | { ok: false; error: string };

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

async function loadContext(
  supabase: ServiceClient,
  clientId: string,
  step: SetupDocumentStep,
) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client not found." };
  const row = data as Record<string, unknown>;
  const to = clientAddress(row);
  if (!to) return { ok: false as const, error: "This client has no email address." };

  const key = TEMPLATE_KEY[step];
  const settings = await loadEmailSettings(supabase);
  return {
    ok: true as const,
    row,
    to,
    key,
    template: settings.templates[key],
    signature: settings.signature,
    portalLink: `${PORTAL_URL}${emailTemplate(key)?.path ?? "/portal"}`,
  };
}

/** The fill-ins every Setup email shares. */
function baseValues(
  context: Extract<Awaited<ReturnType<typeof loadContext>>, { ok: true }>,
  version: number,
): Partial<Record<EmailToken, string>> {
  return {
    greeting: greetingFor(context.row),
    first_name: firstNameOf(context.row),
    company: text(context.row.company_name),
    portal_link: context.portalLink,
    updated_line: version > 1 ? " This is an updated version based on your feedback." : "",
    signature: context.signature,
  };
}

/** The investor-list letter, filled from the pushed snapshot. Rupert edits it before sending. */
export async function renderInvestorListLetter(
  supabase: ServiceClient,
  clientId: string,
  list: InvestorListPayload,
): Promise<Prepared> {
  const context = await loadContext(supabase, clientId, "investor_list");
  if (!context.ok) return context;
  return {
    ok: true,
    to: context.to,
    paused: context.row.emails_paused === true,
    email: (() => {
      const letter = investorListEmailText({
        list,
        company: text(context.row.company_name) || "your company",
        clientFirstName: firstNameOf(context.row),
        adminName: adminFirstName(context.signature),
        portalUrl: context.portalLink,
      });
      return { subject: letter.subject, body: letter.text };
    })(),
  };
}

/** The email for a version, filled from Forms → Emails (when Claude is not set up). */
export async function renderStepEmail(
  supabase: ServiceClient,
  clientId: string,
  step: SetupDocumentStep,
  version: number,
): Promise<Prepared> {
  const context = await loadContext(supabase, clientId, step);
  if (!context.ok) return context;

  const rendered = renderEmail(context.template, {
    ...baseValues(context, version),
    note: "",
  });
  return {
    ok: true,
    to: context.to,
    paused: context.row.emails_paused === true,
    email: {
      subject: version > 1 ? updatedSubject(rendered.subject) : rendered.subject,
      body: rendered.body,
    },
  };
}

/** Wraps the middle Claude wrote in the greeting, portal link and signature. */
export async function composeAiEmail(
  supabase: ServiceClient,
  clientId: string,
  step: SetupDocumentStep,
  drafted: ClientEmailDraft,
): Promise<Prepared> {
  const context = await loadContext(supabase, clientId, step);
  if (!context.ok) return context;

  const values = baseValues(context, 1);
  const body = tidyBody(
    [values.greeting, drafted.body, `Open your portal: ${context.portalLink}`, context.signature].join(
      "\n\n",
    ),
  );
  return {
    ok: true,
    to: context.to,
    paused: context.row.emails_paused === true,
    email: {
      subject: drafted.subject.trim() || renderEmail(context.template, values).subject,
      body,
    },
  };
}

/** Sends the email as written and logs it in the client's email history. */
export async function sendStepEmail(
  supabase: ServiceClient,
  clientId: string,
  step: SetupDocumentStep,
  email: ClientEmailDraft,
): Promise<EmailResult> {
  const context = await loadContext(supabase, clientId, step);
  if (!context.ok) return { ok: false, reason: context.error };
  const text = step === "investor_list" ? withClientNote(email.body, email.note) : email.body;
  return sendClientEmail(supabase, {
    clientId,
    kind: "manual",
    templateKey: context.key,
    to: [context.to],
    subject: email.subject,
    text,
    html: step === "investor_list" ? investorListEmailHtml(text) : undefined,
  });
}
