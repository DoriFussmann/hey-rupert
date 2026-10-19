// Email catalog: every email the portal sends, its default wording, the
// fill-ins it accepts, and the reminder schedule per waiting step. Pure
// module: safe on the server and in the browser. Admin edits are stored in
// `email_settings` and merged over these defaults (lib/email-settings.ts).

import { SETUP_FEE_LABEL } from "@/lib/service-order";

// ---------------------------------------------------------------------------
// Fill-ins

export type EmailToken =
  | "greeting"
  | "first_name"
  | "company"
  | "portal_link"
  | "note"
  | "message"
  | "updated_line"
  | "signature"
  | "client"
  | "next_step"
  | "youre_up"
  | "details"
  | "client_link"
  | "task_summary"
  | "task_links"
  | "closing";

export const TOKEN_HELP: Record<EmailToken, string> = {
  greeting: '"Hi Maya," (or "Hi," when there is no first name)',
  first_name: "Client's first name",
  company: "Company name",
  portal_link: "Link to the right page in the client's portal",
  note: 'Your note, as "A note from Rupert: …" (blank when there is none)',
  message:
    "The text Claude writes for this client with Draft Email. Without Claude: a short default line",
  updated_line:
    '" This is an updated version based on your feedback." on revised versions, otherwise blank',
  signature: "Your sign-off (edited once, at the top of this page)",
  client: '"Maya Chen · Acme Robotics"',
  next_step: '"You\'re up: …" when it is your turn, otherwise "Next: …"',
  youre_up: '" — you\'re up" when it is your turn, otherwise blank',
  details: "Extra details about the event (blank when there are none)",
  client_link: "Link to the client in the admin",
  task_summary:
    '"sign your NDA", or "complete 2 waiting steps" when several are waiting',
  task_links:
    '"Open your portal: …", or one line per step with its link when several are waiting',
  closing:
    "\"Questions? Just reply to this email.\" — on the last reminder: an offer to reply or book a call",
};

/** Example values for previews and test emails. */
export const SAMPLE_VALUES: Record<EmailToken, string> = {
  greeting: "Hi Maya,",
  first_name: "Maya",
  company: "Acme Robotics",
  portal_link: "",
  note: "A note from Rupert:\nThis is where your note to the client appears.",
  message:
    "I went through your deck and materials. The full feedback is in your portal. This is where the email you drafted for the client appears.",
  updated_line: "",
  signature: "",
  client: "Maya Chen · Acme Robotics",
  next_step: "You're up: Issue NDA.",
  youre_up: " — you're up",
  details: "Extra details about the event appear here.",
  client_link: "",
  task_summary: "sign your NDA",
  task_links: "",
  closing: "Questions? Just reply to this email.",
};

const TOKEN_PATTERN = /\{([a-z_]+)\}/g;

/** Fills `{token}` placeholders. Unknown placeholders are left as typed. */
export function fillTokens(
  template: string,
  values: Partial<Record<EmailToken, string>>,
) {
  return template.replace(TOKEN_PATTERN, (match, name: string) => {
    const value = values[name as EmailToken];
    return value !== undefined ? value : match;
  });
}

/** Collapses the blank lines left by empty fill-ins. */
export function tidyBody(text: string) {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function tidySubject(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function renderEmail(
  template: { subject: string; body: string },
  values: Partial<Record<EmailToken, string>>,
) {
  return {
    subject: tidySubject(fillTokens(template.subject, values)),
    body: tidyBody(fillTokens(template.body, values)),
  };
}

/** Placeholders in the text that this email does not support. */
export function unknownTokens(text: string, allowed: readonly EmailToken[]) {
  const found = new Set<string>();
  text.replace(TOKEN_PATTERN, (match, name: string) => {
    if (!allowed.includes(name as EmailToken)) found.add(match);
    return match;
  });
  return Array.from(found);
}

// ---------------------------------------------------------------------------
// Catalog

export type ClientTurn =
  | "statement_of_work_ready"
  | "service_order_ready"
  | "nda_ready"
  | "materials_reopened"
  | "feedback_ready"
  | "framing_ready"
  | "investor_list_ready"
  | "email_copy_ready";

export type AdminEmailType =
  | "sow_confirmed"
  | "service_order_agreed"
  | "setup_fee_paid"
  | "password_set"
  | "nda_signed"
  | "intake_completed"
  | "materials_submitted"
  | "feedback_viewed"
  | "deck_review_confirmed"
  | "framing_confirmed"
  | "framing_changes_requested"
  | "investor_list_confirmed"
  | "investor_list_changes_requested"
  | "email_copy_confirmed"
  | "email_copy_changes_requested"
  | "client_stalled";

export type EmailTemplateKey =
  | `client:${ClientTurn}`
  | `admin:${AdminEmailType}`
  | "reminder";

export type EmailTemplateGroup = "client" | "admin" | "reminder";

export type EmailTemplateDefinition = {
  key: EmailTemplateKey;
  group: EmailTemplateGroup;
  title: string;
  /** When it is sent. */
  trigger: string;
  subject: string;
  body: string;
  tokens: readonly EmailToken[];
  /** Portal page the email links to (client emails). */
  path?: string;
  /** False when the email cannot be switched off here (reminders have
   * per-step switches instead). */
  switchable: boolean;
  /** Whether the email is on before the admin changes it (default: on). */
  defaultEnabled?: boolean;
};

export const CLIENT_TOKENS_LIST: readonly EmailToken[] = [
  "greeting",
  "first_name",
  "company",
  "portal_link",
  "note",
  "updated_line",
  "signature",
];

export const ADMIN_TOKENS_LIST: readonly EmailToken[] = [
  "client",
  "company",
  "next_step",
  "youre_up",
  "details",
  "client_link",
];

export const FEEDBACK_TOKENS_LIST: readonly EmailToken[] = [
  "greeting",
  "first_name",
  "company",
  "message",
  "portal_link",
  "updated_line",
  "signature",
];

/** Fills {message} in the Feedback ready email until Rupert drafts his own. */
export const FEEDBACK_DEFAULT_MESSAGE =
  "Rupert has reviewed your pitch deck and materials. His Company Summary and Investor Framing are ready in your portal. Read them through, then confirm in your portal. Once you've confirmed this and the outreach narrative, Rupert sends your matched investor list.";

export const REMINDER_TOKENS_LIST: readonly EmailToken[] = [
  "greeting",
  "first_name",
  "company",
  "task_summary",
  "task_links",
  "closing",
  "signature",
];

export const DEFAULT_SIGNATURE = "Dori\nHey Rupert";

function clientBody(prepared: string, task: string) {
  return [
    "{greeting}",
    `${prepared}{updated_line}`,
    "{note}",
    task,
    "Open your portal: {portal_link}",
    "{signature}",
  ].join("\n\n");
}

function clientTemplate(
  turn: ClientTurn,
  title: string,
  trigger: string,
  path: string,
  subject: string,
  prepared: string,
  task: string,
): EmailTemplateDefinition {
  return {
    key: `client:${turn}`,
    group: "client",
    title,
    trigger,
    subject,
    body: clientBody(prepared, task),
    tokens: CLIENT_TOKENS_LIST,
    path,
    switchable: true,
  };
}

const CLIENT_TEMPLATES: EmailTemplateDefinition[] = [
  clientTemplate(
    "statement_of_work_ready",
    "Statement of Work ready",
    "When you push a revised Statement of Work. The first one goes out with your welcome email.",
    "/portal/statement-of-work",
    "Your Statement of Work is ready — you're up",
    "Rupert has prepared your Statement of Work.",
    "You're up: review it and confirm in your portal.",
  ),
  clientTemplate(
    "service_order_ready",
    "Service Order & Setup Fee ready",
    "When you push a Service Order and Setup Fee invoice.",
    "/portal/service-order",
    "Your Service Order and Setup Fee invoice are ready — you're up",
    `Rupert has prepared your Service Order and the ${SETUP_FEE_LABEL} Setup Fee invoice.`,
    "You're up: sign the Service Order and pay the Setup Fee in your portal, in either order. Once both are done, we kick off.",
  ),
  clientTemplate(
    "nda_ready",
    "NDA ready",
    "When you push an NDA.",
    "/portal/nda",
    "Your NDA is ready — you're up",
    "Rupert has prepared your Non-Disclosure Agreement.",
    "You're up: review and sign it in your portal. It protects everything you share with us from here on.",
  ),
  clientTemplate(
    "materials_reopened",
    "More materials needed",
    "When you send the company materials back to the client.",
    "/portal/materials",
    "Rupert needs a little more from you — you're up",
    "Rupert has reviewed your company materials and needs a few more things.",
    "You're up: add what's missing and submit again in your portal.",
  ),
  {
    key: "client:feedback_ready",
    group: "client",
    title: "Feedback ready",
    trigger:
      "Fills Draft Email under Analysis & Feedback when Claude is not set up (otherwise Claude writes the middle into {message}). You review and edit it, then it goes with Push to Client Portal & Send.",
    subject: "Rupert's feedback on your materials is ready — you're up",
    body: [
      "{greeting}",
      "{message}",
      "Read the full feedback in your portal: {portal_link}",
      "{signature}",
    ].join("\n\n"),
    tokens: FEEDBACK_TOKENS_LIST,
    path: "/portal/setup/deck-review",
    switchable: true,
  },
  clientTemplate(
    "framing_ready",
    "Outreach narrative ready",
    "Fills Draft Email under Outreach Narrative when Claude is not set up. You review and edit it, then it goes with Push to Client Portal & Send.",
    "/portal/setup/framing",
    "Your outreach narrative is ready — you're up",
    "Rupert has written the outreach narrative for your investor campaign: the story, the key messages and how we'll approach investors.",
    "You're up: review it in your portal, then confirm or tell us what to change.",
  ),
  clientTemplate(
    "investor_list_ready",
    "Investor list ready",
    "When you publish the matched investor list (or a revised version).",
    "/portal/setup/investor-list",
    "Your matched investor list is ready — you're up",
    "Rupert has matched investors for your raise, grouped into three fit tiers.",
    "You're up: review the list in your portal. Add a note on any fund, ask questions, or confirm.",
  ),
  clientTemplate(
    "email_copy_ready",
    "Outreach emails ready",
    "When you publish the email copy (or a revised version).",
    "/portal/setup/email-copy",
    "Your outreach emails are ready — you're up",
    "Rupert has written the outreach emails for each of the three investor tiers.",
    "You're up: review them in your portal, then confirm or tell us what to change.",
  ),
];

function adminTemplate(
  type: AdminEmailType,
  title: string,
  action: string,
): EmailTemplateDefinition {
  return {
    key: `admin:${type}`,
    group: "admin",
    title,
    trigger: `When a client ${action}.`,
    subject: `{client} ${action}{youre_up}`,
    body: [
      `{client} ${action}.`,
      "{next_step}",
      "{details}",
      "Open the client: {client_link}",
    ].join("\n\n"),
    tokens: ADMIN_TOKENS_LIST,
    switchable: true,
  };
}

const ADMIN_TEMPLATES: EmailTemplateDefinition[] = [
  adminTemplate("sow_confirmed", "Statement of Work confirmed", "confirmed the Statement of Work"),
  adminTemplate("service_order_agreed", "Service Order signed", "signed the Service Order"),
  adminTemplate("setup_fee_paid", "Setup Fee paid", "paid the Setup Fee"),
  adminTemplate("password_set", "Portal password set", "set their portal password"),
  adminTemplate("nda_signed", "NDA signed", "signed the NDA"),
  adminTemplate("intake_completed", "Intake completed", "completed the Client Intake"),
  adminTemplate("materials_submitted", "Materials submitted", "submitted their company materials"),
  {
    ...adminTemplate(
      "feedback_viewed",
      "Client opened the feedback",
      "opened your Analysis & Feedback",
    ),
    trigger:
      "The first time a client opens the feedback you sent (each version). You always get an in-app notification; this email is optional.",
    defaultEnabled: false,
  },
  adminTemplate(
    "deck_review_confirmed",
    "Analysis & Feedback confirmed",
    "confirmed the Analysis & Feedback",
  ),
  adminTemplate(
    "framing_confirmed",
    "Outreach narrative confirmed",
    "confirmed the outreach narrative",
  ),
  adminTemplate(
    "framing_changes_requested",
    "Outreach narrative changes requested",
    "asked for changes to the outreach narrative",
  ),
  adminTemplate("investor_list_confirmed", "Investor list confirmed", "confirmed the investor list"),
  adminTemplate(
    "investor_list_changes_requested",
    "Investor list questions",
    "sent questions on the investor list",
  ),
  adminTemplate("email_copy_confirmed", "Email copy confirmed", "confirmed the email copy"),
  adminTemplate(
    "email_copy_changes_requested",
    "Email copy changes requested",
    "asked for changes to the email copy",
  ),
  {
    ...adminTemplate(
      "client_stalled",
      "Client stalled",
      "has not responded after reminders",
    ),
    trigger:
      "When a client's reminders for a step run out (only for steps with \"Alert me\" on, under Reminders).",
  },
];

const REMINDER_TEMPLATE: EmailTemplateDefinition = {
  key: "reminder",
  group: "reminder",
  title: "Reminder email",
  trigger:
    "Sent on the schedule below while a step waits on the client. Several waiting steps are combined into one email.",
  subject: "Reminder: {task_summary} — you're up",
  body: [
    "{greeting}",
    "A quick nudge. Rupert is waiting on you to {task_summary}.",
    "Each step takes a few minutes, and your campaign moves forward as soon as it is done.",
    "{task_links}",
    "{closing}",
    "{signature}",
  ].join("\n\n"),
  tokens: REMINDER_TOKENS_LIST,
  switchable: false,
};

export const EMAIL_TEMPLATES: EmailTemplateDefinition[] = [
  ...CLIENT_TEMPLATES,
  ...ADMIN_TEMPLATES,
  REMINDER_TEMPLATE,
];

export function emailTemplate(key: string) {
  return EMAIL_TEMPLATES.find((template) => template.key === key) ?? null;
}

export function isEmailTemplateKey(value: unknown): value is EmailTemplateKey {
  return EMAIL_TEMPLATES.some((template) => template.key === value);
}

export function isAdminEmailType(value: string): value is AdminEmailType {
  return EMAIL_TEMPLATES.some((template) => template.key === `admin:${value}`);
}

/** Sample values for one template, with its own portal link. */
export function sampleValues(
  template: EmailTemplateDefinition,
  { portalUrl, signature }: { portalUrl: string; signature: string },
): Record<EmailToken, string> {
  const portalLink = `${portalUrl}${template.path ?? "/portal"}`;
  return {
    ...SAMPLE_VALUES,
    portal_link: portalLink,
    signature,
    client_link: `${portalUrl}/admin/clients/sample`,
    task_links: `Open your portal: ${portalUrl}/portal/nda`,
  };
}

/** Revised versions say "has been updated" instead of "is ready". */
export function updatedSubject(subject: string) {
  return subject
    .replace(" is ready", " has been updated")
    .replace(" are ready", " have been updated");
}

// ---------------------------------------------------------------------------
// Reminder schedule

export type ReminderTurnKey =
  | "sow"
  | "service_order"
  | "nda"
  | "intake"
  | "setup:materials"
  | "setup:deck_review"
  | "setup:framing"
  | "setup:investor_list"
  | "setup:email_copy";

export type ReminderTiming = {
  enabled: boolean;
  /** Days after the step starts waiting before the first reminder. */
  first_after_days: number;
  /** Days between reminders after the first. */
  every_days: number;
  max_reminders: number;
  /** Email Rupert once the reminders run out. */
  stall_alert: boolean;
};

export const REMINDER_STEPS: {
  key: ReminderTurnKey;
  label: string;
  defaults: ReminderTiming;
}[] = [
  { key: "sow", label: "Statement of Work", defaults: timing(false) },
  { key: "service_order", label: "Service Order & Setup Fee", defaults: timing(false) },
  { key: "nda", label: "NDA", defaults: timing(true) },
  { key: "intake", label: "Client Intake", defaults: timing(true) },
  { key: "setup:materials", label: "Company Materials (onboarding)", defaults: timing(true) },
  { key: "setup:deck_review", label: "Analysis & Feedback", defaults: timing(true) },
  { key: "setup:framing", label: "Outreach Narrative", defaults: timing(true) },
  { key: "setup:investor_list", label: "Investor List", defaults: timing(true) },
  { key: "setup:email_copy", label: "Email Copy", defaults: timing(true) },
];

function timing(enabled: boolean): ReminderTiming {
  return {
    enabled,
    first_after_days: 1,
    every_days: 1,
    max_reminders: 3,
    stall_alert: true,
  };
}

export const REMINDER_LIMITS = {
  first_after_days: { min: 1, max: 60 },
  every_days: { min: 1, max: 60 },
  max_reminders: { min: 1, max: 10 },
} as const;

export function isReminderTurnKey(value: unknown): value is ReminderTurnKey {
  return REMINDER_STEPS.some((step) => step.key === value);
}

function wholeNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Reads a stored or submitted timing, clamped to the allowed ranges. */
export function asReminderTiming(
  value: unknown,
  fallback: ReminderTiming,
): ReminderTiming {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    first_after_days: wholeNumber(
      raw.first_after_days,
      fallback.first_after_days,
      REMINDER_LIMITS.first_after_days.min,
      REMINDER_LIMITS.first_after_days.max,
    ),
    every_days: wholeNumber(
      raw.every_days,
      fallback.every_days,
      REMINDER_LIMITS.every_days.min,
      REMINDER_LIMITS.every_days.max,
    ),
    max_reminders: wholeNumber(
      raw.max_reminders,
      fallback.max_reminders,
      REMINDER_LIMITS.max_reminders.min,
      REMINDER_LIMITS.max_reminders.max,
    ),
    stall_alert:
      typeof raw.stall_alert === "boolean" ? raw.stall_alert : fallback.stall_alert,
  };
}

// ---------------------------------------------------------------------------
// Resolved settings (defaults merged with admin edits)

export type EmailTemplateSetting = {
  enabled: boolean;
  subject: string;
  body: string;
  /** True when the admin has edited this email. */
  customized: boolean;
};

export type EmailSettings = {
  templates: Record<EmailTemplateKey, EmailTemplateSetting>;
  signature: string;
  timings: Record<ReminderTurnKey, ReminderTiming>;
};

export function defaultEmailSettings(): EmailSettings {
  const templates = {} as Record<EmailTemplateKey, EmailTemplateSetting>;
  for (const template of EMAIL_TEMPLATES) {
    templates[template.key] = {
      enabled: template.defaultEnabled ?? true,
      subject: template.subject,
      body: template.body,
      customized: false,
    };
  }
  const timings = {} as Record<ReminderTurnKey, ReminderTiming>;
  for (const step of REMINDER_STEPS) timings[step.key] = { ...step.defaults };
  return { templates, signature: DEFAULT_SIGNATURE, timings };
}

export const SUBJECT_MAX = 300;
export const BODY_MAX = 10000;
export const SIGNATURE_MAX = 500;
