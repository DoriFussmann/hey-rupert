import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { IntakeExperience } from "@/app/portal/intake/intake-experience";
import { getIntakeInterview, getPortalView } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { DEFAULT_INTAKE_TOPICS } from "@/lib/intake";
import { loadIntakeSettings } from "@/lib/intake-server";
import { materialsView } from "@/lib/materials-server";
import { createServiceClient } from "@/lib/supabase/admin";

// Each message waits on Claude, and reading shared files takes longer.
export const maxDuration = 120;

export default async function IntakePage() {
  const { client, viewAs } = await getPortalView();

  const open = Boolean(client?.nda_signed_at);
  const [interview, settings] = await Promise.all([
    client && open ? getIntakeInterview(client.id) : Promise.resolve(null),
    isServiceRoleConfigured()
      ? loadIntakeSettings(createServiceClient())
      : Promise.resolve({ topics: DEFAULT_INTAKE_TOPICS }),
  ]);

  const firstName =
    client?.first_name?.trim() ||
    client?.founder_name?.trim().split(/\s+/)[0] ||
    "";

  return (
    <>
      <BackLink href="/portal/onboarding" label="Onboarding" />
      <PageHeader
        title="Client Intake"
        description="A short conversation with Rupert so we can prepare your investor campaign. Start by sharing your pitch deck and any other materials: Rupert reads them first, so he only asks about what they don't cover. You can leave and come back anytime."
      />
      {client && open ? (
        <IntakeExperience
          initialInterview={interview}
          topics={settings.topics}
          completedAt={client.intake_completed_at ?? null}
          firstName={firstName}
          readOnly={viewAs}
          initialMaterials={materialsView(
            client.setup_steps?.find((row) => row.step === "materials"),
          )}
        />
      ) : (
        <section className="max-w-prose rounded-card border border-border bg-surface p-lg">
          <p className="text-body-sm text-body">
            Your intake interview opens once your NDA is signed.
          </p>
        </section>
      )}
    </>
  );
}
