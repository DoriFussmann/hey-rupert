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
import { CompanyProfileCard } from "@/app/admin/clients/[id]/company-profile-card";
import { NextAction, type NextActionTurn } from "@/app/admin/clients/[id]/next-action";
import { EngagementProgress } from "@/app/admin/clients/[id]/engagement-progress";
import { ProgressOverview } from "@/app/admin/clients/[id]/progress-overview";
import { MaterialsPanel } from "@/app/admin/clients/[id]/setup/materials-panel";
import { SetupWorkspace } from "@/app/admin/clients/[id]/setup/setup-workspace";
import { ClientEmails } from "@/app/admin/clients/[id]/client-emails";
import { ClientTimeline } from "@/app/admin/clients/[id]/client-timeline";
import { Disclosure } from "@/components/disclosure";
import { ViewAsClientLink } from "@/components/eye-icon";
import { listEmailLog, type EmailLogResult } from "@/lib/email-log";
import { loadEmailSettings } from "@/lib/email-settings";
import { adminFirstName } from "@/lib/investor-list-email";
import { DEFAULT_SIGNATURE } from "@/lib/email-templates";
import { isServiceRoleConfigured } from "@/lib/env";
import { isClaudeConfigured } from "@/lib/anthropic";
import { loadProfileState } from "@/lib/match/profile-server";
import { matchPath, type MatchProfileState } from "@/lib/match/shared";
import { DEFAULT_MATERIAL_FIELDS } from "@/lib/material-fields";
import { loadMaterialFields } from "@/lib/material-fields-server";
import {
  asNarrative,
  asMaterials,
  isSetupComplete,
  isSetupOpen,
  setupStep,
  type SetupItem,
} from "@/lib/setup";
import { signFileLinks, signMaterialLinks } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

// The AI analysis runs in server actions on this page and can take minutes.
export const maxDuration = 300;

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

/** The match profile, or null when there is none (or the table is missing). */
async function loadMatchProfile(clientId: string): Promise<MatchProfileState | null> {
  if (!isServiceRoleConfigured()) return null;
  const loaded = await loadProfileState(createServiceClient(), clientId);
  return loaded.ok ? loaded.value : null;
}
import {
  getAdminClient,
  getIntakeInterview,
  listServiceOrderSends,
  listSignedDocuments,
  listSowSends,
} from "@/lib/data";
import { formatDate } from "@/lib/format";
import { getOnboardingItems, materialsStatus } from "@/lib/onboarding";
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

  const [sends, serviceOrderSends, ndaSends, access, interview, intake, emailPanel, matchProfile] =
    await Promise.all([
      listSowSends(client.id),
      listServiceOrderSends(client.id),
      listSignedDocuments(client.id, "nda"),
      getClientAccess(client.id),
      getIntakeInterview(client.id),
      getIntakeSettings(),
      loadEmailPanel(client.id),
      loadMatchProfile(client.id),
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
  const narrativeRow = setupSource.setup_steps.find((row) => row.step === "framing");
  // Files Rupert attached to the narrative draft.
  const setupFiles = narrativeRow ? asNarrative(narrativeRow.draft).attachments : [];
  const service = isServiceRoleConfigured() ? createServiceClient() : null;
  const [materialLinks, setupFileLinks, materialFields] = await Promise.all([
    materialsRow && service
      ? signMaterialLinks(
          service,
          asMaterials(
            materialsRow.status === "submitted"
              ? materialsRow.published
              : materialsRow.draft,
          ),
        )
      : Promise.resolve({}),
    setupFiles.length > 0 && service
      ? signFileLinks(service, setupFiles)
      : Promise.resolve({}),
    service
      ? loadMaterialFields(service)
      : Promise.resolve(DEFAULT_MATERIAL_FIELDS),
  ]);
  const claudeReady = isClaudeConfigured();

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
          testPilot={Boolean(client.is_test_pilot)}
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

  const materialsOnboarding = materialsStatus(client);
  const materialsItem: SetupItem = {
    ...setupStep("materials"),
    status: materialsOnboarding.status,
    detail: materialsOnboarding.detail,
    since: materialsRow?.turn_since ?? null,
    completedAt: materialsOnboarding.completedAt,
    visible: materialsOnboarding.status !== "open",
  };
  panels.push({
    key: "materials",
    done: materialsRow?.status === "submitted",
    node: (
      <MaterialsPanel
        clientId={client.id}
        item={materialsItem}
        row={materialsRow ?? null}
        fields={materialFields}
        links={materialLinks}
        canReopen={!narrativeRow || narrativeRow.version === 0}
      />
    ),
  });

  if (isSetupOpen(client.stage)) {
    panels.push({
      key: "setup",
      done: isSetupComplete(setupSource),
      node: (
        <SetupWorkspace
          clientId={client.id}
          source={setupSource}
          fileLinks={setupFileLinks}
          clientEmail={client.email ?? client.founder_email}
          clientFirstName={
            client.first_name?.trim() ||
            client.founder_name?.trim().split(/\s+/)[0] ||
            ""
          }
          companyName={client.company_name?.trim() || "your company"}
          adminName={adminFirstName(emailPanel.signature)}
          claudeReady={claudeReady}
        />
      ),
    });
  }

  // The work panel for the step in progress (the Setup Fee lives on the
  // Service Order panel).
  const setupDone = isSetupComplete(setupSource);
  const onboardingNext = getOnboardingItems(client).find((item) => item.status !== "done");
  const currentKey = setupDone
    ? null
    : onboardingNext
      ? onboardingNext.id === "payment"
        ? "service_order"
        : onboardingNext.id
      : isSetupOpen(client.stage)
        ? "setup"
        : null;
  const currentPanel = panels.find((panel) => panel.key === currentKey && !panel.done) ?? null;
  const upcomingPanels = panels.filter((panel) => !panel.done && panel !== currentPanel);
  const completedPanels = panels.filter((panel) => panel.done);

  // A test pilot has no Setup Fee invoice: paying is the "client's" step.
  const testFeeStep =
    client.is_test_pilot && onboardingNext?.id === "payment" && onboardingNext.status === "waiting";
  const nextActionTurn: NextActionTurn = testFeeStep
    ? { owner: "client", step: "Setup Fee (test pilot: no invoice, mark it as paid)" }
    : turn.owner === "admin"
      ? {
          owner: "admin",
          action: turn.action,
          detail:
            kickedOffAt && !client.nda_sent_at && !client.nda_signed_at
              ? `Kick-off ready since ${formatDate(kickedOffAt)}: the Service Order is signed and the Setup Fee is received.`
              : undefined,
        }
      : turn;
  const materialsFiles = materialsRow
    ? asMaterials(materialsRow.status === "submitted" ? materialsRow.published : materialsRow.draft).files
    : [];

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
        description={`${client.is_test_pilot ? "Test pilot. " : ""}${client.archived_at ? "Archived. " : ""}Opened ${formatDate(client.created_at)}. Last activity ${formatDate(client.last_activity_at)}.`}
        actions={
          <div className="flex flex-wrap items-end gap-md">
            <Link
              href={`/admin/clients/${client.id}/profile`}
              className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading"
            >
              Company profile
            </Link>
            <Link
              href={matchPath(client.id)}
              className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading"
            >
              Matching
            </Link>
            <ViewAsClientLink
              clientId={client.id}
              label={client.company_name}
              variant="button"
            />
            <ClientStageSelect clientId={client.id} stage={client.stage} />
          </div>
        }
      />
      <NextAction
        clientId={client.id}
        turn={nextActionTurn}
        targetId={currentPanel ? "current-step" : turn.owner === "none" ? null : "section-progress"}
        testPilot={
          client.is_test_pilot
            ? {
                website: client.company_website ?? "",
                deckNames: materialsFiles.map((file) => file.name),
                materialsSubmitted: materialsRow?.status === "submitted",
              }
            : null
        }
      />
      {client.intake_completed_at ? (
        <CompanyProfileCard
          clientId={client.id}
          initialState={matchProfile}
          interviewUpdatedAt={interview?.updated_at ?? null}
          hasInterview={Boolean(interview && interview.messages.length > 0)}
          claudeReady={claudeReady}
        />
      ) : null}
      {currentPanel ? (
        <div id="current-step" className="scroll-mt-lg">
          {currentPanel.node}
        </div>
      ) : null}
      {upcomingPanels.length > 0 ? (
        <Disclosure
          title="Upcoming steps"
          meta={`${upcomingPanels.length}`}
        >
          {upcomingPanels.map((panel) => (
            <Fragment key={panel.key}>{panel.node}</Fragment>
          ))}
        </Disclosure>
      ) : null}
      <Disclosure id="section-progress" title="Progress" defaultOpen={setupDone}>
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
      </Disclosure>
      <Disclosure
        title="Emails"
        meta={client.emails_paused ? "Paused" : undefined}
      >
        <ClientEmails
          clientId={client.id}
          address={client.email || client.founder_email || ""}
          paused={Boolean(client.emails_paused)}
          signature={emailPanel.signature}
          history={emailPanel.log.ok ? emailPanel.log.entries : []}
          historyError={emailPanel.log.ok ? null : emailPanel.log.error}
        />
      </Disclosure>
      <Disclosure title="Timeline">
        <ClientTimeline source={client} />
      </Disclosure>
      <Disclosure title="Client details & account">
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
      </Disclosure>
      {completedPanels.length > 0 ? (
        <Disclosure title="Completed steps" meta={`${completedPanels.length}`}>
          {completedPanels.map((panel) => (
            <Fragment key={panel.key}>{panel.node}</Fragment>
          ))}
        </Disclosure>
      ) : null}
    </>
  );
}
