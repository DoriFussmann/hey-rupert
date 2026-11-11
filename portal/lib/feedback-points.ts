// Feedback points: a client's answer on a review step, and the viewers'
// comments, split into single points Rupert can reply to one by one. The
// rules live here (no server code) so they can be tested and shared.
import type { SetupHistoryEntry, SetupResponse } from "@/lib/setup";
import type { ViewerComment } from "@/lib/viewer-comments";

export const REPLY_MAX = 2000;

export const REPLY_STATUSES = ["open", "changed", "not_changing", "needs_input"] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

export const REPLY_STATUS_LABEL: Record<ReplyStatus, string> = {
  open: "Open",
  changed: "Changed",
  not_changing: "Not changing",
  needs_input: "Need your input",
};

export function isReplyStatus(value: unknown): value is ReplyStatus {
  return (REPLY_STATUSES as readonly unknown[]).includes(value);
}

export type FeedbackPoint = {
  id: string;
  version: number;
  source: "client" | "viewer";
  author: string;
  /** Where the point was made: "Competitor Investors · First email", "General", "Comment". */
  label: string;
  text: string;
  /** When it was written, when known. */
  at: string;
};

/** Rupert's side of a point: his working reply and what he last sent. */
export type ReplyState = {
  reply: string;
  status: ReplyStatus;
  publishedReply: string | null;
  publishedStatus: ReplyStatus | null;
  publishedAt: string | null;
};

export type InboxItem = FeedbackPoint & ReplyState;

export const EMPTY_REPLY: ReplyState = {
  reply: "",
  status: "open",
  publishedReply: null,
  publishedStatus: null,
  publishedAt: null,
};

/** A short, stable fingerprint of a text (FNV-1a, 32-bit, twice with different seeds). */
export function fingerprint(text: string) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x811c9dc5) + index;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

// The labels the portal puts in front of a point on one email.
const EMAIL_LABEL = /^(First email|Follow-up(?: \d)?|Both emails|All emails|Whole group):\s+/;

/**
 * Splits a note into its points. The portal sends points as lines starting
 * with "- "; a line that doesn't start that way continues the point above.
 * A note without such lines is one point.
 */
export function splitNote(note: string): { label: string; text: string }[] {
  const lines = String(note ?? "").replace(/\r\n/g, "\n").split("\n");
  const bulleted = lines.some((line) => line.startsWith("- "));
  const chunks: string[] = [];
  if (!bulleted) {
    chunks.push(lines.join("\n"));
  } else {
    for (const line of lines) {
      if (line.startsWith("- ")) chunks.push(line.slice(2));
      else if (chunks.length > 0) chunks[chunks.length - 1] += `\n${line}`;
      else if (line.trim()) chunks.push(line);
    }
  }
  return chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = EMAIL_LABEL.exec(chunk);
      return match
        ? { label: match[1], text: chunk.slice(match[0].length).trim() }
        : { label: "", text: chunk };
    })
    .filter((part) => part.text);
}

/** The points in one answer from the client. */
export function pointsFromResponse(response: SetupResponse, author: string): FeedbackPoint[] {
  const points: FeedbackPoint[] = [];
  const seen = new Map<string, number>();
  const add = (key: string, group: string, part: { label: string; text: string }) => {
    const base = `c${response.version}-${fingerprint(`${key}|${part.label}|${part.text}`)}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    points.push({
      id: count === 1 ? base : `${base}-${count}`,
      version: response.version,
      source: "client",
      author: author || "Client",
      label: [group, part.label].filter(Boolean).join(" · ") || "General",
      text: part.text,
      at: response.at,
    });
  };
  for (const part of splitNote(response.note)) add("note", "", part);
  for (const [key, note] of Object.entries(response.item_notes ?? {})) {
    const group = response.item_labels?.[key] ?? key;
    for (const part of splitNote(note)) add(key, group, part);
  }
  return points;
}

/**
 * Every point on a step, newest version first: the client's answers (from the
 * step's history), then the viewers' comments on that version.
 */
export function collectPoints({
  history,
  response,
  comments,
  clientName,
}: {
  history: SetupHistoryEntry[];
  /** The current answer, in case the history doesn't carry it. */
  response: SetupResponse | null;
  comments: ViewerComment[];
  clientName: string;
}): FeedbackPoint[] {
  const answers = new Map<number, SetupResponse>();
  for (const entry of history) if (entry.response) answers.set(entry.version, entry.response);
  if (response && !answers.has(response.version)) answers.set(response.version, response);

  const versions = new Set<number>([...Array.from(answers.keys()), ...comments.map((comment) => comment.version)]);
  const points: FeedbackPoint[] = [];
  for (const version of Array.from(versions).sort((a, b) => b - a)) {
    const answer = answers.get(version);
    if (answer) points.push(...pointsFromResponse(answer, clientName));
    for (const comment of comments) {
      if (comment.version !== version) continue;
      points.push({
        id: `v-${comment.id}`,
        version,
        source: "viewer",
        author: comment.viewerName,
        label: "Comment",
        text: comment.body,
        at: comment.createdAt,
      });
    }
  }
  return points;
}

/** A reply or a status Rupert has set: something there is to send. */
export function hasReply(state: Pick<ReplyState, "reply" | "status">) {
  return Boolean(state.reply.trim()) || state.status !== "open";
}

/** Set, and not yet sent as it now stands. */
export function isUnsent(state: ReplyState) {
  if (!hasReply(state)) return false;
  return (
    !state.publishedAt ||
    state.reply.trim() !== (state.publishedReply ?? "").trim() ||
    state.status !== state.publishedStatus
  );
}

/** The reply as it is saved, or why it can't be. */
export function cleanReply(value: unknown): { ok: true; reply: string } | { ok: false; error: string } {
  const reply = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  if (reply.length > REPLY_MAX) {
    return {
      ok: false,
      error: `A reply is ${reply.length.toLocaleString("en-US")} characters. The limit is ${REPLY_MAX.toLocaleString("en-US")}.`,
    };
  }
  return { ok: true, reply };
}

export type SentReply = {
  author: string;
  source: "client" | "viewer";
  label: string;
  point: string;
  reply: string;
  status: ReplyStatus;
};

/** The email that goes with "Respond": every reply being sent, point by point. */
export function replyEmail({
  firstName,
  stepLabel,
  version,
  replies,
  portalUrl,
  signature,
}: {
  firstName: string;
  stepLabel: string;
  version: number;
  replies: SentReply[];
  portalUrl: string;
  signature: string;
}) {
  const count = replies.length;
  const blocks = replies.map((item, index) => {
    const who = item.source === "viewer" ? `${item.author} (viewer)` : item.author;
    const where = item.label && item.label !== "General" ? `, ${item.label}` : "";
    const outcome = item.status === "open" ? "" : `${REPLY_STATUS_LABEL[item.status]}.`;
    const answer = [outcome, item.reply].filter(Boolean).join(" ");
    return `${index + 1}. ${who}${where}:\n"${item.point}"\n\nMy reply: ${answer}`;
  });
  return {
    subject: `My replies to your feedback on the ${stepLabel}`,
    body: [
      `Hi ${firstName || "there"},`,
      `I've gone through the feedback on version ${version} of the ${stepLabel}. Here ${count === 1 ? "is my reply" : `are my ${count} replies`}, point by point. You can also see ${count === 1 ? "it" : "them"} in the portal, under each point.`,
      ...blocks,
      `Open your portal: ${portalUrl}`,
      signature,
    ].join("\n\n"),
  };
}
