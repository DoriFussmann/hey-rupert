import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { SignableDocument } from "@/components/signable-document";
import { signNda } from "@/app/portal/actions";
import {
  getActiveServiceOrder,
  getActiveSignedDocument,
  getPortalView,
} from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { isKickoffReady } from "@/lib/service-order";

export default async function NdaPage() {
  const { client, viewAs } = await getPortalView();

  if (isSupabaseConfigured() && client && !client.sow_confirmed_at) {
    redirect("/portal/statement-of-work");
  }

  const available = Boolean(client && isKickoffReady(client));
  const [nda, serviceOrder] =
    client && available
      ? await Promise.all([
          getActiveSignedDocument(client.id, "nda"),
          getActiveServiceOrder(client.id),
        ])
      : [null, null];
  // Pre-fill the signer from the Service Order signature when there is one.
  const previous = serviceOrder?.signature;
  const signedAt = nda?.signature?.signed_at ?? client?.nda_signed_at ?? null;

  return (
    <>
      <BackLink href="/portal/onboarding" label="Onboarding" />
      <PageHeader
        title="NDA"
        description={
          nda
            ? "Our commitment to keep everything you share with us confidential. Review and sign below."
            : "Our commitment to keep everything you share with us confidential."
        }
      />
      {client && nda ? (
        <SignableDocument
          title="NDA"
          content={nda.content}
          signedContent={nda.signed_content}
          issuedAt={nda.sent_at}
          signedAt={signedAt}
          signature={nda.signature}
          defaults={{
            company_name: previous?.company_name || client.company_name || "",
            signer_name: previous?.signer_name || client.founder_name || "",
            signer_email:
              previous?.signer_email || client.email || client.founder_email || "",
            signer_title: previous?.signer_title || "",
          }}
          readOnly={viewAs}
          sign={signNda}
          afterSignHref="/portal/intake"
        />
      ) : (
        <section className="max-w-prose rounded-card border border-border bg-surface p-lg">
          <p className="text-body-sm text-body">
            {client?.nda_signed_at
              ? "Your NDA is signed."
              : available
                ? "Rupert is preparing your NDA. You will get an email when it is ready to sign."
                : "The NDA follows once your Service Order is signed and the Setup Fee is paid."}
          </p>
        </section>
      )}
    </>
  );
}
