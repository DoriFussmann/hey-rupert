import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { asDealsDeck, type DealsDeck } from "./core.ts";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The client's current Competitive Landscape & Deals deck, or null. Null too
 * when the table is not there yet (portal/supabase/deals_deck.sql) or the
 * stored deck is malformed: the page simply shows no button.
 */
export async function loadDealsDeck(supabase: ServiceClient, clientId: string): Promise<DealsDeck | null> {
  const { data, error } = await supabase
    .from("client_deal_decks")
    .select("content")
    .eq("client_id", clientId)
    .is("cleared_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ content: unknown }>();
  if (error || !data) return null;
  return asDealsDeck(data.content);
}
