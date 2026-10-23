// Setup phase Turn Engine: step definitions, payload shapes and the rules that
// decide whose turn each step is. Pure module: safe on the server and in the
// browser. Every screen, email and reminder reads from here.

import { dropSectorFocus } from "./match/shared.ts";

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
export type SetupDocumentStep = "framing" | "investor_list";

export function isSetupDocumentStep(value: unknown): value is SetupDocumentStep {
  return value === "framing" || value === "investor_list";
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
  /** The founder's reason for having no deck yet (said in the intake). Empty otherwise. */
  no_deck: string;
};

/** Longest "no deck yet" reason the founder can give. */
export const NO_DECK_MAX = 500;

/** The client's materials as they stand: what was submitted, or the draft. */
export type MaterialsView = {
  files: MaterialFile[];
  noDeck: string;
  submitted: boolean;
};

// Analysis & Feedback (stored on the deck_review step): feedback sent as its
// own step before the Company Materials Feedback moved into the Outreach
// Narrative. Read only: clients who received it can still open it.

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

/**
 * Company Materials Feedback: Rupert's read of the company and what to
 * improve in the materials. Sent with the Outreach Narrative, for the
 * founder to read; it is never confirmed.
 */
export type MaterialsFeedback = {
  /** How Rupert reads the company (markdown). */
  summary: string;
  /** What to improve in the deck and materials, by priority (markdown). */
  improvements: string;
  /** Rupert only: when Analyze ran, and what the AI read or could not. */
  generated_at: string;
  read: string[];
  skipped: string[];
};

/** The client's comment on the Company Materials Feedback, kept with their answer on the narrative. */
export const MATERIALS_FEEDBACK_NOTE_KEY = "materials_feedback";

/** The email Rupert sends with a push. */
export type ClientEmailDraft = {
  subject: string;
  body: string;
  /** Investor-list letter only. Inserted after the opening paragraph when the email is shown or sent. */
  note?: string;
};

export type FeedbackDraft = {
  analysis: MaterialsAnalysis | null;
  attachments: MaterialFile[];
  links: FeedbackLink[];
  /** The email that goes with the next push (saved with the draft). */
  client_email: ClientEmailDraft;
};

/**
 * What the client saw: the summary and framing, files and links. `intro`
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
  "Once you confirm this narrative, Rupert sends your matched investor list. After you confirm the list, he writes the email copy and sequence for each tier from these messages. You review those before anything is sent.";

export type NarrativePayload = {
  /** The core story (markdown). */
  core: string;
  /** 3–6 messages Rupert will carry into outreach (markdown). */
  key_messages: string;
  /** How Rupert will approach investors (markdown). */
  approach: string;
  /** What the client should expect after they confirm. */
  next_steps: string;
  /** Rupert's Company Materials Feedback, sent with this version. Absent before Analyze. */
  feedback?: MaterialsFeedback;
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

export type FitTier = 1 | 2 | 3 | 4;

/**
 * How a list or an email copy groups its funds. "three": Bullseye, Match,
 * Expansion (every list and copy made before four-tier matching). "four":
 * Core, Sphere, Tier 3, Tier 4. Stored only as "four"; absent means "three",
 * so lists and copy already sent read exactly as before.
 */
export type TierScheme = "three" | "four";

export function asTierScheme(value: unknown): TierScheme {
  return value === "four" ? "four" : "three";
}

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
  /** Short fund type, e.g. "VC". */
  fund_type?: string;
  /** City and state (or country), when the database has them. */
  location?: string;
  /** Stated check size, when a website check recorded one. */
  check_size?: string;
  /** Stage focus from the database, when it is filled in. */
  stage_focus?: string;
  /** Investing contacts shown to the client. Invalid emails are already left out. */
  contact_count?: number;
  /** 2–4 chips from the criteria this fund actually matched. Never the generic why sentence. */
  reasons?: string[];
  /** Same website domain as another fund that the client sees. Admin only. */
  hidden_duplicate?: boolean;
  /** A generalist the campaign plan approved: broad, not a tier. Grouped with the last tier for email copy. */
  broad?: boolean;
};

/** Verification totals frozen onto the list when it is pushed. Absent on older lists. */
export type InvestorVerification = {
  verification_ran: boolean;
  verified_at?: string;
  sample_size?: number;
  firms_checked?: number;
  firms_confirmed_active?: number;
  emails_checked?: number;
  emails_valid?: number;
  emails_accept_all?: number;
  emails_invalid?: number;
  emails_unknown?: number;
  /** Whole percent: emails_valid / emails_checked. */
  deliverable_rate?: number;
  /** True when invalid contacts were removed from the contact counts. */
  excludes_invalid?: boolean;
};

/** The client's marks on one fund. Stored with the list, per fund id. */
export type InvestorFundFlag = {
  excluded?: boolean;
  known?: boolean;
  note?: string;
};

/** FirmIDs from the fund database. Long enough that the id is not cut off. */
export const FUND_ID_MAX = 200;

/** A flag whose fund was on a previous list and is not on this one. */
export type RemovedInvestorFlag = InvestorFundFlag & {
  id: string;
  fund_name: string;
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
  /** Frozen at push. Missing on lists pushed before verification was snapshotted. */
  verification?: InvestorVerification;
  /** Exclude, "I know them", and notes, by FirmID. */
  client_flags?: Record<string, InvestorFundFlag>;
  /** Flags for funds the latest match no longer includes. */
  removed_flags?: RemovedInvestorFlag[];
  /** "four" for lists pushed from the four-tier engine. Absent: three tiers. */
  tier_scheme?: "four";
  /** Four-tier lists: the saved match run the list was built from. */
  run_id?: string;
  /** Four-tier lists: the rules version of that run. */
  rules_version?: string;
};

export type CopyEmail = { subject: string; body: string };

/**
 * Three emails per tier: the first email and two follow-ups. `tiers` has a
 * sequence for each tier of the copy's scheme: "1"–"3", or "1"–"4".
 */
export type EmailCopyPayload = {
  tiers: Partial<Record<`${FitTier}`, CopyEmail[]>>;
  /** "four" for copy written for a four-tier list. Absent: three tiers. */
  tier_scheme?: "four";
  /** One LinkedIn connection note for every tier. 300 characters or fewer. */
  linkedin_note?: string;
  /** One LinkedIn follow-up for every tier. */
  linkedin_followup?: string;
  /** Rupert's reply when this version is sent back for confirmation. */
  admin_note?: string;
};

export type FitTierInfo = { tier: FitTier; label: string; detail: string };

/** The three-tier scheme: lists and copy made before four-tier matching. */
export const THREE_FIT_TIERS: FitTierInfo[] = [
  {
    tier: 1,
    label: "Bullseye",
    detail: "Strongest fit on stage, sector and geography. Highest-priority outreach.",
  },
  { tier: 2, label: "Match", detail: "Strong fit on most of your criteria." },
  { tier: 3, label: "Expansion", detail: "Broader fit. Widens the funnel." },
];

/** The four-tier scheme. Every fund here invests at your stage and covers your location. */
export const FOUR_FIT_TIERS: FitTierInfo[] = [
  {
    tier: 1,
    label: "Core",
    detail: "Invests directly in your sector. Highest-priority outreach.",
  },
  {
    tier: 2,
    label: "Sphere",
    detail: "Invests in a sector right next to yours, or directly in one of your other sectors.",
  },
  {
    tier: 3,
    label: "Tier 3",
    detail: "A broader link to your sector. Widens the funnel.",
  },
  {
    tier: 4,
    label: "Tier 4",
    detail: "A weaker but real link to your sector. Contacted last.",
  },
];

export function fitTiersFor(scheme: TierScheme | null | undefined): FitTierInfo[] {
  return scheme === "four" ? FOUR_FIT_TIERS : THREE_FIT_TIERS;
}

/** The scheme marker to store: "four", or nothing for three tiers. */
function schemeMarker(scheme: TierScheme): { tier_scheme?: "four" } {
  return scheme === "four" ? { tier_scheme: "four" } : {};
}

export const EMAIL_SEQUENCE_LABELS = [
  "First email",
  "Follow-up 1",
  "Follow-up 2",
] as const;

export function tierLabel(tier: FitTier, scheme?: TierScheme | null) {
  return fitTiersFor(scheme).find((item) => item.tier === tier)?.label ?? `Tier ${tier}`;
}

const GENERIC_WHY =
  /right stage, your core sector, your geography, and a focused thesis/i;

/** Drops the matcher's generic bullseye sentence. Specific reasons stay. */
export function withoutGenericWhy(why: string) {
  const text = why.trim();
  return GENERIC_WHY.test(text) ? "" : text;
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

/**
 * Feedback sent as its own step before it moved into the Outreach
 * Narrative. Not a Setup step any more; clients who received it can still
 * open it.
 */
export const LEGACY_FEEDBACK_STEP: SetupStepDefinition = {
  id: "deck_review",
  title: "Analysis & Feedback",
  short: "Analysis & Feedback",
  href: "/portal/setup/deck-review",
  clientTask: "read Rupert's feedback on your materials",
  adminAction: "Nothing: the feedback now goes with the outreach narrative",
  kind: "review",
};

export const SETUP_STEPS: SetupStepDefinition[] = [
  {
    id: "framing",
    title: "Outreach Narrative",
    short: "Outreach Narrative",
    href: "/portal/setup/framing",
    clientTask: "review and confirm the outreach narrative",
    adminAction: "Analyze the materials, build the outreach narrative and send it",
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
    adminAction: "Write the email copy for each tier",
    kind: "review",
  },
];

export const SETUP_TOTAL = SETUP_STEPS.length;

const STEP_BY_ID = new Map<SetupStepId, SetupStepDefinition>([
  [MATERIALS_STEP.id, MATERIALS_STEP],
  [LEGACY_FEEDBACK_STEP.id, LEGACY_FEEDBACK_STEP],
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
 * when the intake completes (with the company materials). A client already
 * in setup stays open even if materials are later sent back.
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

/** True once Rupert has pushed this step: the client can open it. */
export function isSharedWithClient(row: SetupStepState | null | undefined) {
  return Boolean(row && row.version > 0 && row.status !== "draft");
}

/** Why the investor list cannot be sent yet, in Rupert's words. */
export const INVESTOR_LIST_BLOCKED =
  "Available once the client confirms the outreach narrative.";

/**
 * The narrative is confirmed and no investor list has been sent yet:
 * Rupert's next move is the investor list. The feedback plays no part.
 */
export function readyForInvestorList(source: SetupSource | null | undefined) {
  const rows = source?.setup_steps ?? [];
  const list = rowFor(rows, "investor_list");
  return rowFor(rows, "framing")?.status === "confirmed" && (list?.version ?? 0) === 0;
}

export function getSetupItems(source: SetupSource | null | undefined): SetupItem[] {
  const rows = source?.setup_steps ?? [];

  const materials = rowFor(rows, "materials");
  const framing = rowFor(rows, "framing");
  const list = rowFor(rows, "investor_list");
  const copy = rowFor(rows, "email_copy");

  const materialsDone = materials?.status === "submitted";
  const framingDone = framing?.status === "confirmed";
  const listDone = list?.status === "confirmed";

  const items: SetupItem[] = [];

  // Every Setup step: Rupert pushes, the client confirms (or asks for changes).
  const reviewItem = (
    id: Exclude<SetupStepId, "materials" | "deck_review">,
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

  // 1. The Outreach Narrative, with the Company Materials Feedback. Opens
  // when the materials are submitted (with the intake). Anything already
  // pushed stays visible if the materials are sent back.
  items.push(
    reviewItem(
      "framing",
      framing,
      materialsDone || (framing?.version ?? 0) > 0,
      "After your Client Intake",
      "Rupert is reviewing your materials and writing your outreach narrative",
      materials?.completed_at ?? null,
    ),
  );
  // 2. The investor list opens once the client has confirmed the narrative.
  // A list Rupert already sent stays the client's to review.
  const listReady = framingDone || (list?.version ?? 0) > 0;
  items.push(
    reviewItem(
      "investor_list",
      list,
      listReady,
      "After you confirm the outreach narrative",
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
  return { files, fields, no_deck: str(raw.no_deck, NO_DECK_MAX).trim() };
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
  const note = str(raw.note, NOTE_MAX).trim();
  return {
    subject: str(raw.subject, EMAIL_SUBJECT_MAX),
    body: str(raw.body, EMAIL_BODY_MAX),
    note: note || undefined,
  };
}

/** A feedback draft from before it moved into the narrative: the summary and framing, files, links and the email. */
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

/** Rupert's Company Materials Feedback; undefined when there is none. */
export function asMaterialsFeedback(value: unknown): MaterialsFeedback | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const summary = str(raw.summary, 30000);
  const improvements = str(raw.improvements, 30000);
  if (!summary.trim() && !improvements.trim()) return undefined;
  return {
    summary,
    improvements,
    generated_at: str(raw.generated_at, 40),
    read: asStringList(raw.read),
    skipped: asStringList(raw.skipped),
  };
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
    feedback: asMaterialsFeedback(raw.feedback),
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

/**
 * What the client sees of a narrative: everything except Rupert's change
 * summary and what the AI read for the feedback.
 */
export function narrativeForClient(value: unknown): NarrativePayload {
  const narrative = asNarrative(value);
  return {
    ...narrative,
    change_summary: undefined,
    feedback: narrative.feedback
      ? { ...narrative.feedback, generated_at: "", read: [], skipped: [] }
      : undefined,
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
  if (!narrative.core.trim()) return "Write the core story before sending.";
  if (!narrative.key_messages.trim()) return "Add the key messages before sending.";
  if (!narrative.approach.trim()) return "Describe how you'll approach investors before sending.";
  return null;
}

/** A tier of the scheme: 1–3, or 1–4 for a four-tier list. */
function asTier(value: unknown, scheme: TierScheme): FitTier | null {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return n === 4 && scheme === "four" ? 4 : null;
}

const ID_PATTERN = /^[0-9a-f-]{36}$/i;

export function asInvestorList(value: unknown): InvestorListPayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const scheme = asTierScheme(raw.tier_scheme);
  const lastTier = fitTiersFor(scheme)[fitTiersFor(scheme).length - 1].tier;
  const rows = Array.isArray(raw.rows)
    ? raw.rows
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
        .map((item, index) => {
          const reasons = Array.isArray(item.reasons)
            ? item.reasons
                .map((reason) => str(reason, 120).trim())
                .filter((reason) => reason && withoutGenericWhy(reason) === reason)
                .slice(0, 4)
            : [];
          const count = Math.floor(Number(item.contact_count));
          return {
            id: str(item.id, FUND_ID_MAX) || `r${index + 1}`,
            fund_name: str(item.fund_name, INVESTOR_FIELD_MAX),
            contact: str(item.contact, INVESTOR_FIELD_MAX),
            details: str(item.details, INVESTOR_FIELD_MAX),
            tier: asTier(item.tier, scheme) ?? lastTier,
            why: withoutGenericWhy(dropSectorFocus(str(item.why, INVESTOR_FIELD_MAX))),
            comments: str(item.comments, INVESTOR_FIELD_MAX),
            website: websiteHref(str(item.website, 500)) || undefined,
            fund_type: str(item.fund_type, 80).trim() || undefined,
            location: str(item.location, 120).trim() || undefined,
            check_size: str(item.check_size, 80).trim() || undefined,
            stage_focus: str(item.stage_focus, 160).trim() || undefined,
            contact_count: Number.isFinite(count) && count >= 0 ? count : undefined,
            reasons: reasons.length > 0 ? reasons : undefined,
            hidden_duplicate: item.hidden_duplicate === true ? true : undefined,
            broad: item.broad === true && scheme === "four" ? true : undefined,
          };
        })
    : [];
  const adminNote = str(raw.admin_note, NOTE_MAX).trim();
  const runId = str(raw.run_id, 36).trim();
  const rulesVersion = str(raw.rules_version, 60).trim();
  return {
    rows,
    source_file: str(raw.source_file, 255),
    summary: asInvestorListSummary(raw.summary, scheme),
    admin_note: adminNote || undefined,
    verification: asInvestorVerification(raw.verification),
    client_flags: asInvestorFlags(raw.client_flags, rows.map((row) => row.id)),
    removed_flags: asRemovedFlags(raw.removed_flags),
    ...(scheme === "four"
      ? {
          tier_scheme: "four" as const,
          ...(ID_PATTERN.test(runId) ? { run_id: runId } : {}),
          ...(rulesVersion ? { rules_version: rulesVersion } : {}),
        }
      : {}),
  };
}

/** Rupert's investor list draft: the list from Rupert Match and the email that goes with it. */
export type InvestorListDraft = InvestorListPayload & { client_email: ClientEmailDraft };

export function asInvestorListDraft(value: unknown): InvestorListDraft {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { ...asInvestorList(value), client_email: asClientEmail(raw.client_email) };
}

/** What the client sees of the draft: never the email. The run id stays, so a sent list traces to its run. */
export function investorListForClient(draft: InvestorListPayload): InvestorListPayload {
  return {
    rows: draft.rows,
    source_file: draft.source_file,
    summary: draft.summary ?? null,
    admin_note: draft.admin_note,
    verification: draft.verification,
    client_flags: draft.client_flags,
    removed_flags: draft.removed_flags,
    ...(draft.tier_scheme === "four"
      ? {
          tier_scheme: "four" as const,
          ...(draft.run_id ? { run_id: draft.run_id } : {}),
          ...(draft.rules_version ? { rules_version: draft.rules_version } : {}),
        }
      : {}),
  };
}

function whole(value: unknown) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function asInvestorVerification(value: unknown): InvestorVerification | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.verification_ran !== true) return { verification_ran: false };
  return {
    verification_ran: true,
    verified_at: str(raw.verified_at, 40).trim() || undefined,
    sample_size: whole(raw.sample_size),
    firms_checked: whole(raw.firms_checked),
    firms_confirmed_active: whole(raw.firms_confirmed_active),
    emails_checked: whole(raw.emails_checked),
    emails_valid: whole(raw.emails_valid),
    emails_accept_all: whole(raw.emails_accept_all),
    emails_invalid: whole(raw.emails_invalid),
    emails_unknown: whole(raw.emails_unknown),
    deliverable_rate: Math.min(100, whole(raw.deliverable_rate)),
    excludes_invalid: raw.excludes_invalid === true,
  };
}

function flagFrom(raw: unknown): InvestorFundFlag | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const note = str(item.note, NOTE_MAX).trim();
  const flag: InvestorFundFlag = {};
  if (item.excluded === true) flag.excluded = true;
  if (item.known === true) flag.known = true;
  if (note) flag.note = note;
  return flag.excluded || flag.known || flag.note ? flag : null;
}

/** Every stored flag, including funds that are no longer on the list. */
export function investorFlagsFrom(value: unknown): Record<string, InvestorFundFlag> {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).client_flags
      : undefined;
  if (!raw || typeof raw !== "object") return {};
  const flags: Record<string, InvestorFundFlag> = {};
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    const id = str(key, FUND_ID_MAX);
    const flag = flagFrom(item);
    if (id && flag) flags[id] = flag;
  }
  return flags;
}

function asInvestorFlags(value: unknown, ids: string[]) {
  const allowed = new Set(ids);
  const flags: Record<string, InvestorFundFlag> = {};
  for (const [id, flag] of Object.entries(investorFlagsFrom({ client_flags: value }))) {
    if (allowed.has(id)) flags[id] = flag;
  }
  return Object.keys(flags).length > 0 ? flags : undefined;
}

function asRemovedFlags(value: unknown): RemovedInvestorFlag[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const flags: RemovedInvestorFlag[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = str(raw.id, FUND_ID_MAX);
    const flag = flagFrom(raw);
    if (!id || !flag) continue;
    flags.push({
      id,
      fund_name: str(raw.fund_name, 300).trim() || id,
      ...flag,
    });
  }
  return flags.length > 0 ? flags : undefined;
}

/**
 * Keeps flags for funds still on the list, keyed by FirmID. A flag whose fund
 * dropped out is kept, with its name, instead of being deleted. A 40-character
 * id from an older push is reattached when it is the start of exactly one FirmID.
 */
export function retainInvestorFlags(
  flags: Record<string, InvestorFundFlag> | undefined,
  removed: RemovedInvestorFlag[] | undefined,
  names: Map<string, string>,
  nextIds: Set<string>,
): { client_flags?: Record<string, InvestorFundFlag>; removed_flags?: RemovedInvestorFlag[] } {
  const kept: Record<string, InvestorFundFlag> = {};
  const gone = new Map<string, RemovedInvestorFlag>();

  function resolve(id: string) {
    if (nextIds.has(id)) return id;
    if (id.length !== 40) return null;
    const matches = Array.from(nextIds).filter((next) => next.startsWith(id));
    return matches.length === 1 ? matches[0] : null;
  }

  for (const item of removed ?? []) {
    const id = resolve(item.id);
    if (id) kept[id] = { ...(kept[id] ?? {}), ...flagFields(item) };
    else gone.set(item.id, item);
  }
  for (const [rawId, flag] of Object.entries(flags ?? {})) {
    const id = resolve(rawId);
    if (id) {
      kept[id] = { ...(kept[id] ?? {}), ...flag };
      gone.delete(id);
      if (rawId !== id) gone.delete(rawId);
    } else {
      gone.set(rawId, {
        id: rawId,
        fund_name: names.get(rawId) || gone.get(rawId)?.fund_name || rawId,
        ...flag,
      });
    }
  }

  const removedFlags = Array.from(gone.values());
  return {
    client_flags: Object.keys(kept).length > 0 ? kept : undefined,
    removed_flags: removedFlags.length > 0 ? removedFlags : undefined,
  };
}

function flagFields(flag: InvestorFundFlag): InvestorFundFlag {
  const next: InvestorFundFlag = {};
  if (flag.excluded) next.excluded = true;
  if (flag.known) next.known = true;
  if (flag.note) next.note = flag.note;
  return next;
}

/** Why the investor list cannot be sent yet, or null. */
export function investorListProblem(draft: InvestorListPayload) {
  return draft.rows.length === 0 ? "Push the list from Rupert Match first." : null;
}

function count(value: unknown) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function asInvestorListSummary(value: unknown, scheme: TierScheme): InvestorListSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.tiers)) return null;
  const tiers = raw.tiers
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .map((item) => ({
      tier: asTier(item.tier, scheme),
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

function emptySequence(): CopyEmail[] {
  return EMAIL_SEQUENCE_LABELS.map(() => ({ subject: "", body: "" }));
}

export function emptyEmailCopy(scheme: TierScheme = "three"): EmailCopyPayload {
  const tiers: EmailCopyPayload["tiers"] = {};
  for (const { tier } of fitTiersFor(scheme)) tiers[`${tier}`] = emptySequence();
  return { tiers, ...schemeMarker(scheme) };
}

/** One tier's three emails; empty ones when the copy has none for it. */
export function tierEmails(copy: EmailCopyPayload, tier: FitTier): CopyEmail[] {
  return copy.tiers[`${tier}`] ?? emptySequence();
}

export function asEmailCopy(value: unknown): EmailCopyPayload {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const tiers = (raw.tiers && typeof raw.tiers === "object"
    ? raw.tiers
    : {}) as Record<string, unknown>;
  const scheme = asTierScheme(raw.tier_scheme);
  const result = emptyEmailCopy(scheme);
  for (const { tier } of fitTiersFor(scheme)) {
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
  for (const { tier, label } of fitTiersFor(copy.tier_scheme)) {
    const emails = tierEmails(copy, tier);
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

export function tierCounts(rows: InvestorRow[], scheme?: TierScheme | null) {
  return fitTiersFor(scheme).map(({ tier }) => ({
    tier,
    count: rows.filter((row) => row.tier === tier && !row.hidden_duplicate).length,
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
