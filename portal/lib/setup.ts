// Setup phase Turn Engine: step definitions, payload shapes and the rules that
// decide whose turn each step is. Pure module: safe on the server and in the
// browser. Every screen, email and reminder reads from here.

import { dropSectorFocus } from "@/lib/match/shared";

export type SetupStepId =
  | "materials"
  | "deck_review"
  | "framing"
  | "investor_list"
  | "email_copy";

/**
 * Stored status of a step row.
 * - materials:   "draft" (client filling in) → "submitted"
 * - deck_review / framing / investor_list / email_copy:
 *   "draft" → "with_client" → "confirmed" | "changes_requested" → (republish)
 *   The feedback is only ever confirmed. "published" is the status of
 *   feedback sent before the client confirmed it; it counts as confirmed.
 */
export type SetupRowStatus =
  | "draft"
  | "submitted"
  | "published"
  | "with_client"
  | "changes_requested"
  | "confirmed";

export type SetupDecision = "confirmed" | "changes_requested";

export type SetupResponse = {
  decision: SetupDecision;
  note: string;
  /** Per-item notes: investor row id → note, or "tier_1".."tier_3" for copy. */
  item_notes: Record<string, string>;
  /** Readable names for item_notes keys (fund names, tier names). */
  item_labels: Record<string, string>;
  version: number;
  at: string;
};

export type SetupHistoryEntry = {
  version: number;
  published_at: string;
  response: SetupResponse | null;
  /** When the client was emailed about this version. */
  emailed_at?: string | null;
};

/** Steps Rupert sends as a document: one action pushes it to the portal and emails the client. */
export type SetupDocumentStep = "deck_review" | "framing" | "investor_list";

export function isSetupDocumentStep(value: unknown): value is SetupDocumentStep {
  return value === "deck_review" || value === "framing" || value === "investor_list";
}

/** One row of `setup_steps`, as the app uses it. */
export type SetupStepState = {
  client_id: string;
  step: SetupStepId;
  status: SetupRowStatus;
  draft: unknown;
  published: unknown;
  version: number;
  published_at: string | null;
  response: SetupResponse | null;
  history: SetupHistoryEntry[];
  /** When the current turn (client's or Rupert's) began. */
  turn_since: string | null;
  completed_at: string | null;
  /** First time the client opened the current version (feedback only). */
  client_viewed_at: string | null;
  /** Recommendations the client ticked as done (feedback only): item id → when. */
  client_checks: Record<string, string>;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Payloads

export type MaterialFile = {
  path: string;
  name: string;
  size: number;
  type: string;
  uploaded_at: string;
};

export type MaterialsPayload = {
  files: MaterialFile[];
  /** Answers to the Company Materials fields, by field id. */
  fields: Record<string, string>;
};

// Analysis & Feedback (stored on the deck_review step). The draft is Rupert's
// workspace; the published payload is the client's view of it.

export type FeedbackArea = "deck" | "story" | "metrics" | "materials" | "other";
export type FeedbackPriority = "high" | "medium" | "low";

export const FEEDBACK_AREAS: { value: FeedbackArea; label: string }[] = [
  { value: "deck", label: "Deck" },
  { value: "story", label: "Story" },
  { value: "metrics", label: "Metrics" },
  { value: "materials", label: "Materials" },
  { value: "other", label: "Other" },
];

export const FEEDBACK_PRIORITIES: { value: FeedbackPriority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** A recommendation from feedback sent before the summary and framing became the feedback. */
export type FeedbackItem = {
  id: string;
  area: FeedbackArea;
  priority: FeedbackPriority;
  /** Slide reference, e.g. "4" or "6–7". Empty when not slide-specific. */
  slide: string;
  title: string;
  body: string;
  /** False kept the item internal: the client never saw it. */
  visible: boolean;
};

export type FeedbackLink = { id: string; label: string; url: string };

export type MaterialsAnalysis = {
  /** Company summary, written for the founder to read (markdown). */
  summary: string;
  /** Investor framing, written for the founder to read (markdown). */
  framing: string;
  generated_at: string;
  /** What the agent read, and what it could not (Rupert only). */
  read: string[];
  skipped: string[];
};

/** The email Rupert sends with a push. */
export type ClientEmailDraft = { subject: string; body: string };

export type FeedbackDraft = {
  analysis: MaterialsAnalysis | null;
  attachments: MaterialFile[];
  links: FeedbackLink[];
  /** The email that goes with the next push (saved with the draft). */
  client_email: ClientEmailDraft;
};

/**
 * What the client sees: the summary and framing, files and links. `intro`
 * and `items` exist only on feedback sent before that (a message and a list
 * of recommendations); they stay visible to those clients.
 */
export type FeedbackPublished = {
  summary: string;
  framing: string;
  intro: string;
  items: FeedbackItem[];
  attachments: MaterialFile[];
  links: FeedbackLink[];
};

// Outreach Narrative (stored on the framing step).

/** Shown under What happens next unless Rupert edits it for this client. */
export const NARRATIVE_NEXT_STEPS =
  "Once you confirm this and Rupert's feedback, he sends your matched investor list. After you confirm the list, he writes the email copy and sequence for each tier from these messages. You review those before anything is sent.";

export type NarrativePayload = {
  /** The core story (markdown). */
  core: string;
  /** 3–6 messages Rupert will carry into outreach (markdown). */
  key_messages: string;
  /** How Rupert will approach investors (markdown). */
  approach: string;
  /** What the client should expect after they confirm. */
  next_steps: string;
  /** Files and links Rupert shares with the narrative. */
  attachments: MaterialFile[];
  links: FeedbackLink[];
  /** Rupert's reply on versions pushed before the email went with each push. */
  admin_note?: string;
  /**
   * Outreach copy from narratives pushed before email copy moved to its own
   * step. Read-only. Empty on new narratives.
   */
  email_subject?: string;
  email_body?: string;
  linkedin_note?: string;
  linkedin_followup?: string;
  /**
   * Rupert only, never shown to the client: how the last rebuild handled the
   * founder's requested changes (markdown list).
   */
  change_summary?: string;
};

export const LINKEDIN_NOTE_MAX = 300;

export type FitTier = 1 | 2 | 3;

export type InvestorRow = {
  id: string;
  fund_name: string;
  contact: string;
  details: string;
  tier: FitTier;
  why: string;
  comments: string;
  /** The fund's website as a full http(s) link (lists sent from Rupert Match). */
  website?: string;
};

/** A fund website as a safe http(s) link, or "" when it isn't one. */
export function websiteHref(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

/** Funds and contact counts per tier, written by Rupert Match. No people. */
export type InvestorListSummary = {
  generated_at: string;
  tiers: {
    tier: FitTier;
    funds: number;
    contacts: number;
    by_type: { label: string; funds: number; contacts: number }[];
  }[];
};

export type InvestorListPayload = {
  rows: InvestorRow[];
  source_file: string;
  summary?: InvestorListSummary | null;
  /** Rupert's note when the list is sent back for the client to confirm. */
  admin_note?: string;
};

export type CopyEmail = { subject: string; body: string };

/** Three emails per tier: the first email and two follow-ups. */
export type EmailCopyPayload = {
  tiers: Record<`${FitTier}`, CopyEmail[]>;
  /** One LinkedIn connection note for every tier. 300 characters or fewer. */
  linkedin_note?: string;
  /** One LinkedIn follow-up for every tier. */
  linkedin_followup?: string;
  /** Rupert's reply when this version is sent back for confirmation. */
  admin_note?: string;
};

export const FIT_TIERS: { tier: FitTier; label: string; detail: string }[] = [
  { tier: 1, label: "Tier 1", detail: "Best fit" },
  { tier: 2, label: "Tier 2", detail: "Strong fit" },
  { tier: 3, label: "Tier 3", detail: "Possible fit" },
];

export const EMAIL_SEQUENCE_LABELS = [
  "First email",
  "Follow-up 1",
  "Follow-up 2",
] as const;

export function tierLabel(tier: FitTier) {
  const entry = FIT_TIERS.find((item) => item.tier === tier);
  return entry ? `${entry.label} · ${entry.detail}` : `Tier ${tier}`;
}

// ---------------------------------------------------------------------------
// Steps

export type SetupStepDefinition = {
  id: SetupStepId;
  title: string;
  /** Short label for "Waiting on client: …" and reminder emails. */
  short: string;
  href: string;
  /** What the client is asked to do when it is their turn. */
  clientTask: string;
  /** What Rupert has to do when it is his turn. */
  adminAction: string;
  /** "client" steps are filled in by the client; "review" steps need the
   * client to confirm. */
  kind: "client" | "review";
};

/** Stored on `setup_steps`, shown as the last Onboarding step. */
export const MATERIALS_STEP: SetupStepDefinition = {
  id: "materials",
  title: "Company Materials",
  short: "Company Materials",
  href: "/portal/materials",
  clientTask: "share your pitch deck and company materials",
  adminAction: "Review company materials",
  kind: "client",
};

export const SETUP_STEPS: SetupStepDefinition[] = [
  {
    id: "deck_review",
    title: "Analysis & Feedback",
    short: "Analysis & Feedback",
    href: "/portal/setup/deck-review",
    clientTask: "read Rupert's feedback on your materials and confirm",
    adminAction: "Analyze the materials and send the feedback",
    kind: "review",
  },
  {
    id: "framing",
    title: "Outreach Narrative",
    short: "Outreach Narrative",
    href: "/portal/setup/framing",
    clientTask: "review and confirm the outreach narrative",
    adminAction: "Build the outreach narrative",
    kind: "review",
  },
  {
    id: "investor_list",
    title: "Investor Matching",
    short: "Investor List",
    href: "/portal/setup/investor-list",
    clientTask: "review and confirm your matched investor list",
    adminAction: "Push the list from Rupert Match and send it",
    kind: "review",
  },
  {
    id: "email_copy",
    title: "Email Copy",
    short: "Email Copy",
    href: "/portal/setup/email-copy",
    clientTask: "review and confirm the outreach emails",
    adminAction: "Write the email copy for the 3 tiers",
    kind: "review",
  },
];

export const SETUP_TOTAL = SETUP_STEPS.length;

const STEP_BY_ID = new Map<SetupStepId, SetupStepDefinition>([
  [MATERIALS_STEP.id, MATERIALS_STEP],
  ...SETUP_STEPS.map((step) => [step.id, step] as const),
]);

export function setupStep(id: SetupStepId) {
  return STEP_BY_ID.get(id)!;
}

export function isSetupStepId(value: unknown): value is SetupStepId {
  return typeof value === "string" && STEP_BY_ID.has(value as SetupStepId);
}

/**
 * Setup is open once the stage is setup or live. The stage moves to setup
 * when Company Materials are submitted. A client already in setup stays open
 * even if materials are later sent back.
 */
export function isSetupOpen(stage?: string | null) {
  return stage === "setup" || stage === "live";
}

/**
 * Whose turn a step is, from the client's side:
 * - "your_turn": the client's
 * - "waiting":   Rupert's
 * - "done"
 * - "open":      not reachable yet
 */
export type SetupItemStatus = "done" | "your_turn" | "waiting" | "open";

export type SetupItem = SetupStepDefinition & {
  status: SetupItemStatus;
  detail: string;
  /** When the current turn began (for reminders and admin context). */
  since: string | null;
  completedAt: string | null;
  /** True when Rupert has published something the client can open. */
  visible: boolean;
};

export type SetupSource = {
  stage?: string | null;
  intake_completed_at?: string | null;
  setup_steps?: SetupStepState[] | null;
};

function rowFor(rows: SetupStepState[] | null | undefined, id: SetupStepId) {
  return rows?.find((row) => row.step === id) ?? null;
}

/** The later of two timestamps, or null when neither is set. */
function latest(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return a || b || null;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Feedback the client confirmed, or feedback sent before confirming existed. */
export function isFeedbackConfirmed(row: SetupStepState | null | undefined) {
  return row?.status === "confirmed" || row?.status === "published";
}

/** True once Rupert has pushed this step: the client can open it. */
export function isSharedWithClient(row: SetupStepState | null | undefined) {
  return Boolean(row && row.version > 0 && row.status !== "draft");
}

/** Why the investor list cannot be sent yet, in Rupert's words. */
export const INVESTOR_LIST_BLOCKED =
  "Available once the client confirms the Analysis & Feedback and the outreach narrative.";

/**
 * Both the feedback and the narrative are confirmed and no investor list has
 * been sent yet: Rupert's next move is the investor list.
 */
export function readyForInvestorList(source: SetupSource | null | undefined) {
  const rows = source?.setup_steps ?? [];
  const list = rowFor(rows, "investor_list");
  return (
    isFeedbackConfirmed(rowFor(rows, "deck_review")) &&
    rowFor(rows, "framing")?.status === "confirmed" &&
    (list?.version ?? 0) === 0
  );
}

export function getSetupItems(source: SetupSource | null | undefined): SetupItem[] {
  const rows = source?.setup_steps ?? [];

  const materials = rowFor(rows, "materials");
  const deck = rowFor(rows, "deck_review");
  const framing = rowFor(rows, "framing");
  const list = rowFor(rows, "investor_list");
  const copy = rowFor(rows, "email_copy");

  const materialsDone = materials?.status === "submitted";
  const feedbackDone = isFeedbackConfirmed(deck);
  const framingDone = framing?.status === "confirmed";
  const listDone = list?.status === "confirmed";

  const items: SetupItem[] = [];

  // Every Setup step: Rupert pushes, the client confirms (or asks for changes).
  const reviewItem = (
    id: Exclude<SetupStepId, "materials">,
    row: SetupStepState | null,
    reachable: boolean,
    blockedDetail: string,
    preparingDetail: string,
    reachableSince: string | null,
  ): SetupItem => {
    const step = setupStep(id);
    if (!reachable) {
      return {
        ...step,
        status: "open",
        detail: blockedDetail,
        since: null,
        completedAt: null,
        visible: false,
      };
    }
    if (row?.status === "confirmed" || row?.status === "published") {
      return {
        ...step,
        status: "done",
        detail: "Confirmed",
        since: null,
        completedAt: row.completed_at,
        visible: true,
      };
    }
    if (row?.status === "with_client") {
      return {
        ...step,
        status: "your_turn",
        detail:
          row.version > 1 ? "Updated — review and confirm" : "Review and confirm",
        since: row.turn_since ?? row.published_at,
        completedAt: null,
        visible: true,
      };
    }
    if (row?.status === "changes_requested") {
      return {
        ...step,
        status: "waiting",
        detail: "Rupert is working on your feedback",
        since: row.turn_since ?? row.response?.at ?? null,
        completedAt: null,
        visible: true,
      };
    }
    return {
      ...step,
      status: "waiting",
      detail: preparingDetail,
      since: reachableSince,
      completedAt: null,
      visible: false,
    };
  };

  // 1–2. Analysis & Feedback, then the Outreach Narrative. Both open when
  // the materials are submitted (the last Onboarding step); Rupert can push
  // the narrative before the feedback is confirmed. Anything already pushed
  // stays visible if the materials are sent back.
  items.push(
    reviewItem(
      "deck_review",
      deck,
      materialsDone || (deck?.version ?? 0) > 0,
      "After you share your materials",
      "Rupert is reviewing your materials",
      materials?.completed_at ?? null,
    ),
  );
  items.push(
    reviewItem(
      "framing",
      framing,
      materialsDone || (framing?.version ?? 0) > 0,
      "After you share your materials",
      "Rupert is writing your outreach narrative",
      materials?.completed_at ?? null,
    ),
  );
  // 3. The investor list opens once the client has confirmed both. A list
  // Rupert already sent stays the client's to review.
  const listReady = (feedbackDone && framingDone) || (list?.version ?? 0) > 0;
  items.push(
    reviewItem(
      "investor_list",
      list,
      listReady,
      "After you confirm the feedback and the outreach narrative",
      "Rupert is matching investors",
      latest(deck?.completed_at, framing?.completed_at) ?? list?.updated_at ?? null,
    ),
  );
  items.push(
    reviewItem(
      "email_copy",
      copy,
      listDone,
      "After the investor list is confirmed",
      "Rupert is writing your outreach emails",
      list?.completed_at ?? null,
    ),
  );

  return items;
}

export function setupProgress(source: SetupSource | null | undefined) {
  const complete = getSetupItems(source).filter(
    (item) => item.status === "done",
  ).length;
  return { complete, total: SETUP_TOTAL };
}

export function isSetupComplete(source: SetupSource | null | undefined) {
  return setupProgress(source).complete === SETUP_TOTAL;
}

/** Steps where Rupert may publish now (the step is reachable). */
export function canPublish(
  source: SetupSource | null | undefined,
  id: SetupStepId,
) {
  const item = getSetupItems(source).find((entry) => entry.id === id);
  return Boolean(item && item.status !== "open" && id !== "materials");
}

// ---------------------------------------------------------------------------
// Payload parsing (database jsonb → typed, defensive)

function str(value: unknown, max = 20000) {
  return value != null ? String(value).slice(0, max) : "";
}

export function asMaterials(value: unknown): MaterialsPayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const files = Array.isArray(raw.files)
    ? raw.files
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
        .map((item) => ({
          path: str(item.path, 500),
          name: str(item.name, 255),
          size: Number(item.size) || 0,
          type: str(item.type, 120),
          uploaded_at: str(item.uploaded_at, 40),
        }))
        .filter((item) => item.path)
    : [];
  const fields: Record<string, string> = {};
  const rawFields =
    raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields)
      ? (raw.fields as Record<string, unknown>)
      : {};
  for (const [id, text] of Object.entries(rawFields)) {
    if (/^[a-z0-9_]{1,40}$/.test(id)) fields[id] = str(text);
  }
  // Answers saved before the fields were editable.
  for (const legacy of ["company_text", "other_inputs"]) {
    if (fields[legacy] === undefined && raw[legacy] != null) {
      fields[legacy] = str(raw[legacy]);
    }
  }
  return { files, fields };
}

function asFiles(value: unknown): MaterialFile[] {
  return asMaterials({ files: value }).files;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const AREA_VALUES = FEEDBACK_AREAS.map((area) => area.value);
const PRIORITY_VALUES = FEEDBACK_PRIORITIES.map((priority) => priority.value);

export const FEEDBACK_ITEMS_MAX = 60;
export const FEEDBACK_LINKS_MAX = 20;

export function asFeedbackItems(value: unknown): FeedbackItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .slice(0, FEEDBACK_ITEMS_MAX)
    .map((item, index) => ({
      id: str(item.id, 40) || `f${index + 1}`,
      area: oneOf(item.area, AREA_VALUES, "other"),
      priority: oneOf(item.priority, PRIORITY_VALUES, "medium"),
      slide: str(item.slide, 40),
      title: str(item.title, 200),
      body: str(item.body, 5000),
      visible: item.visible !== false,
    }));
}

function asLinks(value: unknown): FeedbackLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .slice(0, FEEDBACK_LINKS_MAX)
    .map((item, index) => ({
      id: str(item.id, 40) || `l${index + 1}`,
      label: str(item.label, 200),
      url: str(item.url, 2000),
    }))
    .filter((link) => link.url);
}

function asStringList(value: unknown, max = 40) {
  return Array.isArray(value)
    ? value.map((item) => str(item, 500)).filter(Boolean).slice(0, max)
    : [];
}

function asAnalysis(value: unknown): MaterialsAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const summary = str(raw.summary, 30000);
  const framing = str(raw.framing, 30000);
  if (!summary && !framing) return null;
  return {
    summary,
    framing,
    generated_at: str(raw.generated_at, 40),
    read: asStringList(raw.read),
    skipped: asStringList(raw.skipped),
  };
}

export const EMAIL_SUBJECT_MAX = 300;
export const EMAIL_BODY_MAX = 10000;

/** The email saved with a draft. */
export function asClientEmail(value: unknown): ClientEmailDraft {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    subject: str(raw.subject, EMAIL_SUBJECT_MAX),
    body: str(raw.body, EMAIL_BODY_MAX),
  };
}

/** Rupert's feedback workspace: the summary and framing, files, links and the email. */
export function asFeedback(value: unknown): FeedbackDraft {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    analysis: asAnalysis(raw.analysis),
    attachments: asFiles(raw.attachments),
    links: asLinks(raw.links),
    client_email: asClientEmail(raw.client_email),
  };
}

/** The part of the feedback the client sees (never what the AI read). */
export function feedbackForClient(draft: FeedbackDraft): FeedbackPublished {
  return {
    summary: draft.analysis?.summary ?? "",
    framing: draft.analysis?.framing ?? "",
    intro: "",
    items: [],
    attachments: draft.attachments,
    links: draft.links,
  };
}

/** Older feedback stored the message as `body`; recommendations hidden from the client are dropped. */
export function asFeedbackPublished(value: unknown): FeedbackPublished {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    summary: str(raw.summary, 30000),
    framing: str(raw.framing, 30000),
    intro: str(raw.intro ?? raw.body, 30000),
    items: asFeedbackItems(raw.items).filter((item) => item.visible && (item.title || item.body)),
    attachments: asFiles(raw.attachments),
    links: asLinks(raw.links),
  };
}

/** Ticked items, kept only if they still exist in the published feedback. */
export function feedbackChecks(
  checks: Record<string, string>,
  items: FeedbackItem[],
) {
  const ids = new Set(items.map((item) => item.id));
  return Object.keys(checks).filter((id) => ids.has(id));
}

export function feedbackProblem(draft: FeedbackDraft) {
  if (!draft.analysis?.summary.trim()) return "Write the Company Summary before sending.";
  if (!draft.analysis.framing.trim()) return "Write the Investor Framing before sending.";
  return null;
}

/** Why the email cannot go yet, or null. */
export function clientEmailProblem(email: ClientEmailDraft) {
  if (!email.subject.trim()) return "Add a subject to the email.";
  if (!email.body.trim()) return "Write the email (Draft Email writes one for you).";
  return null;
}

/**
 * Files Rupert shares in Setup (feedback and narrative) live under this
 * storage folder. The name predates the narrative sharing it.
 */
export function setupFilesFolder(clientId: string) {
  return `${clientId}/feedback/`;
}

function optionalText(value: unknown, max: number) {
  const text = str(value, max).trim();
  return text || undefined;
}

/** Older rows stored the framing as one markdown `body`: it becomes the core. */
export function asNarrative(value: unknown): NarrativePayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const nextSteps = str(raw.next_steps, 2000).trim();
  return {
    core: str(raw.core ?? raw.body, 30000),
    key_messages: str(raw.key_messages, 20000),
    approach: str(raw.approach, 20000),
    next_steps: nextSteps || NARRATIVE_NEXT_STEPS,
    attachments: asFiles(raw.attachments),
    links: asLinks(raw.links),
    admin_note: str(raw.admin_note, NOTE_MAX).trim() || undefined,
    email_subject: optionalText(raw.email_subject, 300),
    email_body: optionalText(raw.email_body, 10000),
    linkedin_note: optionalText(raw.linkedin_note, 2000),
    linkedin_followup: optionalText(raw.linkedin_followup, 5000),
    change_summary: optionalText(raw.change_summary, 5000),
  };
}

/** What the client sees of a narrative: everything except Rupert's change summary. */
export function narrativeForClient(value: unknown): NarrativePayload {
  return { ...asNarrative(value), change_summary: undefined };
}

export function narrativeHasEarlierDraft(narrative: NarrativePayload) {
  return Boolean(
    narrative.email_subject ||
      narrative.email_body ||
      narrative.linkedin_note ||
      narrative.linkedin_followup,
  );
}

export function narrativeProblem(narrative: NarrativePayload) {
  if (!narrative.core.trim()) return "Write the core story before sending.";
  if (!narrative.key_messages.trim()) return "Add the key messages before sending.";
  if (!narrative.approach.trim()) return "Describe how you'll approach investors before sending.";
  return null;
}

function asTier(value: unknown): FitTier | null {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

export function asInvestorList(value: unknown): InvestorListPayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const rows = Array.isArray(raw.rows)
    ? raw.rows
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
        .map((item, index) => ({
          id: str(item.id, 40) || `r${index + 1}`,
          fund_name: str(item.fund_name, INVESTOR_FIELD_MAX),
          contact: str(item.contact, INVESTOR_FIELD_MAX),
          details: str(item.details, INVESTOR_FIELD_MAX),
          tier: asTier(item.tier) ?? 3,
          why: dropSectorFocus(str(item.why, INVESTOR_FIELD_MAX)),
          comments: str(item.comments, INVESTOR_FIELD_MAX),
          website: websiteHref(str(item.website, 500)) || undefined,
        }))
    : [];
  const adminNote = str(raw.admin_note, NOTE_MAX).trim();
  return {
    rows,
    source_file: str(raw.source_file, 255),
    summary: asInvestorListSummary(raw.summary),
    admin_note: adminNote || undefined,
  };
}

/** Rupert's investor list draft: the list from Rupert Match and the email that goes with it. */
export type InvestorListDraft = InvestorListPayload & { client_email: ClientEmailDraft };

export function asInvestorListDraft(value: unknown): InvestorListDraft {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { ...asInvestorList(value), client_email: asClientEmail(raw.client_email) };
}

/** What the client sees of the draft: never the email. */
export function investorListForClient(draft: InvestorListPayload): InvestorListPayload {
  return {
    rows: draft.rows,
    source_file: draft.source_file,
    summary: draft.summary ?? null,
    admin_note: draft.admin_note,
  };
}

/** Why the investor list cannot be sent yet, or null. */
export function investorListProblem(draft: InvestorListPayload) {
  return draft.rows.length === 0 ? "Push the list from Rupert Match first." : null;
}

function count(value: unknown) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function asInvestorListSummary(value: unknown): InvestorListSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.tiers)) return null;
  const tiers = raw.tiers
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .map((item) => ({
      tier: asTier(item.tier),
      funds: count(item.funds),
      contacts: count(item.contacts),
      by_type: (Array.isArray(item.by_type) ? item.by_type : [])
        .filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object",
        )
        .slice(0, 10)
        .map((entry) => ({
          label: str(entry.label, 60),
          funds: count(entry.funds),
          contacts: count(entry.contacts),
        })),
    }))
    .filter(
      (item): item is InvestorListSummary["tiers"][number] => item.tier !== null,
    );
  return tiers.length > 0
    ? { generated_at: str(raw.generated_at, 40), tiers }
    : null;
}

export function emptyEmailCopy(): EmailCopyPayload {
  const sequence = () =>
    EMAIL_SEQUENCE_LABELS.map(() => ({ subject: "", body: "" }));
  return { tiers: { "1": sequence(), "2": sequence(), "3": sequence() } };
}

export function asEmailCopy(value: unknown): EmailCopyPayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const tiers = (raw.tiers && typeof raw.tiers === "object"
    ? raw.tiers
    : {}) as Record<string, unknown>;
  const result = emptyEmailCopy();
  for (const { tier } of FIT_TIERS) {
    const list = Array.isArray(tiers[String(tier)]) ? (tiers[String(tier)] as unknown[]) : [];
    result.tiers[`${tier}`] = EMAIL_SEQUENCE_LABELS.map((_, index) => {
      const item = (list[index] && typeof list[index] === "object"
        ? list[index]
        : {}) as Record<string, unknown>;
      return { subject: str(item.subject, 300), body: str(item.body, 10000) };
    });
  }
  const adminNote = str(raw.admin_note, NOTE_MAX).trim();
  const linkedinNote = str(raw.linkedin_note, 2000).trim();
  const linkedinFollowup = str(raw.linkedin_followup, 10000).trim();
  return {
    ...result,
    ...(adminNote ? { admin_note: adminNote } : {}),
    ...(linkedinNote ? { linkedin_note: linkedinNote } : {}),
    ...(linkedinFollowup ? { linkedin_followup: linkedinFollowup } : {}),
  };
}

/** Problems that stop the email copy from being pushed. */
export function emailCopyProblems(copy: EmailCopyPayload) {
  const problems: string[] = [];
  for (const { tier, label } of FIT_TIERS) {
    const emails = copy.tiers[`${tier}`];
    if (!emails[0]?.subject.trim()) {
      problems.push(`${label}: the first email needs a subject.`);
    }
    emails.forEach((email, index) => {
      if (!email.body.trim()) {
        problems.push(`${label}: ${EMAIL_SEQUENCE_LABELS[index]} has no body.`);
      }
    });
  }
  const linkedin = copy.linkedin_note?.trim() ?? "";
  if (linkedin.length > LINKEDIN_NOTE_MAX) {
    problems.push(
      `The LinkedIn connection note is ${linkedin.length} characters. Keep it to ${LINKEDIN_NOTE_MAX}.`,
    );
  }
  return problems;
}

export function asResponse(value: unknown): SetupResponse | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.decision !== "confirmed" && raw.decision !== "changes_requested") {
    return null;
  }
  const notes =
    raw.item_notes && typeof raw.item_notes === "object"
      ? (raw.item_notes as Record<string, unknown>)
      : {};
  const item_notes: Record<string, string> = {};
  for (const [key, note] of Object.entries(notes)) {
    const text = str(note, NOTE_MAX).trim();
    if (text) item_notes[str(key, 40)] = text;
  }
  const labels =
    raw.item_labels && typeof raw.item_labels === "object"
      ? (raw.item_labels as Record<string, unknown>)
      : {};
  const item_labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(labels)) {
    item_labels[str(key, 40)] = str(label, 300);
  }
  return {
    decision: raw.decision,
    note: str(raw.note, NOTE_MAX),
    item_notes,
    item_labels,
    version: Number(raw.version) || 0,
    at: str(raw.at, 40),
  };
}

export const NOTE_MAX = 4000;

// ---------------------------------------------------------------------------
// Investor list

export const INVESTOR_FIELD_MAX = 4000;

export function tierCounts(rows: InvestorRow[]) {
  return FIT_TIERS.map(({ tier }) => ({
    tier,
    count: rows.filter((row) => row.tier === tier).length,
  }));
}

// ---------------------------------------------------------------------------
// Uploads

export const MATERIALS_BUCKET = "client-materials";
export const MATERIAL_MAX_BYTES = 50 * 1024 * 1024;
export const MATERIAL_MAX_FILES = 20;
export const MATERIAL_EXTENSIONS = [
  "pdf",
  "ppt",
  "pptx",
  "key",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "md",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
];

export function fileExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
