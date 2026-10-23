import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { TurnBanner } from "@/components/setup/turn-banner";
import { MaterialsWorkspace } from "@/app/portal/materials/materials-workspace";
import { formatDateAtTime } from "@/lib/format";
import { getPortalView } from "@/lib/data";
import { asMaterials } from "@/lib/setup";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { signMaterialLinks } from "@/lib/setup-server";
import { DEFAULT_MATERIAL_FIELDS } from "@/lib/material-fields";
import { loadMaterialFields } from "@/lib/material-fields-server";

export default async function MaterialsPage() {
  const { client, viewAs } = await getPortalView();
  const open = Boolean(client?.intake_completed_at);
  const row = client?.setup_steps?.find((item) => item.step === "materials") ?? null;
  const submitted = row?.status === "submitted";
  const payload = asMaterials(submitted ? row?.published : row?.draft);
  const supabase = isServiceRoleConfigured() ? createServiceClient() : null;
  const [links, fields] = await Promise.all([
    supabase && payload.files.length > 0
      ? signMaterialLinks(supabase, payload)
      : Promise.resolve({}),
    supabase ? loadMaterialFields(supabase) : Promise.resolve(DEFAULT_MATERIAL_FIELDS),
  ]);

  // When Rupert sent the materials back, his note is on the last round.
  const lastRound = row ? row.history[row.history.length - 1] : undefined;
  const rupertAsk =
    !submitted && lastRound?.response?.decision === "changes_requested"
      ? lastRound.response.note
      : "";

  return (
    <>
      {submitted ? (
        <BackLink href="/portal/setup" label="Setup" />
      ) : (
        <BackLink href="/portal/onboarding" label="Onboarding" />
      )}
      <PageHeader
        title={submitted ? "Company Files" : "Company Materials"}
        description={
          submitted
            ? `Submitted ${row?.published_at ? formatDateAtTime(row.published_at) : ""}. Add an updated deck or anything new at any time.`
            : "The last onboarding step. Files you shared in the intake are already here. Add your deck if it is not, plus anything else Rupert should know."
        }
      />

      {!open ? (
        <section className="max-w-prose rounded-card border border-border bg-surface p-lg">
          <p className="text-body-sm text-body">
            This opens once your Client Intake is complete.
          </p>
        </section>
      ) : submitted ? null : (
        <TurnBanner
          owner="client"
          title={
            rupertAsk
              ? "Rupert asked for a little more."
              : "Upload your deck and anything else, then submit."
          }
          detail={
            rupertAsk
              ? undefined
              : "Files you shared in the intake are already here. Your work saves as you go."
          }
        />
      )}

      {rupertAsk ? (
        <section className="mb-lg max-w-prose rounded-card border border-border bg-surface px-lg py-md">
          <p className="text-label uppercase tracking-label text-muted">
            Note from Rupert
          </p>
          <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">
            {rupertAsk}
          </p>
        </section>
      ) : null}

      {client && open ? (
        <MaterialsWorkspace
          initial={payload}
          fields={fields}
          links={links}
          submitted={submitted}
          readOnly={viewAs}
        />
      ) : null}
    </>
  );
}
