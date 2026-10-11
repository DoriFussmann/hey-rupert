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

export type IntakeMessage = {
  role: "assistant" | "user";
  content: string;
  at: string;
};

export type IntakeSummaryItem = {
  topic_id: string;
  title: string;
  answer: string;
};

export type IntakeInterviewStatus = "in_progress" | "review" | "completed";

export type IntakeInterview = {
  client_id: string;
  messages: IntakeMessage[];
  topic_status: Record<string, TopicStatus>;
  summary: IntakeSummaryItem[] | null;
  status: IntakeInterviewStatus;
  client_message_count: number;
  completed_at: string | null;
  updated_at: string;
};

export const INTAKE_PROMPT_SLUG = "intake_prompt";
export const INTAKE_TOPICS_SLUG = "intake_topics";

/** Guardrails so a single interview cannot run away in length or cost. */
export const INTAKE_LIMITS = {
  messageMaxChars: 2000,
  clientMessagesMax: 40,
} as const;

export const DEFAULT_INTAKE_TOPICS: IntakeTopic[] = [
  {
    id: "company",
    title: "Company basics",
    guidance:
      "Company website, a one-line description of what the company does, HQ location, year founded and team size.",
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
    id: "use_of_funds",
    title: "Use of funds",
    guidance:
      "How the money will be used and what milestones it should reach.",
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
    id: "existing_and_exclusions",
    title: "Existing investors & exclusions",
    guidance:
      "Current investors, and any investors to exclude from outreach (already in conversation, conflicts, or not a fit).",
    required: false,
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
