import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { notifyAdmin } from "@/lib/notify";
import { isKickoffReady } from "@/lib/service-order";

type ServiceClient = ReturnType<typeof createServiceClient>;

// Stages a client can be in before kick-off. The conditional update below
// makes the transition happen exactly once, even if the Service Order is
// signed and the payment is marked at the same moment.
const PRE_KICKOFF_STAGES = "stage.is.null,stage.in.(sow,service_order,payment)";

/**
 * Moves the client to the NDA stage once the Service Order is signed and the
 * Setup Fee is received, and tells the admin it is their turn.
 * Returns true only on the call that performed the transition.
 */
export async function advanceToKickoff(
  supabase: ServiceClient,
  clientId: string,
  { email }: { email: boolean },
) {
  const { data: client, error: loadError } = await supabase
    .from("clients")
    .select("id, service_order_agreed_at, payment_received_at")
    .eq("id", clientId)
    .maybeSingle();

  if (loadError || !client || !isKickoffReady(client)) return false;

  const { data: updated, error } = await supabase
    .from("clients")
    .update({ stage: "nda" })
    .eq("id", clientId)
    .or(PRE_KICKOFF_STAGES)
    .select("id");

  if (error) {
    console.error(`Kick-off stage update failed: ${error.message}`);
    return false;
  }
  if (!updated || updated.length === 0) return false;

  await notifyAdmin(supabase, clientId, "kickoff_ready", { email });
  return true;
}
