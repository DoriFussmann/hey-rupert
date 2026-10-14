import { Fragment } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getIntakeSettings } from "@/app/admin/actions";
import { ClientForm } from "@/app/admin/clients/[id]/client-form";
import { ClientActions } from "@/app/admin/clients/[id]/client-actions";
import { ResetPasswordSection } from "@/app/admin/clients/[id]/reset-password";
import { ClientStageSelect } from "@/app/admin/clients/[id]/stage-select";
import { GenerateStatementOfWork } from "@/app/admin/clients/[id]/generate-sow";
import { GenerateServiceOrder } from "@/app/admin/clients/[id]/generate-service-order";
import { GenerateNda } from "@/app/admin/clients/[id]/generate-nda";
import { IntakePanel } from "@/app/admin/clients/[id]/intake-panel";
import { EngagementProgress } from "@/app/admin/clients/[id]/engagement-progress";
import { ProgressOverview } from "@/app/admin/clients/[id]/progress-overview";
import { SetupWorkspace } from "@/app/admin/clients/[id]/setup/setup-workspace";
import { ClientEmails } from "@/app/admin/clients/[id]/client-emails";
import { ClientTimeline } from "@/app/admin/clients/[id]/client-timeline";
import { CompletedPanel } from "@/components/completed-panel";
import { ViewAsClientLink } from "@/components/eye-icon";
import { listEmailLog, type EmailLogResult } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import { DEFAULT_SIGNATURE } from "@/lib/email-templates";
import { isServiceRoleConfigured } from "@/lib/env";
import { asMaterials, isSetupComplete } from "@/lib/setup";
import { signMaterialLinks } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

async function loadEmailPanel(clientId: string): Promise<{
  signature: string;
  log: EmailLogResult;
}> {
  if (!isServiceRoleConfigured()) {
    return {
      signature: DEFAULT_SIGNATURE,
      log: { ok: false, error: "Service role key is not configured." },
    };
  }
  const supabase = createServiceClient();
  const [settings, log] = await Promise.all([
    loadEmailSettings(supabase),
    listEmailLog(supabase, clientId),
  ]);
  return { signature: settings.signature, log };
}
import {
  getAdminClient,
  getIntakeInterview,
  listServiceOrderSends,
  listSignedDocuments,
  listSowSends,
} from "@/lib/data";
import { formatDate } from "@/lib/format";
import { nextTurn } from "@/lib/progress";
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

  const [sends, serviceOrderSends, ndaSends, access, interview, intake, emailPanel] =
    await Promise.all([
      listSowSends(client.id),
      listServiceOrderSends(client.id),
      listSignedDocuments(client.id, "nda"),
      getClientAccess(client.id),
      getIntakeInterview(client.id),
      getIntakeSettings(),
      loadEmailPanel(client.id),
    ]);

  const kickedOffAt = kickoffDate(client);
  const turn = nextTurn(client);

  const setupSource = {
    stage: client.stage ?? null,
    intake_completed_at: client.intake_completed_at ?? null,
    setup_steps: client.setup_steps ?? [],
  };
  const materialsRow = setupSource.setup_steps.find(
    (row) => row.step === "materials",
  );
  const materialLinks =
    materialsRow && isServiceRoleConfigured()
      ? await signMaterialLinks(
          createServiceClient(),
          asMaterials(
            materialsRow.status === "submitted"
              ? materialsRow.published
              : materialsRow.draft,
          ),
        )
      : {};

  // Each work panel, in process order. Finished ones move to the collapsed
  // Completed panel at the bottom; open ones stay at the top.
  const panels: { key: string; done: boolean; node: React.ReactNode }[] = [
    {
      key: "sow",
      done: Boolean(client.sow_confirmed_at),
      node: (
        <GenerateStatementOfWork
          clientId={client.id}
          sentContent={client.statement_of_work_content ?? ""}
          sends={sends}
        />
      ),
    },
    {
      key: "service_order",
      done: isKickoffReady(client),
      node: (
        <GenerateServiceOrder
          clientId={client.id}
          sends={serviceOrderSends}
          paymentReceivedAt={client.payment_received_at ?? null}
        />
      ),
    },
    {
      key: "nda",
      done: Boolean(client.nda_signed_at),
      node: (
        <GenerateNda
          clientId={client.id}
          sends={ndaSends}
          available={isKickoffReady(client)}
        />
      ),
    },
    {
      key: "intake",
      done: Boolean(client.intake_completed_at),
      node: (
        <IntakePanel
          interview={interview}
          topics={intake.topics}
          completedAt={client.intake_completed_at ?? null}
        />
      ),
    },
  ];

  if (client.intake_completed_at) {
    panels.push({
      key: "setup",
      done: isSetupComplete(setupSource),
      node: (
        <SetupWorkspace
          clientId={client.id}
          source={setupSource}
          materialLinks={materialLinks}
        />
      ),
    });
  }

  const openPanels = panels
    .filter((panel) => !panel.done)
    .map((panel) => <Fragment key={panel.key}>{panel.node}</Fragment>);
  const completedPanels = panels
    .filter((panel) => panel.done)
    .map((panel) => <Fragment key={panel.key}>{panel.node}</Fragment>);

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
      {turn.owner === "admin" ? (
        <section
          role="status"
          className="mb-lg rounded-card border border-primary/30 bg-primary-tint px-lg py-md"
        >
          <p className="text-label uppercase tracking-label text-primary">
            Your turn
          </p>
          <p className="mt-xs text-body-sm text-heading">
            {turn.action}
            {kickedOffAt && !client.nda_sent_at && !client.nda_signed_at
              ? ` — kick-off ready since ${formatDate(kickedOffAt)}: the Service Order is signed and the Setup Fee is received.`
              : "."}
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
          nda_sent_at: client.nda_sent_at,
          nda_signed_at: client.nda_signed_at,
          intake_completed_at: client.intake_completed_at,
        }}
        statuses={{
          campaign_analytics_status: client.campaign_analytics_status,
          investor_inbox_status: client.investor_inbox_status,
          engagement_tracker_status: client.engagement_tracker_status,
        }}
        setup={setupSource}
      />
      {openPanels}
      <EngagementProgress
        clientId={client.id}
        timestamps={{
          nda_signed_at: client.nda_signed_at,
          intake_completed_at: client.intake_completed_at,
          payment_received_at: client.payment_received_at,
        }}
        statuses={{
          campaign_analytics_status: client.campaign_analytics_status,
          investor_inbox_status: client.investor_inbox_status,
          engagement_tracker_status: client.engagement_tracker_status,
        }}
      />
      <ClientEmails
        clientId={client.id}
        address={client.email || client.founder_email || ""}
        paused={Boolean(client.emails_paused)}
        signature={emailPanel.signature}
        history={emailPanel.log.ok ? emailPanel.log.entries : []}
        historyError={emailPanel.log.ok ? null : emailPanel.log.error}
      />
      <ClientTimeline source={client} />
      <ClientForm client={client} />
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
      <CompletedPanel count={completedPanels.length}>
        {completedPanels}
      </CompletedPanel>
    </>
  );
}
