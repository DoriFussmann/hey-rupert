import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { WarmIntrosView } from "@/app/portal/setup/warm-intros/warm-intros-view";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadKnownFunds, loadWarmIntroBlurb } from "@/lib/outreach/campaign-server";
import { getPortalSetup } from "@/lib/portal-setup";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function WarmIntrosPage() {
  const { client, viewAs } = await getPortalSetup();
  const supabase = client?.id && isServiceRoleConfigured() ? createServiceClient() : null;
  const [known, blurb] = supabase
    ? await Promise.all([loadKnownFunds(supabase, client!.id), loadWarmIntroBlurb(supabase, client!.id)])
    : [{ ok: true as const, value: [] }, { ask: "", blurb: "" }];
  const funds = known.ok ? known.value : [];

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Your warm intros"
        description="The funds you told us you know. They're left out of the email campaign so you can reach them through your own network, which usually works best. Track how each one is going here; Rupert sees it too."
      />
      {funds.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-lg py-xl">
          <h2 className="text-h4">No funds marked yet</h2>
          <p className="mt-sm text-body-sm text-muted">
            On your investor list, mark the funds where you know someone. They&apos;ll show up here instead of getting a cold email.
          </p>
        </div>
      ) : (
        <WarmIntrosView funds={funds} ask={blurb.ask} blurb={blurb.blurb} readOnly={viewAs} />
      )}
    </>
  );
}
