"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { notifyAdmin } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/viewers";
import {
  VIEWER_COMMENTS_PER_DAY,
  VIEWER_COMMENT_STEP_LABEL,
  VIEWER_COMMENT_STEP_PATH,
  cleanViewerComment,
  isViewerCommentStep,
  viewerDisplayName,
} from "@/lib/viewer-comments";

export type ViewerCommentResult = { ok: true } | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A viewer's comment on a review step. Viewers stay view-only: this is the
 * one thing they can add, it changes nothing on the step, and it is saved
 * under their name for Rupert and the client to read.
 */
export async function addViewerComment(step: unknown, text: unknown): Promise<ViewerCommentResult> {
  const { user, role } = await getAuthContext();
  if (!user || role !== "viewer") {
    return { ok: false, error: "Only viewers can leave a comment here." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false, error: "Service role key is not configured." };
  }
  if (!isViewerCommentStep(step)) {
    return { ok: false, error: "Comments are not open on this page." };
  }
  const cleaned = cleanViewerComment(text);
  if (!cleaned.ok) return cleaned;

  const supabase = createServiceClient();
  // The client comes from the viewer's own row, never from the browser.
  const found = await getViewer(supabase, user.id);
  if (!found.ok) return { ok: false, error: found.error };
  const viewer = found.viewer;
  if (!viewer) return { ok: false, error: "Your viewer access could not be found." };

  const { data: stepRow, error: stepError } = await supabase
    .from("setup_steps")
    .select("version")
    .eq("client_id", viewer.clientId)
    .eq("step", step)
    .maybeSingle();
  if (stepError) return { ok: false, error: stepError.message };
  const version = Number(stepRow?.version) || 0;
  if (version < 1) return { ok: false, error: "There is nothing to comment on here yet." };

  const { count, error: countError } = await supabase
    .from("viewer_comments")
    .select("id", { count: "exact", head: true })
    .eq("viewer_id", viewer.id)
    .gt("created_at", new Date(Date.now() - DAY_MS).toISOString());
  if (countError) {
    return { ok: false, error: "Comments are not set up yet. Please email Rupert instead." };
  }
  if ((count ?? 0) >= VIEWER_COMMENTS_PER_DAY) {
    return { ok: false, error: "That's the limit for one day. Please email Rupert with the rest." };
  }

  const name = viewerDisplayName(viewer.firstName, viewer.lastName);
  const { error } = await supabase.from("viewer_comments").insert({
    client_id: viewer.clientId,
    viewer_id: viewer.id,
    viewer_name: name,
    step,
    version,
    body: cleaned.body,
  });
  if (error) return { ok: false, error: error.message };

  // Best effort: the comment is saved, the email must not undo that.
  try {
    await notifyAdmin(supabase, viewer.clientId, "viewer_commented", {
      email: true,
      details: `${name} (viewer, ${viewer.email}) commented on ${VIEWER_COMMENT_STEP_LABEL[step]}, version ${version}:\n\n${cleaned.body}`,
    });
  } catch (notifyError) {
    console.error("Viewer comment notification failed", notifyError);
  }

  revalidatePath(VIEWER_COMMENT_STEP_PATH[step]);
  revalidatePath(`/admin/clients/${viewer.clientId}`);
  return { ok: true };
}
