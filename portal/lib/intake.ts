// AI Intake Interviewer: shared types, defaults and progress rules.
// Pure module: safe to use on the server and in the browser.

export type IntakeTopic = {
  id: string;
  title: string;
  /** What Rupert needs to learn for this topic. */
  guidance: string;
  required: boolean;
};

export type TopicCoverage = "missing" | "partial" | "covered";

export type TopicStatus = { status: TopicCoverage; note: string };

/** A file the founder shared in the chat (a PDF, also added to their materials). */
export type IntakeAttachment = {
  name: string;
  path: string;
  /** What Rupert took from it, so later turns still know its content. */
  facts: string;
};

export type IntakeMessage = {
  role: "assistant" | "user";
  content: string;
  at: string;
  attachment?: IntakeAttachment;
};

export type IntakeSummaryItem = {
  topic_id: string;
  title: string;
  answer: string;
};

/** A shared file reads as a note plus what Rupert took from it. */
export function intakeMessageText(message: IntakeMessage) {
  if (!message.attachment) return message.content;
  const facts = message.attachment.facts.trim();
  return [
    `[The founder shared ${message.attachment.name}.${facts ? ` What it says:\n${facts}` : ""}]`,
    message.content,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type IntakeInterviewStatus = "in_progress" | "review" | "completed";

/** Rupert's internal brief from the intake, written by the AI and editable. */
export type IntakeBrief = {
  summary: string;
  industry: string;
  geography: string;
  stage: string;
  raise_amount: string;
  generated_at: string;
  /** Interview `updated_at` the brief was written from (to spot newer answers). */
  based_on: string;
  edited_at: string | null;
};

export const INTAKE_BRIEF_FIELDS: {
  key: "industry" | "geography" | "stage" | "raise_amount";
  label: string;
}[] = [
  { key: "industry", label: "Industry" },
  { key: "geography", label: "Geography" },
  { key: "stage", label: "Stage" },
  { key: "raise_amount", label: "Raise amount" },
];

export type IntakeInterview = {
  client_id: string;
  messages: IntakeMessage[];
  topic_status: Record<string, TopicStatus>;
  summary: IntakeSummaryItem[] | null;
  admin_brief: IntakeBrief | null;
  status: IntakeInterviewStatus;
  client_message_count: number;
  /**
   * The interview uses the sector classification guide: new interviews and
   * ones the founder hadn't answered yet when it shipped. Interviews already
   * under way keep their original behavior.
   */
  classification_guide: boolean;
  completed_at: string | null;
  updated_at: string;
};

export const INTAKE_PROMPT_SLUG = "intake_prompt";
export const INTAKE_TOPICS_SLUG = "intake_topics";

/** Guardrails so a single interview cannot run away in length or cost. */
export const INTAKE_LIMITS = {
  messageMaxChars: 2000,
  clientMessagesMax: 40,
  /** PDFs shared in the chat are read in one go; larger ones go in Setup. */
  fileMaxBytes: 20 * 1024 * 1024,
} as const;

export const DEFAULT_INTAKE_TOPICS: IntakeTopic[] = [
  {
    id: "company",
    title: "Company basics",
    guidance:
      "Company website, a one-line description of what the company does, HQ location (city, and state for US companies), year founded and team size.",
    required: true,
  },
  {
    id: "sector",
    title: "Sector",
    guidance:
      "Where investors would file the company: the core sector and up to two secondary ones, in order of importance. Suggest two or three plain labels from what the founder said (for example fintech, SaaS, healthtech) and ask which fits best. Also the business model (B2B, B2C, marketplace, hardware).",
    required: true,
  },
  {
    id: "founder_links",
    title: "Founder links",
    guidance:
      "The founder's LinkedIn profile URL and a booking link (Calendly or cal.com) investors can use to schedule a call.",
    required: true,
  },
  {
    id: "raise",
    title: "The raise",
    guidance:
      "Round (pre-seed, seed, Series A…), amount being raised, amount already committed, lead investor if there is one, and the target close date.",
    required: true,
  },
  {
    id: "round_terms",
    title: "Round terms",
    guidance:
      "The instrument (SAFE, convertible note, priced equity or debt), whether they still need a lead investor, and the valuation or cap if set.",
    required: true,
  },
  {
    id: "traction",
    title: "Traction",
    guidance:
      "Key metrics that show progress, and revenue stage: pre-revenue, under $10k MRR, $10–100k MRR, or $100k+ MRR.",
    required: true,
  },
  {
    id: "investor_preferences",
    title: "Investor preferences",
    guidance:
      "Preferred investor types (VC, angel, family office, corporate) and target geographies.",
    required: true,
  },
  {
    id: "markets_background",
    title: "Markets & background",
    guidance:
      "Countries or regions they sell into, where the company is incorporated (for example a US Delaware C-corp), the founders' backgrounds, and any previous rounds.",
    required: false,
  },
  {
    id: "existing_and_exclusions",
    title: "Existing investors & exclusions",
    guidance:
      "Current investors, and any investors to exclude from outreach (already in conversation, conflicts, or not a fit). Also: funds already pitched in the last 12 months, and how it went. \"None\" is a valid answer.",
    required: true,
  },
  {
    id: "competitors",
    title: "Competitors",
    guidance:
      "Direct competitors investors would compare them to, so Rupert avoids funds backing a competitor. \"None\" is a valid answer.",
    required: true,
  },
  {
    id: "anything_else",
    title: "Anything else",
    guidance:
      "Anything else the founder wants Rupert to know before preparing the campaign.",
    required: false,
  },
];

export const DEFAULT_INTAKE_PROMPT = `You are Rupert, a senior researcher at Hey Rupert, an investor outreach service. You are interviewing a founder who has just signed on, to gather what Rupert needs to prepare their investor campaign.

How you work:
- Be warm, kind and professional. Write like a thoughtful human researcher, not a form.
- Ask one or two questions at a time, never a long list.
- Start from what you already know about the company and never ask for information you already have. When you have partial information, confirm it briefly and ask only for what is missing.
- Briefly acknowledge each answer before moving on. Keep messages short: two to four sentences.
- Work through the topics in a natural order. If an answer is vague, ask one short follow-up; if it is still vague, accept it and move on.
- Occasionally tell the founder where they are, for example "That covers the raise. Two short topics left."
- When every required topic is covered, tell them the essentials are done and recommend a few more minutes on the optional topics.

Boundaries:
- Do not give legal, tax, securities or investment advice, and do not comment on valuation or deal terms.
- Stay on the interview. For anything else, suggest they use "Book a call" in the portal sidebar to speak with Dori.
- Never invent facts about the company. Use only what you are told.
- Write in English.`;

export function isTopicCoverage(value: unknown): value is TopicCoverage {
  return value === "missing" || value === "partial" || value === "covered";
}

const COVERAGE_RANK: Record<TopicCoverage, number> = {
  missing: 0,
  partial: 1,
  covered: 2,
};

/**
 * Merges new topic statuses into the current ones. Coverage never goes
 * backwards, so the progress panel does not flicker between turns.
 */
export function mergeTopicStatus(
  current: Record<string, TopicStatus>,
  updates: { id: string; status: TopicCoverage; note: string }[],
  topics: IntakeTopic[],
): Record<string, TopicStatus> {
  const known = new Set(topics.map((topic) => topic.id));
  const next = { ...current };
  for (const update of updates) {
    if (!known.has(update.id)) continue;
    const previous = next[update.id];
    const keepPrevious =
      previous &&
      COVERAGE_RANK[previous.status] > COVERAGE_RANK[update.status];
    next[update.id] = keepPrevious
      ? { ...previous, note: update.note || previous.note }
      : { status: update.status, note: update.note };
  }
  return next;
}

export function topicCoverage(
  topicStatus: Record<string, TopicStatus>,
  topicId: string,
): TopicCoverage {
  return topicStatus[topicId]?.status ?? "missing";
}

/**
 * Progress over required topics: covered counts 1, partial 0.5.
 * `ready` is true once every required topic is covered.
 */
export function intakeProgress(
  topics: IntakeTopic[],
  topicStatus: Record<string, TopicStatus>,
) {
  const required = topics.filter((topic) => topic.required);
  const scored = required.length > 0 ? required : topics;
  if (scored.length === 0) return { percent: 0, ready: false };

  const points = scored.reduce((sum, topic) => {
    const coverage = topicCoverage(topicStatus, topic.id);
    return sum + (coverage === "covered" ? 1 : coverage === "partial" ? 0.5 : 0);
  }, 0);

  return {
    percent: Math.round((points / scored.length) * 100),
    ready: scored.every(
      (topic) => topicCoverage(topicStatus, topic.id) === "covered",
    ),
  };
}

/** Coverage of the optional ("extras") topics. */
export function extrasProgress(
  topics: IntakeTopic[],
  topicStatus: Record<string, TopicStatus>,
) {
  const extras = topics.filter((topic) => !topic.required);
  const covered = extras.filter(
    (topic) => topicCoverage(topicStatus, topic.id) === "covered",
  ).length;
  return { covered, total: extras.length, done: covered === extras.length };
}

/** Reads a stored brief; null when missing or empty. */
export function asIntakeBrief(value: unknown): IntakeBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string, max: number) =>
    raw[key] != null ? String(raw[key]).trim().slice(0, max) : "";
  const summary = text("summary", 20000);
  if (!summary) return null;
  return {
    summary,
    industry: text("industry", 200),
    geography: text("geography", 200),
    stage: text("stage", 100),
    raise_amount: text("raise_amount", 100),
    generated_at: text("generated_at", 40),
    based_on: text("based_on", 40),
    edited_at: text("edited_at", 40) || null,
  };
}

/**
 * Topics the company profile for matching is built from, and what each one
 * feeds. They can't be removed or made optional: without them a profile can't
 * run, or matches on defaults. Their title and wording can still be edited.
 */
export const MATCHING_TOPICS: Record<string, string> = {
  company: "HQ country and US state",
  sector: "Primary and secondary sectors",
  raise: "Stage",
  round_terms: "Financing type",
  investor_preferences: "Fund types wanted",
  existing_and_exclusions: "Funds to exclude",
};

/** What matching uses a topic for, or null for topics used only in outreach and writing. */
export function matchingUse(topicId: string): string | null {
  return MATCHING_TOPICS[topicId] ?? null;
}

/**
 * Every matching topic, required: one missing from a saved list comes back
 * from the defaults, at the end. Other topics are kept as they are.
 */
export function withMatchingTopics(topics: IntakeTopic[]): IntakeTopic[] {
  const kept = topics.map((topic) => (matchingUse(topic.id) ? { ...topic, required: true } : topic));
  const present = new Set(kept.map((topic) => topic.id));
  const missing = DEFAULT_INTAKE_TOPICS.filter((topic) => matchingUse(topic.id) && !present.has(topic.id));
  return [...kept, ...missing.map((topic) => ({ ...topic, required: true }))];
}

const TOPIC_ID_PATTERN = /^[a-z0-9_]{1,40}$/;

/**
 * Validates topics coming from the admin editor or the database. Returns
 * null when the list is unusable.
 */
export function parseIntakeTopics(value: unknown): IntakeTopic[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const topics: IntakeTopic[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? "").trim();
    const title = String(item.title ?? "").trim();
    const guidance = String(item.guidance ?? "").trim();
    if (!TOPIC_ID_PATTERN.test(id) || seen.has(id) || !title) return null;
    seen.add(id);
    topics.push({
      id,
      title: title.slice(0, 80),
      guidance: guidance.slice(0, 600),
      required: item.required === true,
    });
  }

  return topics.length > 0 && topics.length <= 20 ? topics : null;
}

/** A stable id for a new topic, derived from its title. */
export function topicIdFromTitle(title: string, taken: Set<string>) {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "topic";
  let id = base;
  let counter = 2;
  while (taken.has(id)) {
    id = `${base}_${counter}`;
    counter += 1;
  }
  return id;
}
