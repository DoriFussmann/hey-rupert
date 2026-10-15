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
 * - deck_review: "draft" (Rupert writing)   → "published"
 * - framing / investor_list / email_copy:
 *   "draft" → "with_client" → "confirmed" | "changes_requested" → (republish)
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
};

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

export type FeedbackItem = {
  id: string;
  area: FeedbackArea;
  priority: FeedbackPriority;
  /** Slide reference, e.g. "4" or "6–7". Empty when not slide-specific. */
  slide: string;
  title: string;
  body: string;
  /** False keeps the item internal: the client never sees it. */
  visible: boolean;
};

export type FeedbackLink = { id: string; label: string; url: string };

export type MaterialsAnalysis = {
  /** Internal company summary for Rupert. */
  summary: string;
  /** Internal investor framing: positioning, angles, weak spots. */
  framing: string;
  generated_at: string;
  /** What the agent read, and what it could not. */
  read: string[];
  skipped: string[];
};

export type FeedbackEmail = { subject: string; body: string };

export type FeedbackDraft = {
  analysis: MaterialsAnalysis | null;
  /** Opening message to the client, above the recommendations (markdown). */
  intro: string;
  items: FeedbackItem[];
  attachments: MaterialFile[];
  links: FeedbackLink[];
  email: FeedbackEmail;
};

/** What the client sees. */
export type FeedbackPublished = {
  intro: string;
  items: FeedbackItem[];
  attachments: MaterialFile[];
  links: FeedbackLink[];
};

// Outreach Narrative (stored on the framing step).

/** Shown under What happens next unless Rupert edits it for this client. */
export const NARRATIVE_NEXT_STEPS =
  "Once you confirm this and the investor list is matched, Rupert writes the email copy and sequence for each tier from these messages. You review those before anything is sent.";

export type NarrativePayload = {
  /** The core story (markdown). */
  core: string;
  /** 3–6 messages Rupert will carry into outreach (markdown). */
  key_messages: string;
  /** How Rupert will approach investors (markdown). */
  approach: string;
  /** What the client should expect after they confirm. */
  next_steps: string;
  /** Rupert's reply when this version is sent back for confirmation. */
  admin_note?: string;
  /**
   * Outreach copy from narratives pushed before email copy moved to its own
   * step. Read-only. Empty on new narratives.
   */
  email_subject?: string;
  email_body?: string;
  linkedin_note?: string;
  linkedin_followup?: string;
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
   * client to confirm; "inform" steps are published for the client to read. */
  kind: "client" | "inform" | "review";
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
    clientTask: "read Rupert's feedback on your materials",
    adminAction: "Analyze the materials and send feedback",
    kind: "inform",
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
    adminAction: "Upload the matched investor list",
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

export function getSetupItems(source: SetupSource | null | undefined): SetupItem[] {
  const rows = source?.setup_steps ?? [];

  const materials = rowFor(rows, "materials");
  const deck = rowFor(rows, "deck_review");
  const framing = rowFor(rows, "framing");
  const list = rowFor(rows, "investor_list");
  const copy = rowFor(rows, "email_copy");

  const materialsDone = materials?.status === "submitted";
  const framingDone = framing?.status === "confirmed";
  const listDone = list?.status === "confirmed";

  const items: SetupItem[] = [];

  // 1. Analysis & Feedback. Company Materials is the last Onboarding step.
  // Feedback already sent stays visible if materials are sent back.
  const deckDone = deck?.status === "published";
  const deckReachable = materialsDone || deckDone;
  items.push({
    ...setupStep("deck_review"),
    status: !deckReachable ? "open" : deckDone ? "done" : "waiting",
    detail: !deckReachable
      ? "After you share your materials"
      : deckDone
        ? "Feedback ready"
        : "Rupert is reviewing your materials",
    since: !materialsDone || deckDone ? null : materials?.completed_at ?? null,
    completedAt: deck?.completed_at ?? null,
    visible: deckDone,
  });

  // 3–5. Review steps: Rupert publishes, the client confirms or asks.
  const reviewItem = (
    id: "framing" | "investor_list" | "email_copy",
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
    if (row?.status === "confirmed") {
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

  items.push(
    reviewItem(
      "framing",
      framing,
      materialsDone,
      "After you share your materials",
      "Rupert is writing your outreach narrative",
      materials?.completed_at ?? null,
    ),
  );
  // A list Rupert already sent is the client's to review, even before the
  // outreach narrative is confirmed. A saved draft can be pushed from Setup.
  const listReady =
    framingDone ||
    (list?.version ?? 0) > 0 ||
    asInvestorList(list?.draft).rows.length > 0;
  items.push(
    reviewItem(
      "investor_list",
      list,
      listReady,
      "After the outreach narrative is confirmed",
      "Rupert is matching investors",
      framing?.completed_at ?? list?.updated_at ?? null,
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

/** Rupert's feedback workspace. Older rows stored a single markdown `body`,
 * which becomes the intro. */
export function asFeedback(value: unknown): FeedbackDraft {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const email = (raw.email && typeof raw.email === "object"
    ? raw.email
    : {}) as Record<string, unknown>;
  return {
    analysis: asAnalysis(raw.analysis),
    intro: str(raw.intro ?? raw.body, 30000),
    items: asFeedbackItems(raw.items),
    attachments: asFiles(raw.attachments),
    links: asLinks(raw.links),
    email: { subject: str(email.subject, 300), body: str(email.body, 10000) },
  };
}

/**
 * The part of the feedback the client sees. The message is stored as both
 * `email.body` and `intro`; older rows may have only one of them.
 */
export function feedbackForClient(draft: FeedbackDraft): FeedbackPublished {
  return {
    intro: draft.email.body.trim() || draft.intro,
    items: draft.items.filter((item) => item.visible && (item.title || item.body)),
    attachments: draft.attachments,
    links: draft.links,
  };
}

export function asFeedbackPublished(value: unknown): FeedbackPublished {
  return feedbackForClient(asFeedback(value));
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
  const published = feedbackForClient(draft);
  if (!published.intro.trim() && published.items.length === 0) {
    return "Add a message to the client or at least one recommendation the client can see.";
  }
  return null;
}

/** Files Rupert attaches to the feedback live under this storage folder. */
export function feedbackFolder(clientId: string) {
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
    admin_note: str(raw.admin_note, NOTE_MAX).trim() || undefined,
    email_subject: optionalText(raw.email_subject, 300),
    email_body: optionalText(raw.email_body, 10000),
    linkedin_note: optionalText(raw.linkedin_note, 2000),
    linkedin_followup: optionalText(raw.linkedin_followup, 5000),
  };
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
  if (!narrative.core.trim()) return "Write the core story before pushing.";
  if (!narrative.key_messages.trim()) return "Add the key messages before pushing.";
  if (!narrative.approach.trim()) return "Describe how you'll approach investors before pushing.";
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
          fund_name: str(item.fund_name, CSV_FIELD_MAX),
          contact: str(item.contact, CSV_FIELD_MAX),
          details: str(item.details, CSV_FIELD_MAX),
          tier: asTier(item.tier) ?? 3,
          why: dropSectorFocus(str(item.why, CSV_FIELD_MAX)),
          comments: str(item.comments, CSV_FIELD_MAX),
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
// Investor list CSV

export const CSV_FIELD_MAX = 4000;
export const CSV_ROWS_MAX = 1000;

/** Expected columns, in template order, with the header names we accept. */
export const INVESTOR_CSV_COLUMNS: {
  key: keyof Omit<InvestorRow, "id">;
  header: string;
  aliases: string[];
  required: boolean;
}[] = [
  {
    key: "fund_name",
    header: "Fund Name",
    aliases: ["fund name", "fund", "firm", "investor", "fund/firm"],
    required: true,
  },
  {
    key: "contact",
    header: "Fund Point of Contact",
    aliases: [
      "fund point of contact",
      "point of contact",
      "contact",
      "poc",
      "partner",
      "contact name",
    ],
    required: false,
  },
  {
    key: "details",
    header: "General Details",
    aliases: ["general details", "details", "description", "about", "info"],
    required: false,
  },
  {
    key: "tier",
    header: "Fit Level",
    aliases: ["fit level", "fit", "tier", "fit tier", "level"],
    required: true,
  },
  {
    key: "why",
    header: "Why It Works",
    aliases: ["why it works", "why", "rationale", "reason", "why fit"],
    required: false,
  },
  {
    key: "comments",
    header: "Comments",
    aliases: ["comments", "comment", "notes", "note"],
    required: false,
  },
];

export const INVESTOR_CSV_TEMPLATE =
  INVESTOR_CSV_COLUMNS.map((column) => column.header).join(",") +
  "\n" +
  [
    "Example Ventures",
    "Jane Smith (Partner)",
    "Seed fund · $500k–$2M checks · NYC",
    "Tier 1",
    "Leads seed rounds in B2B health; portfolio overlap with your buyer",
    "Warm intro possible via portfolio founder",
  ]
    .map(csvCell)
    .join(",") +
  "\n";

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180-style parser: quoted fields, escaped quotes, newlines in quotes. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : (firstLine.match(/\t/g)?.length ?? 0) >
          (firstLine.match(/,/g)?.length ?? 0)
        ? "\t"
        : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** "Tier 1", "1", "T1", "High", "A", "Best" → 1, and so on. */
export function parseFitLevel(value: string): FitTier | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  const digit = text.match(/[123]/);
  if (digit) return Number(digit[0]) as FitTier;
  if (["high", "a", "best", "best fit", "top", "strong"].includes(text)) return 1;
  if (["medium", "med", "mid", "b", "good", "good fit"].includes(text)) return 2;
  if (["low", "c", "possible", "possible fit", "stretch", "weak"].includes(text)) {
    return 3;
  }
  return null;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

export type InvestorCsvResult =
  | { ok: true; rows: InvestorRow[]; warnings: string[] }
  | { ok: false; errors: string[] };

export function parseInvestorCsv(input: string): InvestorCsvResult {
  const table = parseCsv(input);
  if (table.length === 0) return { ok: false, errors: ["The file is empty."] };

  const header = table[0].map(normalizeHeader);
  const indexes = new Map<string, number>();
  for (const column of INVESTOR_CSV_COLUMNS) {
    const index = header.findIndex((cell) => column.aliases.includes(cell));
    if (index >= 0) indexes.set(column.key, index);
  }

  const missing = INVESTOR_CSV_COLUMNS.filter(
    (column) => column.required && !indexes.has(column.key),
  ).map((column) => column.header);
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [
        `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected headers: ${INVESTOR_CSV_COLUMNS.map((column) => column.header).join(", ")}.`,
      ],
    };
  }

  const body = table.slice(1);
  if (body.length === 0) {
    return { ok: false, errors: ["The file has headers but no investors."] };
  }
  if (body.length > CSV_ROWS_MAX) {
    return {
      ok: false,
      errors: [`Too many rows (${body.length}). The limit is ${CSV_ROWS_MAX}.`],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: InvestorRow[] = [];
  const cell = (cells: string[], key: string) => {
    const index = indexes.get(key);
    return index == null ? "" : (cells[index] ?? "").trim();
  };

  body.forEach((cells, index) => {
    const line = index + 2;
    const fund = cell(cells, "fund_name");
    const fitRaw = cell(cells, "tier");
    if (!fund) {
      errors.push(`Row ${line}: Fund Name is empty.`);
      return;
    }
    const tier = parseFitLevel(fitRaw);
    if (!tier) {
      errors.push(
        `Row ${line} (${fund}): Fit Level "${fitRaw}" is not Tier 1, Tier 2 or Tier 3.`,
      );
      return;
    }
    const long = INVESTOR_CSV_COLUMNS.some(
      (column) => cell(cells, column.key).length > CSV_FIELD_MAX,
    );
    if (long) {
      warnings.push(`Row ${line} (${fund}): a long field was shortened.`);
    }
    rows.push({
      id: `r${rows.length + 1}`,
      fund_name: fund.slice(0, CSV_FIELD_MAX),
      contact: cell(cells, "contact").slice(0, CSV_FIELD_MAX),
      details: cell(cells, "details").slice(0, CSV_FIELD_MAX),
      tier,
      why: cell(cells, "why").slice(0, CSV_FIELD_MAX),
      comments: cell(cells, "comments").slice(0, CSV_FIELD_MAX),
    });
  });

  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = row.fund_name.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = Array.from(seen.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  if (duplicates.length > 0) {
    warnings.push(
      `Listed more than once: ${duplicates.join(", ")}. Fine if they are different contacts.`,
    );
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows, warnings };
}

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
