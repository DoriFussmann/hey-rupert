import "server-only";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  EMPTY_REPLY,
  isReplyStatus,
  type FeedbackPoint,
  type InboxItem,
  type ReplyState,
  type ReplyStatus,
} from "@/lib/feedback-points";
import { isViewerCommentStep, type ViewerCommentStep } from "@/lib/viewer-comments";

export const FEEDBACK_REPLIES_TABLE = "feedback_replies";

/** One saved row: the point as it was written, and Rupert's reply to it. */
export type ReplyRow = ReplyState & {
  pointId: string;
  step: ViewerCommentStep;
  version: number;
  source: "client" | "viewer";
  author: string;
  label: string;
  point: string;
};

const COLUMNS =
  "point_id, step, version, source, author, label, point, reply, status, published_reply, published_status, published_at";

function asRow(raw: Record<string, unknown>): ReplyRow | null {
  if (!isViewerCommentStep(raw.step)) return null;
  return {
    pointId: String(raw.point_id ?? ""),
    step: raw.step,
    version: Number(raw.version) || 0,
    source: raw.source === "viewer" ? "viewer" : "client",
    author: String(raw.author ?? ""),
    label: String(raw.label ?? ""),
    point: String(raw.point ?? ""),
    reply: String(raw.reply ?? ""),
    status: isReplyStatus(raw.status) ? raw.status : "open",
    publishedReply: raw.published_reply == null ? null : String(raw.published_reply),
    publishedStatus: isReplyStatus(raw.published_status) ? (raw.published_status as ReplyStatus) : null,
    publishedAt: raw.published_at == null ? null : String(raw.published_at),
  };
}

/**
 * A client's reply rows, newest version first and in the order the feedback
 * was given: all of them, or one step's. Never throws and returns
 * nothing when the table isn't there yet, so the pages that use it keep working.
 */
export async function listReplyRows(clientId: string, step?: ViewerCommentStep): Promise<ReplyRow[]> {
  if (!isServiceRoleConfigured()) return [];
  try {
    let query = createServiceClient().from(FEEDBACK_REPLIES_TABLE).select(COLUMNS).eq("client_id", clientId);
    if (step) query = query.eq("step", step);
    const { data, error } = await query
      .order("version", { ascending: false })
      .order("position", { ascending: true });
    if (error) return [];
    return (data ?? [])
      .map((row) => asRow(row as Record<string, unknown>))
      .filter((row): row is ReplyRow => row !== null);
  } catch {
    return [];
  }
}

/** Each point with Rupert's reply to it (empty when he hasn't written one). */
export function withReplies(points: FeedbackPoint[], rows: ReplyRow[], step: ViewerCommentStep): InboxItem[] {
  const byId = new Map(rows.filter((row) => row.step === step).map((row) => [row.pointId, row]));
  return points.map((point) => {
    const row = byId.get(point.id);
    return row
      ? {
          ...point,
          reply: row.reply,
          status: row.status,
          publishedReply: row.publishedReply,
          publishedStatus: row.publishedStatus,
          publishedAt: row.publishedAt,
        }
      : { ...point, ...EMPTY_REPLY };
  });
}
