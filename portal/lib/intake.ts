// AI Intake Interviewer: shared types, defaults and progress rules.
// Pure module: safe to use on the server and in the browser.

import { MATERIAL_EXTENSIONS, MATERIAL_MAX_BYTES, fileExtension, formatBytes } from "./setup.ts";

export type IntakeTopic = {
  id: string;
  title: string;
  /** What Rupert needs to learn for this topic. */
  guidance: string;
  required: boolean;
};

export type TopicCoverage = "missing" | "partial" | "covered";

export type TopicStatus = { status: TopicCoverage; note: string };

/** A file the founder shared in the chat (also added to their company materials). */
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
  /** Files shared with this message. */
  attachments?: IntakeAttachment[];
};

export type IntakeSummaryItem = {
  topic_id: string;
  title: string;
  answer: string;
};

/** Shared files read as a note plus what Rupert took from each. */
export function intakeMessageText(message: IntakeMessage) {
  const files = message.attachments ?? [];
  if (files.length === 0) return message.content;
  const notes = files.map((file) => {
    const facts = file.facts.trim();
    return `[The founder shared ${file.name}.${facts ? ` What it says:\n${facts}` : ""}]`;
  });
  return [...notes, message.content].filter(Boolean).join("\n\n");
}

/**
 * A point where a shared file and the founder's answers disagree. Rupert
 * asks once; the founder's answer is the resolution.
 */
export type IntakeConflict = {
  /** Short stable key Rupert gives the disagreement, e.g. "raise_amount". */
  id: string;
  topic_id: string;
  file: string;
  file_says: string;
  founder_says: string;
  /** What the founder confirmed. Empty while open. */
  resolution: string;
  status: "open" | "resolved";
  updated_at: string;
};

export const CONFLICTS_MAX = 30;

const CONFLICT_ID_PATTERN = /^[a-z0-9_]{1,40}$/;

function clip(value: unknown, max: number) {
  return value != null ? String(value).trim().slice(0, max) : "";
}

/**
 * Reads stored or reported conflicts; drops anything unusable. A conflict
 * counts as resolved only with a resolution, unless `trustStatus` (a turn's
 * update, whose resolution may already be stored).
 */
export function asConflicts(value: unknown, trustStatus = false): IntakeConflict[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const conflicts: IntakeConflict[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = clip(item.id, 40).toLowerCase();
    if (!CONFLICT_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    const resolution = clip(item.resolution, 500);
    conflicts.push({
      id,
      topic_id: clip(item.topic_id, 40),
      file: clip(item.file, 255),
      file_says: clip(item.file_says, 500),
      founder_says: clip(item.founder_says, 500),
      resolution,
      status: item.status === "resolved" && (resolution || trustStatus) ? "resolved" : "open",
      updated_at: clip(item.updated_at, 40),
    });
    if (conflicts.length >= CONFLICTS_MAX) break;
  }
  return conflicts;
}

/**
 * Merges the conflicts Rupert reports in a turn into the stored ones, by id.
 * A resolved conflict stays resolved; empty fields keep their earlier value.
 */
export function mergeConflicts(
  current: IntakeConflict[],
  updates: unknown,
  at: string,
): IntakeConflict[] {
  const merged = current.map((conflict) => ({ ...conflict }));
  for (const update of asConflicts(updates, true)) {
    const index = merged.findIndex((conflict) => conflict.id === update.id);
    if (index === -1) {
      if (merged.length >= CONFLICTS_MAX) continue;
      merged.push({
        ...update,
        status: update.status === "resolved" && update.resolution ? "resolved" : "open",
        updated_at: at,
      });
      continue;
    }
    const previous = merged[index];
    if (previous.status === "resolved") continue;
    const resolution = update.resolution || previous.resolution;
    merged[index] = {
      ...previous,
      topic_id: update.topic_id || previous.topic_id,
      file: update.file || previous.file,
      file_says: update.file_says || previous.file_says,
      founder_says: update.founder_says || previous.founder_says,
      resolution,
      status: update.status === "resolved" && resolution ? "resolved" : "open",
      updated_at: at,
    };
  }
  return merged;
}

/** One line per conflict, for prompts and emails. */
export function conflictLine(conflict: IntakeConflict) {
  const base = `${conflict.file || "A file"} said "${conflict.file_says}"; the founder said "${conflict.founder_says}"`;
  return conflict.status === "resolved"
    ? `${base}. Confirmed: ${conflict.resolution}`
    : `${base}. Not confirmed yet.`;
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
  /** Where a shared file and the founder's answers disagreed. */
  conflicts: IntakeConflict[];
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
} as const;

/** Formats the AI can't read: the intake asks for a PDF instead. */
export const INTAKE_PDF_INSTEAD: Record<string, string> = {
  key: "Keynote",
  ppt: "older PowerPoint (.ppt)",
  doc: "older Word (.doc)",
  xls: "older Excel (.xls)",
};

/** File types the founder can share in the intake. */
export const INTAKE_FILE_EXTENSIONS = MATERIAL_EXTENSIONS.filter(
  (extension) => !INTAKE_PDF_INSTEAD[extension],
);

/** Why a file can't be shared in the intake, or null when it can. */
export function intakeFileProblem(file: { name: string; size: number }): string | null {
  const name = file.name.trim();
  const extension = fileExtension(name);
  if (!name) return "The file has no name.";
  if (INTAKE_PDF_INSTEAD[extension]) {
    return `${name}: ${INTAKE_PDF_INSTEAD[extension]} files can't be read. Please export it as a PDF and share that.`;
  }
  if (!INTAKE_FILE_EXTENSIONS.includes(extension)) {
    return `${name}: this file type isn't supported. Use PDF, PowerPoint, Word, Excel, CSV, text or images.`;
  }
  if (file.size <= 0) return `${name} is empty.`;
  if (file.size > MATERIAL_MAX_BYTES) {
    return `${name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MATERIAL_MAX_BYTES)} per file.`;
  }
  return null;
}

/** What the founder has shared toward the intake's materials requirement. */
export type IntakeMaterialsState = {
  fileCount: number;
  /** The founder's reason for having no deck yet; empty otherwise. */
  noDeck: string;
};

/** At least one file, or a reason for having no deck yet. */
export function materialsProvided(materials: IntakeMaterialsState) {
  return materials.fileCount > 0 || materials.noDeck.trim().length > 0;
}

/**
 * The intake is complete once every required topic is covered and the
 * founder has shared materials (or said they have no deck yet).
 */
export function intakeReady(
  topics: IntakeTopic[],
  topicStatus: Record<string, TopicStatus>,
  materials: IntakeMaterialsState,
) {
  return intakeProgress(topics, topicStatus).ready && materialsProvided(materials);
}

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
    id: "traction",
    title: "Traction",
    guidance:
      "Key metrics that show progress, and revenue stage: pre-revenue, under $10k MRR, $10–100k MRR, or $100k+ MRR.",
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
      "Direct competitors investors would compare them to, by name, so Rupert can map the competitive landscape and avoid funds backing a competitor. \"None\" is a valid answer.",
    required: true,
  },
  {
    id: "anything_else",
    title: "Anything else",
    guidance:
      "Links worth sharing (data room, product demo, press), recent wins, and anything else the founder wants Rupert to know before preparing the campaign.",
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
 * Progress over required topics: the share that is covered. A partly
 * answered topic adds nothing yet, so the bar moves in even steps and only
 * reaches 100% when every required topic is covered (`ready`).
 */
export function intakeProgress(
  topics: IntakeTopic[],
  topicStatus: Record<string, TopicStatus>,
) {
  const required = topics.filter((topic) => topic.required);
  const scored = required.length > 0 ? required : topics;
  if (scored.length === 0) return { percent: 0, ready: false };

  const covered = scored.filter(
    (topic) => topicCoverage(topicStatus, topic.id) === "covered",
  ).length;

  return {
    percent: Math.round((covered / scored.length) * 100),
    ready: covered === scored.length,
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
 * run. Their title and wording can still be edited.
 *
 * Not asked, on purpose: the financing type (every SAFE, note or priced round
 * is equity, the default) and the investor types (set from the stage: VC,
 * angel groups and family offices at pre-seed and seed). A founder who
 * volunteers either still has it picked up from the conversation.
 */
export const MATCHING_TOPICS: Record<string, string> = {
  company: "HQ country and US state",
  sector: "Primary and secondary sectors",
  raise: "Stage",
  existing_and_exclusions: "Funds to exclude",
  competitors: "Competitive landscape (Step 2)",
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
