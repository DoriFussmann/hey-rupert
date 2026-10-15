import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { IntakeExperience } from "@/app/portal/intake/intake-experience";
import { getIntakeInterview, getPortalView } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { DEFAULT_INTAKE_TOPICS } from "@/lib/intake";
import { loadIntakeSettings } from "@/lib/intake-server";
import { createServiceClient } from "@/lib/supabase/admin";

// Each message waits on Claude, and reading a shared PDF takes longer.
export const maxDuration = 120;

export default async function IntakePage() {
  const { client, viewAs } = await getPortalView();

  const open = Boolean(client?.nda_signed_at);
  const [interview, settings] = await Promise.all([
    client && open ? getIntakeInterview(client.id) : Promise.resolve(null),
    isServiceRoleConfigured()
      ? loadIntakeSettings(createServiceClient())
      : Promise.resolve({ prompt: "", topics: DEFAULT_INTAKE_TOPICS }),
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
        description="A short conversation with Rupert so we can prepare your investor campaign. Answer in your own words, or drop in your deck as a PDF and Rupert will read it first. You can leave and come back anytime."
      />
      {client && open ? (
        <IntakeExperience
          initialInterview={interview}
          topics={settings.topics}
          completedAt={client.intake_completed_at ?? null}
          firstName={firstName}
          readOnly={viewAs}
          materialsSubmitted={
            client.setup_steps?.some(
              (row) => row.step === "materials" && row.status === "submitted",
            ) ?? false
          }
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
