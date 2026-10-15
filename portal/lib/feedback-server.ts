import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { notifyAdmin } from "@/lib/notify";
import type { SetupStepState } from "@/lib/setup";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Records the first time the client opens the current feedback version and
 * tells Rupert (in-app; email only if switched on in Forms → Emails).
 * Best effort: a failure never blocks the page.
 */
export async function markFeedbackViewed(
  supabase: ServiceClient,
  row: SetupStepState,
) {
  if (row.status !== "published" || row.client_viewed_at) return;

  const { data, error } = await supabase
    .from("setup_steps")
    .update({ client_viewed_at: new Date().toISOString() })
    .eq("client_id", row.client_id)
    .eq("step", "deck_review")
    .eq("version", row.version)
    .is("client_viewed_at", null)
    .select("client_id");

  if (error) {
    console.error(`Feedback view not recorded: ${error.message}`);
    return;
  }
  if (!data || data.length === 0) return;

  await notifyAdmin(supabase, row.client_id, "feedback_viewed", {
    email: true,
    details:
      row.version > 1 ? `They opened version ${row.version}.` : undefined,
  });
}
