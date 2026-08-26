export type ClientStatus =
  | "onboarding"
  | "preparation"
  | "live"
  | "paused"
  | "completed";

export type RaiseStage = "Pre-seed" | "Seed" | "Series A";

export type EngagementStage = "scope_of_work" | "service_order" | "live";

export const ENGAGEMENT_STAGES: { value: EngagementStage; label: string }[] = [
  { value: "scope_of_work", label: "Scope of Work" },
  { value: "service_order", label: "Service Order" },
  { value: "live", label: "Live" },
];

export function isEngagementStage(
  value: string | null | undefined,
): value is EngagementStage {
  return (
    value === "scope_of_work" ||
    value === "service_order" ||
    value === "live"
  );
}

export type Client = {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  company_name: string;
  founder_name: string;
  founder_email: string;
  raise_stage: string;
  raise_amount: string | null;
  vertical?: string | null;
  sector: string | null;
  geography?: string | null;
  fund_match_count?: number | null;
  admin_notes?: string | null;
  notes: string | null;
  stage?: string;
  scope_of_work_content?: string | null;
  scope_acknowledged_at?: string | null;
  service_order_content?: string | null;
  service_order_agreed_at?: string | null;
  linkedin_url?: string | null;
  booking_link?: string | null;
  company_website?: string | null;
  company_description?: string | null;
  status: ClientStatus;
  last_activity_at: string;
  created_at: string;
};

export type ReviewStatus = "pending" | "acknowledged" | "changes_requested";

export type AcknowledgementType =
  | "scope_of_work"
  | "service_order"
  | "deck"
  | "abstract"
  | "messaging"
  | "investor_list";

export type Acknowledgement = {
  id: string;
  client_id: string;
  company_name: string;
  type: AcknowledgementType;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type InvestorStatus =
  | "identified"
  | "queued"
  | "contacted"
  | "replied"
  | "meeting"
  | "passed";

export type Investor = {
  id: string;
  fund: string;
  partner: string;
  thesis: string;
  check_size: string;
  geography: string;
  status: InvestorStatus;
};

export type InvestorReply = {
  id: string;
  investor: string;
  fund: string;
  subject: string;
  preview: string;
  body: string;
  received_at: string;
  unread: boolean;
};

export type CampaignStats = {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  meetings: number;
};

export type Campaign = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  stats: CampaignStats;
};

export type NotificationType = "scope_acknowledged" | "service_order_agreed" | string;

export type AdminNotification = {
  id: string;
  client_id: string;
  type: NotificationType;
  read: boolean;
  created_at: string;
  client_name: string;
  company_name: string;
};
