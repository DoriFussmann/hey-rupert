import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "@/app/admin/clients/[id]/client-form";
import { ClientActions } from "@/app/admin/clients/[id]/client-actions";
import { ResetPasswordSection } from "@/app/admin/clients/[id]/reset-password";
import { ClientStageSelect } from "@/app/admin/clients/[id]/stage-select";
import { GenerateStatementOfWork } from "@/app/admin/clients/[id]/generate-sow";
import { GenerateServiceOrder } from "@/app/admin/clients/[id]/generate-service-order";
import { EngagementProgress } from "@/app/admin/clients/[id]/engagement-progress";
import { ProgressOverview } from "@/app/admin/clients/[id]/progress-overview";
import { ViewAsClientLink } from "@/components/eye-icon";
import {
  getAdminClient,
  listServiceOrderSends,
  listSowSends,
} from "@/lib/data";
import { formatDate } from "@/lib/format";
import { isKickoffReady, kickoffDate } from "@/lib/service-order";
import { getClientAccess } from "@/lib/password-setup";

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await getAdminClient(params.id);

  if (!client) {
    notFound();
  }

  const [sends, serviceOrderSends, access] = await Promise.all([
    listSowSends(client.id),
    listServiceOrderSends(client.id),
    getClientAccess(client.id),
  ]);

  const kickedOffAt = kickoffDate(client);
  const awaitingNda = isKickoffReady(client) && !client.nda_signed_at;

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
          <div className="flex flex-wrap items-end gap-md">
            <ViewAsClientLink
              clientId={client.id}
              label={client.company_name}
              variant="button"
            />
            <ClientStageSelect clientId={client.id} stage={client.stage} />
          </div>
        }
      />
      {awaitingNda ? (
        <section
          role="status"
          className="mb-lg rounded-card border border-primary/30 bg-primary-tint px-lg py-md"
        >
          <p className="text-label uppercase tracking-label text-primary">
            Your turn
          </p>
          <p className="mt-xs text-body-sm text-heading">
            Kick-off ready
            {kickedOffAt ? ` since ${formatDate(kickedOffAt)}` : ""}: the
            Service Order is signed and the Setup Fee is received. Issue the
            NDA.
          </p>
        </section>
      ) : null}
      <ProgressOverview
        stage={client.stage}
        timestamps={{
          sow_confirmed_at: client.sow_confirmed_at,
          service_order_content: client.service_order_content,
          service_order_agreed_at: client.service_order_agreed_at,
          setup_invoice_url: client.setup_invoice_url,
          payment_received_at: client.payment_received_at,
          nda_signed_at: client.nda_signed_at,
          intake_completed_at: client.intake_completed_at,
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
      <ResetPasswordSection
        clientId={client.id}
        companyName={client.company_name}
        firstName={client.first_name ?? ""}
        email={client.email ?? ""}
        access={access}
      />
      <GenerateStatementOfWork
        clientId={client.id}
        sentContent={client.statement_of_work_content ?? ""}
        sends={sends}
      />
      <GenerateServiceOrder
        clientId={client.id}
        sends={serviceOrderSends}
        paymentReceivedAt={client.payment_received_at ?? null}
      />
    </>
  );
}
