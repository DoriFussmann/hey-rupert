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
  | "updated_line"
  | "signature"
  | "client"
  | "next_step"
  | "youre_up"
  | "details"
  | "client_link"
  | "task_summary"
  | "task_links"
  | "closing"
  | "setup_link"
  | "link_expires"
  | "login_email"
  | "portal_host"
  | "question"
  | "answer"
  | "invoice_link";

export const TOKEN_HELP: Record<EmailToken, string> = {
  greeting: '"Hi Maya," (or "Hi," when there is no first name)',
  first_name: "Client's first name",
  company: "Company name",
  portal_link: "Link to the right page in the client's portal",
  note: 'Your note, as "A note from Rupert: …" (blank when there is none)',
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
  setup_link: "The client's one-time set-password link",
  link_expires: 'When the set-password link stops working, e.g. "Nov 6, 2026"',
  login_email: "The email address the client logs in with",
  portal_host: 'Where the client logs in later, e.g. "heyrupert.com"',
  question: "The client's question, as they wrote it",
  answer: "Your answer, as you wrote it",
  invoice_link: "The Stripe link to the client's first monthly invoice",
};

/** Example values for previews and test emails. */
export const SAMPLE_VALUES: Record<EmailToken, string> = {
  greeting: "Hi Maya,",
  first_name: "Maya",
  company: "Acme Robotics",
  portal_link: "",
  note: "A note from Rupert:\nThis is where your note to the client appears.",
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
  setup_link: "https://heyrupert.com/auth/setup?token=sample",
  link_expires: "Nov 6, 2026",
  login_email: "maya@acme.com",
  portal_host: "heyrupert.com",
  question: "Could we leave out funds that backed our main competitor?",
  answer: "Yes. I've marked them, and they won't be contacted.",
  invoice_link: "https://invoice.stripe.com/i/sample",
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
  | "framing_ready"
  | "investor_list_ready"
  | "email_copy_ready"
  | "go_live_ready"
  | "campaign_live";

export type AdminEmailType =
  | "framing_question"
  | "investor_list_question"
  | "email_copy_question"
  | "sow_confirmed"
  | "service_order_agreed"
  | "setup_fee_paid"
  | "password_set"
  | "nda_signed"
  | "intake_completed"
  | "materials_submitted"
  | "materials_added"
  | "intake_updated"
  | "narrative_viewed"
  | "framing_confirmed"
  | "framing_changes_requested"
  | "investor_list_confirmed"
  | "investor_list_changes_requested"
  | "email_copy_confirmed"
  | "email_copy_changes_requested"
  | "launch_requested"
  | "client_stalled";

export type EmailTemplateKey =
  | `client:${ClientTurn}`
  | `admin:${AdminEmailType}`
  | "reminder"
  | typeof WELCOME_EMAIL_KEY
  | typeof QUESTION_ANSWERED_KEY;

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

export const WELCOME_EMAIL_KEY = "welcome";

export const WELCOME_TOKENS_LIST: readonly EmailToken[] = [
  "greeting",
  "first_name",
  "company",
  "setup_link",
  "link_expires",
  "login_email",
  "portal_host",
  "signature",
];

/**
 * The welcome email Rupert copies and sends himself after adding a client:
 * never sent by the portal. The set-password details are filled in.
 */
export const QUESTION_ANSWERED_KEY = "client:question_answered";

/** Sent when Rupert answers a question the client asked on a review step. */
const QUESTION_ANSWERED_TEMPLATE: EmailTemplateDefinition = {
  key: QUESTION_ANSWERED_KEY,
  group: "client",
  title: "Answer to your question",
  trigger:
    "When you answer a client's question on the Outreach Narrative, Investor List or Email Copy. It goes even when automatic emails are paused, because you send it yourself.",
  subject: "Rupert answered your question",
  body: [
    "{greeting}",
    "You asked:\n{question}",
    "Rupert's answer:\n{answer}",
    "You can confirm whenever you're ready, or ask another question: {portal_link}",
    "{signature}",
  ].join("\n\n"),
  tokens: ["greeting", "first_name", "company", "question", "answer", "portal_link", "signature"],
  switchable: false,
};

const WELCOME_TEMPLATE: EmailTemplateDefinition = {
  key: WELCOME_EMAIL_KEY,
  group: "client",
  title: "Welcome email (new client)",
  trigger:
    "Drafted when you add a client, and again from Welcome Email on the client page. You copy it and send it yourself; the portal never sends it.",
  subject: "Your Rupert Portal & Statement of Work",
  body: [
    "{greeting}",
    "Thank you for the call today. I enjoyed the conversation and appreciate you taking the time.",
    "A small heads-up that this email is slightly longer than usual, but I wanted to put everything you need in one place.",
    "Statement of Work",
    "I've created your Rupert Client Portal, where you'll find the Statement of Work we discussed today.",
    "Please take a look when you have a chance. If everything looks good, click to confirm. If you have any questions or would like to discuss anything in the SOW, just let me know.",
    "Once you confirm, I'll issue the Service Order and send you the next step.",
    "You can also see the overall onboarding process in the portal, so you'll have visibility into what comes next. The other sections of the portal will become active as we move through setup and launch the campaign.",
    "Your portal link is below.",
    "///\nYour Rupert Portal",
    "Set your password here (link valid until {link_expires}):\n{setup_link}",
    "You'll be taken straight into your portal. After that, log in any time at {portal_host} (Login, top-right corner) with {login_email} and the password you chose.",
    "Once logged in, you'll see your Statement of Work and onboarding steps.\n///",
    "Thanks again, {first_name}.",
    "I'm looking forward to hopefully working together, and please reach out with any questions as you review everything.",
    "Dori",
  ].join("\n\n"),
  tokens: WELCOME_TOKENS_LIST,
  switchable: false,
};

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
  clientTemplate(
    "framing_ready",
    "Outreach narrative ready",
    "Fills Draft Email under Outreach Narrative when Claude is not set up. You review and edit it, then it goes with Push to Client Portal & Send.",
    "/portal/setup/framing",
    "Your outreach narrative is ready — you're up",
    "Rupert has written the outreach narrative for your investor campaign: the story, the key messages and how we'll approach investors. His feedback on your materials is there too, for you to read; there's nothing to confirm on it.",
    "You're up: review the narrative in your portal, then confirm or tell us what to change.",
  ),
  clientTemplate(
    "investor_list_ready",
    "Investor list ready",
    "Fills Draft Email under Investor Matching when Claude is not set up. You review and edit it, then it goes with Push to Client Portal & Send.",
    "/portal/setup/investor-list",
    "Your matched investor list is ready — you're up",
    "Rupert has matched investors for your raise, grouped by fit tier.",
    "You're up: review the list in your portal. Add a note on any fund, ask questions, or confirm.",
  ),
  clientTemplate(
    "email_copy_ready",
    "Outreach emails ready",
    "Fills Draft Email under Email Copy when Claude is not set up. You review and edit it, then it goes with Push to Client Portal & Send.",
    "/portal/setup/email-copy",
    "Your outreach emails are ready — you're up",
    "Rupert has written the outreach emails for each investor tier.",
    "You're up: review them in your portal, then confirm or tell us what to change.",
  ),
  {
    key: "client:go_live_ready",
    group: "client",
    title: "Ready to go live",
    trigger:
      "Fills the email under Go Live when you send the launch package with the invoice link. You review and edit it, then it goes with Send launch package.",
    subject: "Your investor campaign is ready — you're up",
    body: [
      "{greeting}",
      "Your investor campaign is built and ready to go.{updated_line}",
      "{note}",
      "Three last steps in your portal:\n1. Connect the inbox you use with investors (you sign in with Google or Microsoft).\n2. Pay the first monthly invoice: {invoice_link}\n3. Send yourself a test if you like, then approve the launch. Rupert starts sending within 24 hours and tells you when you're live.",
      "Open your portal: {portal_link}",
      "{signature}",
    ].join("\n\n"),
    tokens: [...CLIENT_TOKENS_LIST, "invoice_link"],
    path: "/portal/setup/go-live",
    switchable: true,
  },
  clientTemplate(
    "campaign_live",
    "Campaign is live",
    "When you click Go Live after the client approved the launch.",
    "/portal/live-campaign",
    "Your investor campaign is live",
    "Your investor campaign is live. The first emails go out from your inbox in the next weekday window, 9am to 5pm Eastern.",
    "Nothing to do now. Replies that need you appear in your Investor Inbox, and you can follow progress in Campaign Analytics.",
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
  adminTemplate("framing_question", "Question on the narrative", "asked a question on the outreach narrative"),
  adminTemplate("investor_list_question", "Question on the investor list", "asked a question on the investor list"),
  adminTemplate("email_copy_question", "Question on the email copy", "asked a question on the email copy"),
  adminTemplate("sow_confirmed", "Statement of Work confirmed", "confirmed the Statement of Work"),
  adminTemplate("service_order_agreed", "Service Order signed", "signed the Service Order"),
  adminTemplate("setup_fee_paid", "Setup Fee paid", "paid the Setup Fee"),
  adminTemplate("password_set", "Portal password set", "set their portal password"),
  adminTemplate("nda_signed", "NDA signed", "signed the NDA"),
  adminTemplate("intake_completed", "Intake completed", "completed the Client Intake"),
  adminTemplate("materials_submitted", "Materials submitted", "submitted their company materials"),
  {
    ...adminTemplate("materials_added", "Files added after the intake", "added files to their company materials"),
    trigger:
      "When a client adds files after their materials are submitted (in the intake chat or on Company Files). One email until you read the in-app alert; {details} lists the files.",
  },
  {
    ...adminTemplate("intake_updated", "Intake chat after completion", "added to their intake after finishing it"),
    trigger:
      "When a client chats in the intake after completing it. One email until you read the in-app alert; {details} quotes the message.",
  },
  {
    ...adminTemplate(
      "narrative_viewed",
      "Client opened the narrative",
      "opened your outreach narrative",
    ),
    trigger:
      "The first time a client opens the outreach narrative you sent (each version). You always get an in-app notification; this email is optional.",
    defaultEnabled: false,
  },
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
    "Investor list changes requested",
    "asked for changes to the investor list",
  ),
  adminTemplate("email_copy_confirmed", "Email copy confirmed", "confirmed the email copy"),
  adminTemplate(
    "email_copy_changes_requested",
    "Email copy changes requested",
    "asked for changes to the email copy",
  ),
  {
    ...adminTemplate("launch_requested", "Launch approved: Go Live within 24 hours", "approved the launch"),
    trigger: "When a client approves the launch on their Go Live page. They were told it goes live within 24 hours; you click Go Live.",
  },
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
  WELCOME_TEMPLATE,
  ...CLIENT_TEMPLATES,
  QUESTION_ANSWERED_TEMPLATE,
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
  | "setup:framing"
  | "setup:investor_list"
  | "setup:email_copy"
  | "setup:go_live";

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
  { key: "setup:framing", label: "Outreach Narrative", defaults: timing(true) },
  { key: "setup:investor_list", label: "Investor List", defaults: timing(true) },
  { key: "setup:email_copy", label: "Email Copy", defaults: timing(true) },
  { key: "setup:go_live", label: "Go Live", defaults: timing(true) },
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
