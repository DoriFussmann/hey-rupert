import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { EmailResult } from "@/lib/email";
import { sendClientEmail } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import {
  BODY_MAX,
  FEEDBACK_DEFAULT_MESSAGE,
  SUBJECT_MAX,
  emailTemplate,
  renderEmail,
  tidyBody,
  updatedSubject,
  type EmailToken,
} from "@/lib/email-templates";
import { clientAddress, firstNameOf, greetingFor } from "@/lib/notify";
import { PORTAL_URL } from "@/lib/portal-url";
import {
  asNarrative,
  type ClientEmailDraft,
  type SetupDocumentStep,
  type SetupStepState,
} from "@/lib/setup";

// Draft Email & Send for the feedback and the narrative: the email is filled
// from the step's template in Forms → Emails, Rupert edits it, then sends it.

type ServiceClient = ReturnType<typeof createServiceClient>;

const TEMPLATE_KEY = {
  deck_review: "client:feedback_ready",
  framing: "client:framing_ready",
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

/** The email for the version the client has, from Forms → Emails. */
export async function renderStepEmail(
  supabase: ServiceClient,
  clientId: string,
  step: SetupDocumentStep,
  row: SetupStepState,
): Promise<Prepared> {
  const context = await loadContext(supabase, clientId, step);
  if (!context.ok) return context;

  const reply = step === "framing" ? asNarrative(row.published).admin_note ?? "" : "";
  const rendered = renderEmail(context.template, {
    ...baseValues(context, row.version),
    note: reply ? `A note from Rupert:\n${reply}` : "",
    message: FEEDBACK_DEFAULT_MESSAGE,
  });
  return {
    ok: true,
    to: context.to,
    paused: context.row.emails_paused === true,
    email: {
      subject: row.version > 1 ? updatedSubject(rendered.subject) : rendered.subject,
      body: rendered.body,
    },
  };
}

/**
 * Wraps the middle Claude wrote in the greeting, portal link and signature.
 * A template with {message} (Feedback ready) places it there, so edits in
 * Forms → Emails still apply.
 */
export async function composeAiEmail(
  supabase: ServiceClient,
  clientId: string,
  step: SetupDocumentStep,
  drafted: ClientEmailDraft,
): Promise<Prepared> {
  const context = await loadContext(supabase, clientId, step);
  if (!context.ok) return context;

  const values = baseValues(context, 1);
  const body = context.template.body.includes("{message}")
    ? renderEmail(context.template, { ...values, note: "", message: drafted.body }).body
    : tidyBody(
        [
          values.greeting,
          drafted.body,
          `Open your portal: ${context.portalLink}`,
          context.signature,
        ].join("\n\n"),
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

export function stepEmailProblem(subject: string, body: string) {
  if (!subject) return "Add a subject.";
  if (!body) return "Write the email.";
  if (subject.length > SUBJECT_MAX) {
    return `The subject is too long (max ${SUBJECT_MAX} characters).`;
  }
  if (body.length > BODY_MAX) return `The email is too long (max ${BODY_MAX} characters).`;
  return null;
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
  return sendClientEmail(supabase, {
    clientId,
    kind: "manual",
    templateKey: context.key,
    to: [context.to],
    subject: email.subject,
    text: email.body,
  });
}
