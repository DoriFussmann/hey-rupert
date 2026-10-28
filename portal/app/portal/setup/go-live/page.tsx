import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { GoLiveView } from "@/app/portal/setup/go-live/go-live-view";
import { getPortalSetup } from "@/lib/portal-setup";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveState } from "@/lib/outreach/live-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function GoLivePage() {
  const { client, viewAs } = await getPortalSetup();
  const loaded = client?.id && isServiceRoleConfigured() ? await loadLiveState(createServiceClient(), client.id) : null;
  const state = loaded?.ok ? loaded.value : null;

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Go Live"
        description="Three steps, then Rupert starts your investor emails from your own inbox, in your name. You see every reply that needs you in your Investor Inbox."
      />
      {state && (state.step || state.live) ? (
        <GoLiveView
          readOnly={viewAs}
          campaignReady={state.campaignReady}
          inbox={state.inbox ? { email: state.inbox.email, healthy: state.inbox.healthy } : null}
          invoice={state.invoice}
          live={state.live ? { at: state.live.at } : null}
          gaps={state.gaps}
          consentText={state.consentText}
          counts={state.counts}
          testSentAt={state.testSentAt}
          requested={state.requested ? { at: state.requested.at } : null}
          plan={state.plan}
          inboxEmail={state.inbox?.email ?? null}
        />
      ) : (
        <p className="rounded-card border border-border bg-surface px-lg py-md text-body-sm text-muted">
          Go Live opens once Rupert has your campaign ready.
        </p>
      )}
    </>
  );
}
