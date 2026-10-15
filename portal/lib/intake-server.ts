import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { callClaudeTool, type ClaudeMessage } from "@/lib/anthropic";
import {
  asIntakeBrief,
  DEFAULT_INTAKE_PROMPT,
  DEFAULT_INTAKE_TOPICS,
  INTAKE_PROMPT_SLUG,
  intakeMessageText,
  INTAKE_TOPICS_SLUG,
  isTopicCoverage,
  parseIntakeTopics,
  topicCoverage,
  type IntakeInterview,
  type IntakeMessage,
  type IntakeSummaryItem,
  type IntakeTopic,
  type TopicCoverage,
  type TopicStatus,
} from "@/lib/intake";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type IntakeSettings = { prompt: string; topics: IntakeTopic[] };

export async function loadIntakeSettings(
  supabase: ServiceClient,
): Promise<IntakeSettings> {
  const { data } = await supabase
    .from("form_templates")
    .select("slug, content")
    .in("slug", [INTAKE_PROMPT_SLUG, INTAKE_TOPICS_SLUG]);

  const rows = new Map(
    (data ?? []).map((row) => [String(row.slug), String(row.content ?? "")]),
  );

  const prompt = rows.get(INTAKE_PROMPT_SLUG)?.trim() || DEFAULT_INTAKE_PROMPT;

  let topics = DEFAULT_INTAKE_TOPICS;
  const rawTopics = rows.get(INTAKE_TOPICS_SLUG);
  if (rawTopics) {
    try {
      topics = parseIntakeTopics(JSON.parse(rawTopics)) ?? DEFAULT_INTAKE_TOPICS;
    } catch {
      topics = DEFAULT_INTAKE_TOPICS;
    }
  }

  return { prompt, topics };
}

function asMessages(value: unknown): IntakeMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .filter((item) => item.role === "assistant" || item.role === "user")
    .map((item) => {
      const message: IntakeMessage = {
        role: item.role as "assistant" | "user",
        content: String(item.content ?? ""),
        at: String(item.at ?? ""),
      };
      const file = item.attachment;
      if (file && typeof file === "object") {
        const entry = file as Record<string, unknown>;
        message.attachment = {
          name: String(entry.name ?? "file"),
          path: String(entry.path ?? ""),
          facts: String(entry.facts ?? ""),
        };
      }
      return message;
    });
}

function asTopicStatus(value: unknown): Record<string, TopicStatus> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, TopicStatus> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (!isTopicCoverage(entry.status)) continue;
    result[id] = { status: entry.status, note: String(entry.note ?? "") };
  }
  return result;
}

function asSummary(value: unknown): IntakeSummaryItem[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .map((item) => ({
      topic_id: String(item.topic_id ?? ""),
      title: String(item.title ?? ""),
      answer: String(item.answer ?? ""),
    }));
}

export function asIntakeInterview(row: Record<string, unknown>): IntakeInterview {
  const status =
    row.status === "review" || row.status === "completed"
      ? row.status
      : "in_progress";
  return {
    client_id: String(row.client_id),
    messages: asMessages(row.messages),
    topic_status: asTopicStatus(row.topic_status),
    summary: asSummary(row.summary),
    admin_brief: asIntakeBrief(row.admin_brief),
    status,
    client_message_count:
      typeof row.client_message_count === "number"
        ? row.client_message_count
        : 0,
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

export async function loadInterview(
  supabase: ServiceClient,
  clientId: string,
): Promise<{ ok: true; interview: IntakeInterview | null } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("intake_interviews")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    interview: data ? asIntakeInterview(data as Record<string, unknown>) : null,
  };
}

const CONTEXT_FIELDS: [string, string][] = [
  ["company_name", "Company"],
  ["company_website", "Website"],
  ["company_description", "Description"],
  ["raise_stage", "Raise stage"],
  ["raise_amount", "Raise amount"],
  ["vertical", "Vertical"],
  ["geography", "Geography"],
  ["linkedin_url", "Founder LinkedIn"],
  ["booking_link", "Booking link"],
  ["admin_notes", "Notes from Rupert's team"],
];

const SOW_CONTEXT_LIMIT = 4000;

/** What Rupert already knows about the company, as plain text. */
export function buildClientContext(client: Record<string, unknown>) {
  const name = [client.first_name, client.last_name]
    .map((part) => (part != null ? String(part).trim() : ""))
    .filter(Boolean)
    .join(" ");
  const lines = name ? [`Founder: ${name}`] : [];

  for (const [field, label] of CONTEXT_FIELDS) {
    const value = client[field] != null ? String(client[field]).trim() : "";
    if (value) lines.push(`${label}: ${value}`);
  }

  const sow =
    client.statement_of_work_content != null
      ? String(client.statement_of_work_content).trim()
      : "";
  if (sow) {
    lines.push(
      "",
      "Statement of Work the founder confirmed (for background only):",
      sow.slice(0, SOW_CONTEXT_LIMIT),
    );
  }

  return lines.length > 0 ? lines.join("\n") : "Nothing yet beyond the company name.";
}

function topicsBlock(
  topics: IntakeTopic[],
  topicStatus: Record<string, TopicStatus>,
) {
  return topics
    .map((topic) => {
      const coverage = topicCoverage(topicStatus, topic.id);
      const note = topicStatus[topic.id]?.note;
      return `- [${topic.id}] ${topic.title} (${
        topic.required ? "required" : "optional"
      }; currently ${coverage}${note ? `: ${note}` : ""})\n  Need to learn: ${topic.guidance}`;
    })
    .join("\n");
}

function systemPrompt(
  settings: IntakeSettings,
  context: string,
  topicStatus: Record<string, TopicStatus>,
) {
  return [
    settings.prompt,
    "## What you already know about the company",
    context,
    "## Interview topics",
    topicsBlock(settings.topics, topicStatus),
    "## When the essentials are done",
    "The intake is complete as soon as every required topic is covered: Rupert then has what he needs to start, and the founder is notified that the essentials are done. When your topic update marks the last required topic as covered (in this turn or earlier), make this clear in your reply, once: say warmly that the essentials are done and Rupert has what he needs to get started; then name the remaining optional topics, explain in one sentence that a few more minutes on them can make the campaign noticeably sharper, recommend continuing, and ask whether they would like to. If they prefer to stop, thank them and tell them they are all set. If every topic, required and optional, is covered, thank them and say they can review their summary anytime. This section overrides any earlier instruction about when to offer the summary.",
    "## How to respond",
    "Always respond by calling the `respond` tool. `reply` is the message the founder sees. `topics` reports the coverage of EVERY topic after this turn: `covered` when you have what the topic needs, `partial` when you have some of it, `missing` otherwise. `note` is a short factual summary of what you have learned for that topic so far (empty if nothing). Count information you already knew from the company details as known.",
  ].join("\n\n");
}

// The API requires the conversation to start with a user turn.
const OPENING_USER_TURN =
  "[The founder has just opened the intake interview. Greet them by first name if you know it, explain in one sentence what this is for and roughly how long it takes, then ask your first question.]";

function toClaudeMessages(messages: IntakeMessage[]): { role: "user" | "assistant"; content: string }[] {
  const turns: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: OPENING_USER_TURN },
  ];
  for (const message of messages) {
    const last = turns[turns.length - 1];
    const content = intakeMessageText(message);
    if (last.role === message.role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      turns.push({ role: message.role, content });
    }
  }
  return turns;
}

const RESPOND_TOOL = {
  name: "respond",
  description:
    "Send the next interview message to the founder and report topic coverage.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "The message to show the founder.",
      },
      topics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["missing", "partial", "covered"] },
            note: { type: "string" },
          },
          required: ["id", "status", "note"],
        },
      },
      document_facts: {
        type: "string",
        description:
          "Only when the founder just shared a file: everything in it that matters for the interview topics, as a compact factual list (at most about 1,500 characters). Empty otherwise.",
      },
    },
    required: ["reply", "topics"],
  },
};

export type InterviewTurn = {
  reply: string;
  topics: { id: string; status: TopicCoverage; note: string }[];
  /** What Rupert took from a file shared in this turn. */
  documentFacts: string;
};

function readTurn(input: unknown): InterviewTurn | null {
  if (!input || typeof input !== "object") return null;
  const value = input as { reply?: unknown; topics?: unknown; document_facts?: unknown };
  const reply = typeof value.reply === "string" ? value.reply.trim() : "";
  if (!reply) return null;

  const topics = Array.isArray(value.topics)
    ? value.topics
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
        .filter((item) => isTopicCoverage(item.status))
        .map((item) => ({
          id: String(item.id ?? ""),
          status: item.status as TopicCoverage,
          note: String(item.note ?? "").slice(0, 500),
        }))
    : [];

  const documentFacts =
    typeof value.document_facts === "string" ? value.document_facts.trim().slice(0, 3000) : "";
  return { reply, topics, documentFacts };
}

/** A PDF the founder shares in this turn, read once. */
export type SharedDocument = { name: string; base64: string };

// Reading a deck takes longer than a chat reply.
const DOCUMENT_TURN_TIMEOUT_MS = 100_000;

/** Asks Claude for Rupert's next message, given the conversation so far. */
export async function nextInterviewTurn(
  settings: IntakeSettings,
  client: Record<string, unknown>,
  messages: IntakeMessage[],
  topicStatus: Record<string, TopicStatus>,
  document?: SharedDocument,
): Promise<{ ok: true; turn: InterviewTurn } | { ok: false; reason: string }> {
  const turns: ClaudeMessage[] = toClaudeMessages(messages);
  const last = turns[turns.length - 1];
  if (document && last.role === "user" && typeof last.content === "string") {
    // The file goes in with the founder's latest turn.
    last.content = [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: document.base64 },
        title: document.name,
      },
      {
        type: "text",
        text: `${last.content}\n\n[${document.name} is attached. Read it, mark every topic it answers as covered or partial, fill document_facts, then thank the founder briefly and ask only about what is still missing.]`,
      },
    ];
  }

  const result = await callClaudeTool<unknown>({
    system: systemPrompt(settings, buildClientContext(client), topicStatus),
    messages: turns,
    tool: RESPOND_TOOL,
    maxTokens: document ? 3000 : 1024,
    timeoutMs: document ? DOCUMENT_TURN_TIMEOUT_MS : undefined,
    // A plain-text answer is still shown to the client; topic coverage is
    // simply left unchanged for that turn.
    fallbackFromText: (text) => ({ reply: text, topics: [] }),
  });
  if (!result.ok) return result;

  const turn = readTurn(result.input);
  return turn
    ? { ok: true, turn }
    : { ok: false, reason: "Claude returned an empty reply." };
}

const SUMMARY_TOOL = {
  name: "summarize",
  description: "Write the intake summary, one entry per topic.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic_id: { type: "string" },
            answer: { type: "string" },
          },
          required: ["topic_id", "answer"],
        },
      },
    },
    required: ["items"],
  },
};

/** Asks Claude for a concise, factual summary per topic. */
export async function writeInterviewSummary(
  settings: IntakeSettings,
  client: Record<string, unknown>,
  messages: IntakeMessage[],
  topicStatus: Record<string, TopicStatus>,
): Promise<{ ok: true; items: IntakeSummaryItem[] } | { ok: false; reason: string }> {
  const transcript = messages
    .map((message) =>
      `${message.role === "assistant" ? "Rupert" : "Founder"}: ${intakeMessageText(message)}`,
    )
    .join("\n\n");

  const system = [
    "You write the intake summary for Hey Rupert's team from an interview with a founder.",
    "For each topic, write a concise, factual answer in plain sentences or short lists, using only what the founder said or what was already known. If nothing was learned for a topic, answer exactly \"Not provided.\" Do not add opinions or advice.",
    "## What was already known",
    buildClientContext(client),
    "## Topics",
    topicsBlock(settings.topics, topicStatus),
  ].join("\n\n");

  const result = await callClaudeTool<{ items?: unknown }>({
    system,
    messages: [
      {
        role: "user",
        content: `Interview transcript:\n\n${transcript}\n\nWrite the summary by calling the summarize tool, with one item for every topic.`,
      },
    ],
    tool: SUMMARY_TOOL,
    maxTokens: 2048,
  });
  if (!result.ok) return result;

  const raw = Array.isArray(result.input.items) ? result.input.items : [];
  const answers = new Map<string, string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    answers.set(String(entry.topic_id ?? ""), String(entry.answer ?? "").trim());
  }

  return {
    ok: true,
    items: settings.topics.map((topic) => ({
      topic_id: topic.id,
      title: topic.title,
      answer: answers.get(topic.id) || "Not provided.",
    })),
  };
}
