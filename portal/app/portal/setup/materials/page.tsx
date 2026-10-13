import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { TurnBanner } from "@/components/setup/turn-banner";
import { MaterialsWorkspace } from "@/app/portal/setup/materials/materials-workspace";
import { formatDateAtTime } from "@/lib/format";
import { getPortalSetup } from "@/lib/portal-setup";
import { asMaterials } from "@/lib/setup";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { signMaterialLinks } from "@/lib/setup-server";

export default async function MaterialsPage() {
  const { client, viewAs, item, row } = await getPortalSetup("materials");
  const submitted = row?.status === "submitted";
  const payload = asMaterials(submitted ? row?.published : row?.draft);
  const links =
    isServiceRoleConfigured() && payload.files.length > 0
      ? await signMaterialLinks(createServiceClient(), payload)
      : {};

  // When Rupert sent the materials back, his note is on the last round.
  const lastRound = row ? row.history[row.history.length - 1] : undefined;
  const rupertAsk =
    !submitted && lastRound?.response?.decision === "changes_requested"
      ? lastRound.response.note
      : "";

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Company Materials"
        description="Everything Rupert needs to prepare your campaign: your pitch deck, how you describe the company, and anything else worth knowing."
      />

      {!item || item.status === "open" ? (
        <section className="max-w-prose rounded-card border border-border bg-surface p-lg">
          <p className="text-body-sm text-body">
            This opens once your Client Intake is complete.
          </p>
        </section>
      ) : submitted ? (
        <TurnBanner
          owner="rupert"
          title={`Submitted ${row?.published_at ? formatDateAtTime(row.published_at) : ""}. Rupert is reviewing your materials.`}
          detail="We'll email you when his comments and your message framing are ready."
        />
      ) : (
        <TurnBanner
          owner="client"
          title={
            rupertAsk
              ? "Rupert asked for a little more."
              : "Upload your deck and tell us about the company, then submit."
          }
          detail={
            rupertAsk
              ? undefined
              : "Your work saves as you go. Rupert starts as soon as you submit."
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

      {client && item && item.status !== "open" ? (
        <MaterialsWorkspace
          initial={payload}
          links={links}
          submitted={submitted}
          readOnly={viewAs}
        />
      ) : null}
    </>
  );
}
