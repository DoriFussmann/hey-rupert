import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "@/app/admin/clients/[id]/client-form";
import { ClientActions } from "@/app/admin/clients/[id]/client-actions";
import { ClientStageSelect } from "@/app/admin/clients/[id]/stage-select";
import { GenerateStatementOfWork } from "@/app/admin/clients/[id]/generate-sow";
import { EngagementProgress } from "@/app/admin/clients/[id]/engagement-progress";
import { ProgressOverview } from "@/app/admin/clients/[id]/progress-overview";
import { getAdminClient, listSowSends } from "@/lib/data";
import { formatDate } from "@/lib/format";

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await getAdminClient(params.id);

  if (!client) {
    notFound();
  }

  const sends = await listSowSends(client.id);

  return (
    <>
      <p className="mb-md">
        <Link
          href="/admin"
          className="text-body-sm text-primary no-underline hover:text-primary-hover"
        >
          Clients
        </Link>
      </p>
      <PageHeader
        title={client.company_name}
        description={`${client.archived_at ? "Archived. " : ""}Opened ${formatDate(client.created_at)}. Last activity ${formatDate(client.last_activity_at)}.`}
        actions={
          <ClientStageSelect clientId={client.id} stage={client.stage} />
        }
      />
      <ProgressOverview
        stage={client.stage}
        timestamps={{
          sow_confirmed_at: client.sow_confirmed_at,
          service_order_agreed_at: client.service_order_agreed_at,
          nda_signed_at: client.nda_signed_at,
          intake_completed_at: client.intake_completed_at,
          payment_received_at: client.payment_received_at,
        }}
        statuses={{
          pitch_deck_status: client.pitch_deck_status,
          business_brief_status: client.business_brief_status,
          outreach_messaging_status: client.outreach_messaging_status,
          investor_match_status: client.investor_match_status,
          target_list_status: client.target_list_status,
          campaign_analytics_status: client.campaign_analytics_status,
          investor_inbox_status: client.investor_inbox_status,
          engagement_tracker_status: client.engagement_tracker_status,
        }}
      />
      <ClientForm client={client} />
      <EngagementProgress
        clientId={client.id}
        timestamps={{
          nda_signed_at: client.nda_signed_at,
          intake_completed_at: client.intake_completed_at,
          payment_received_at: client.payment_received_at,
        }}
        statuses={{
          pitch_deck_status: client.pitch_deck_status,
          business_brief_status: client.business_brief_status,
          outreach_messaging_status: client.outreach_messaging_status,
          investor_match_status: client.investor_match_status,
          target_list_status: client.target_list_status,
          campaign_analytics_status: client.campaign_analytics_status,
          investor_inbox_status: client.investor_inbox_status,
          engagement_tracker_status: client.engagement_tracker_status,
        }}
      />
      <ClientActions
        clientId={client.id}
        companyName={client.company_name}
        archived={Boolean(client.archived_at)}
      />
      <GenerateStatementOfWork
        clientId={client.id}
        sentContent={client.statement_of_work_content ?? ""}
        sends={sends}
      />
    </>
  );
}
