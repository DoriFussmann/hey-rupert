import { PageHeader } from "@/components/page-header";
import { OnboardingChecklist } from "@/app/portal/onboarding/checklist";
import { getPortalClient } from "@/lib/data";
import { getOnboardingItems, onboardingProgress } from "@/lib/onboarding";

export default async function OnboardingPage() {
  const client = await getPortalClient();
  const items = getOnboardingItems(client);
  const { complete, total } = onboardingProgress(client);

  return (
    <>
      <PageHeader
        title="Onboarding"
        description={`${complete} of ${total} complete. Confirm each step in order — Rupert will handle the rest.`}
      />
      <OnboardingChecklist items={items} />
    </>
  );
}
