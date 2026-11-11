import "server-only";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  isViewerCommentStep,
  type ViewerComment,
  type ViewerCommentStep,
} from "@/lib/viewer-comments";

const TABLE = "viewer_comments";
const COLUMNS = "id, step, version, viewer_name, body, created_at";

function asComment(row: Record<string, unknown>): ViewerComment | null {
  if (!isViewerCommentStep(row.step)) return null;
  return {
    id: String(row.id),
    step: row.step,
    version: Number(row.version) || 0,
    viewerName: String(row.viewer_name ?? "") || "A viewer",
    body: String(row.body ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

/**
 * A client's viewer comments, oldest first: all of them, or one step's.
 * Never throws and returns nothing when the table isn't there yet, so the
 * pages that show comments keep working.
 */
export async function listViewerComments(
  clientId: string,
  step?: ViewerCommentStep,
): Promise<ViewerComment[]> {
  if (!isServiceRoleConfigured()) return [];
  try {
    let query = createServiceClient().from(TABLE).select(COLUMNS).eq("client_id", clientId);
    if (step) query = query.eq("step", step);
    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) return [];
    return (data ?? [])
      .map((row) => asComment(row as Record<string, unknown>))
      .filter((comment): comment is ViewerComment => comment !== null);
  } catch {
    return [];
  }
}
