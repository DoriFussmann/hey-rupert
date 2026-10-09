import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { ServiceOrderPanel } from "@/app/portal/service-order/service-order-panel";
import { getActiveServiceOrder, getPortalView } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";

export default async function ServiceOrderPage() {
  const { client, viewAs } = await getPortalView();

  if (isSupabaseConfigured() && client && !client.sow_confirmed_at) {
    redirect("/portal/statement-of-work");
  }

  const send = client ? await getActiveServiceOrder(client.id) : null;
  const content = send?.content || client?.service_order_content || "";

  return (
    <>
      <BackLink href="/portal/onboarding" label="Onboarding" />
      <PageHeader
        title="Service Order"
        description={
          content.trim()
            ? "Sign the Service Order and pay the Setup Fee, in either order. Once both are done, we kick off."
            : "Rupert will issue your Service Order and Setup Fee invoice."
        }
      />
      {client && content.trim() ? (
        <ServiceOrderPanel
          content={content}
          signedContent={send?.signed_content ?? null}
          issuedAt={send?.sent_at ?? null}
          signedAt={client.service_order_agreed_at ?? null}
          signature={send?.signature ?? null}
          invoiceUrl={client.setup_invoice_url || send?.payment_link || null}
          paidAt={client.payment_received_at ?? null}
          defaults={{
            company_name: client.company_name ?? "",
            signer_name: client.founder_name ?? "",
            signer_email: client.email ?? client.founder_email ?? "",
            signer_title: "",
          }}
          readOnly={viewAs}
        />
      ) : (
        <section className="max-w-prose rounded-card border border-border bg-surface p-lg">
          <p className="text-body-sm text-body">
            Your Service Order will appear here once Rupert issues it. You can
            review and sign it here, and pay the Setup Fee from the same page.
          </p>
        </section>
      )}
    </>
  );
}
