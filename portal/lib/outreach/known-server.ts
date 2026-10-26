import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { asWarmIntroStatus, type WarmIntroStatus } from "@/lib/outreach/campaign";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type KnownFundRow = {
  firm_id: string;
  fund_name: string;
  status: WarmIntroStatus;
  client_note: string;
  override: boolean;
  override_by: string | null;
  override_at: string | null;
  updated_at: string;
};

/** The client's known funds: warm-intro progress and Rupert's overrides. Empty when the table is missing. */
export async function loadKnownFundRows(supabase: ServiceClient, clientId: string): Promise<KnownFundRow[]> {
  const { data, error } = await supabase.from("outreach_known_funds").select("*").eq("client_id", clientId);
  if (error || !data) return [];
  return data.map((row) => ({
    firm_id: String(row.firm_id),
    fund_name: String(row.fund_name ?? ""),
    status: asWarmIntroStatus(row.status),
    client_note: String(row.client_note ?? ""),
    override: Boolean(row.override),
    override_by: row.override_by ? String(row.override_by) : null,
    override_at: row.override_at ? String(row.override_at) : null,
    updated_at: String(row.updated_at ?? ""),
  }));
}

/** Known funds Rupert put back into the campaign, by FirmID. */
export async function loadOverrides(supabase: ServiceClient, clientId: string): Promise<Set<string>> {
  const rows = await loadKnownFundRows(supabase, clientId);
  return new Set(rows.filter((row) => row.override).map((row) => row.firm_id));
}
