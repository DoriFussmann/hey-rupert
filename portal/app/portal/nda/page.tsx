import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { ConfirmNdaButton } from "@/app/portal/nda/confirm-button";
import { getPortalClient } from "@/lib/data";

export default async function NdaPage() {
  const client = await getPortalClient();

  return (
    <>
      <BackLink href="/portal/onboarding" label="Onboarding" />
      <PageHeader
        title="NDA"
        description="A mutual non-disclosure covering materials exchanged during this engagement."
      />
      <section className="max-w-prose rounded-card border border-border bg-surface p-lg">
        <p className="text-body-sm text-body">
          Confirm once you have reviewed and signed the NDA Rupert sent. This
          is not a commercial commitment — it only covers confidential
          information shared while we work together.
        </p>
        {client ? (
          <div className="mt-lg">
            <ConfirmNdaButton signedAt={client.nda_signed_at ?? null} />
          </div>
        ) : null}
      </section>
    </>
  );
}
