import { cache } from "react";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured, isSupabaseConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  placeholderAcknowledgements,
  placeholderCampaigns,
  placeholderClients,
  placeholderInvestors,
  placeholderReplies,
  placeholderScopeOfWork,
  placeholderServiceOrder,
} from "@/lib/placeholders";
import { createClient } from "@/lib/supabase/server";
import type {
  Acknowledgement,
  Campaign,
  Client,
  ClientStatus,
  Investor,
  InvestorReply,
} from "@/lib/types";

async function fromTable<T>(
  table: string,
  fallback: T[],
): Promise<T[]> {
  if (!isSupabaseConfigured()) return fallback;

  try {
    const supabase = createClient();
    const { data, error } = await supabase.from(table).select("*");
    if (error || !data) return fallback;
    return data as T[];
  } catch {
    return fallback;
  }
}

function asClient(row: Record<string, unknown>): Client {
  const firstName = row.first_name != null ? String(row.first_name) : "";
  const lastName = row.last_name != null ? String(row.last_name) : "";
  const email = String(row.email ?? row.founder_email ?? "");
  const vertical =
    row.vertical != null
      ? String(row.vertical)
      : row.sector != null
        ? String(row.sector)
        : null;
  const notes =
    row.admin_notes != null
      ? String(row.admin_notes)
      : row.notes != null
        ? String(row.notes)
        : null;
  const createdAt = String(row.created_at ?? new Date().toISOString());
  const status = (
    row.status === "onboarding" ||
    row.status === "preparation" ||
    row.status === "live" ||
    row.status === "paused" ||
    row.status === "completed"
      ? row.status
      : "onboarding"
  ) as ClientStatus;

  return {
    id: String(row.id),
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    email: email || undefined,
    company_name: String(row.company_name ?? ""),
    founder_name:
      [firstName, lastName].filter(Boolean).join(" ") ||
      String(row.founder_name ?? ""),
    founder_email: email,
    raise_stage: String(row.raise_stage ?? ""),
    raise_amount:
      row.raise_amount != null && String(row.raise_amount).length > 0
        ? String(row.raise_amount)
        : null,
    vertical,
    sector: vertical,
    geography: row.geography != null ? String(row.geography) : null,
    fund_match_count:
      typeof row.fund_match_count === "number"
        ? row.fund_match_count
        : row.fund_match_count != null && String(row.fund_match_count) !== ""
          ? Number(row.fund_match_count)
          : null,
    admin_notes: notes,
    notes,
    stage: row.stage != null ? String(row.stage) : undefined,
    statement_of_work_content:
      row.statement_of_work_content != null
        ? String(row.statement_of_work_content)
        : null,
    sow_confirmed_at:
      row.sow_confirmed_at != null ? String(row.sow_confirmed_at) : null,
    nda_signed_at:
      row.nda_signed_at != null ? String(row.nda_signed_at) : null,
    intake_completed_at:
      row.intake_completed_at != null
        ? String(row.intake_completed_at)
        : null,
    payment_received_at:
      row.payment_received_at != null
        ? String(row.payment_received_at)
        : null,
    pitch_deck_status:
      row.pitch_deck_status != null ? String(row.pitch_deck_status) : null,
    business_brief_status:
      row.business_brief_status != null
        ? String(row.business_brief_status)
        : null,
    outreach_messaging_status:
      row.outreach_messaging_status != null
        ? String(row.outreach_messaging_status)
        : null,
    investor_match_status:
      row.investor_match_status != null
        ? String(row.investor_match_status)
        : null,
    target_list_status:
      row.target_list_status != null
        ? String(row.target_list_status)
        : null,
    campaign_analytics_status:
      row.campaign_analytics_status != null
        ? String(row.campaign_analytics_status)
        : null,
    investor_inbox_status:
      row.investor_inbox_status != null
        ? String(row.investor_inbox_status)
        : null,
    engagement_tracker_status:
      row.engagement_tracker_status != null
        ? String(row.engagement_tracker_status)
        : null,
    service_order_content:
      row.service_order_content != null
        ? String(row.service_order_content)
        : null,
    service_order_agreed_at:
      row.service_order_agreed_at != null
        ? String(row.service_order_agreed_at)
        : null,
    linkedin_url:
      row.linkedin_url != null ? String(row.linkedin_url) : null,
    booking_link:
      row.booking_link != null ? String(row.booking_link) : null,
    company_website:
      row.company_website != null ? String(row.company_website) : null,
    company_description:
      row.company_description != null
        ? String(row.company_description)
        : null,
    status,
    archived_at:
      row.archived_at != null ? String(row.archived_at) : null,
    last_activity_at: String(row.last_activity_at ?? createdAt),
    created_at: createdAt,
  };
}

export async function listClients() {
  if (!isSupabaseConfigured()) return placeholderClients;

  if (isServiceRoleConfigured()) {
    try {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && data) {
        return data.map((row) => asClient(row as Record<string, unknown>));
      }
    } catch {
      // Fall through to the cookie-scoped lookup.
    }
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data.map((row) => asClient(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function getClient(id: string) {
  const clients = await listClients();
  return clients.find((client) => client.id === id) ?? null;
}

export async function getAdminClient(id: string) {
  if (isServiceRoleConfigured()) {
    try {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!error && data) {
        return asClient(data as Record<string, unknown>);
      }
    } catch {
      // Fall through to the cookie-scoped lookup.
    }
  }

  return getClient(id);
}

export const getPortalClient = cache(async (): Promise<Client | null> => {
  if (!isSupabaseConfigured()) {
    const preview = placeholderClients[2] ?? placeholderClients[0];
    return {
      ...preview,
      stage: "sow",
      statement_of_work_content: placeholderScopeOfWork,
      sow_confirmed_at: null,
      service_order_content: placeholderServiceOrder,
      service_order_agreed_at: null,
    };
  }

  const { user } = await getAuthContext();
  if (!user) return null;

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (!error && data) {
      return asClient(data as Record<string, unknown>);
    }
  } catch {
    // Fall through to the service-role lookup.
  }

  if (isServiceRoleConfigured()) {
    try {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (!error && data) {
        return asClient(data as Record<string, unknown>);
      }
    } catch {
      return null;
    }
  }

  return null;
});

export async function listAcknowledgements() {
  return fromTable<Acknowledgement>(
    "acknowledgements",
    placeholderAcknowledgements,
  );
}

export async function listInvestors() {
  return fromTable<Investor>("investors", placeholderInvestors);
}

export async function listReplies() {
  return fromTable<InvestorReply>("replies", placeholderReplies);
}

export async function listCampaigns() {
  return fromTable<Campaign>("campaigns", placeholderCampaigns);
}
