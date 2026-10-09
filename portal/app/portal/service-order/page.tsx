import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { MarkdownBody } from "@/components/markdown-body";
import { ServiceOrderForm } from "@/app/portal/service-order/service-order-form";
import { getPortalClient } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";

export default async function ServiceOrderPage() {
  const client = await getPortalClient();

  if (isSupabaseConfigured()) {
    if (
      client?.stage !== "service_order" &&
      client?.stage !== "live" &&
      !client?.sow_confirmed_at
    ) {
      redirect("/portal/statement-of-work");
    }
  }

  const issued = Boolean(client?.service_order_content?.trim());
  const agreed = Boolean(client?.service_order_agreed_at);

  return (
    <>
      <BackLink href="/portal/onboarding" label="Onboarding" />
      <PageHeader
        title="Service Order"
        description={
          issued || agreed
            ? "Commercial terms for this engagement. Agree once you have reviewed them."
            : "Rupert will issue the Service Order for this engagement."
        }
      />
      <section className="rounded-card border border-border bg-surface p-lg">
        {issued || agreed ? (
          <>
            <MarkdownBody
              content={client?.service_order_content ?? ""}
              emptyLabel="No service order has been added yet."
            />
            {client ? (
              <ServiceOrderForm
                agreedAt={client.service_order_agreed_at ?? null}
                initial={{
                  linkedin_url: client.linkedin_url ?? "",
                  booking_link: client.booking_link ?? "",
                  company_website: client.company_website ?? "",
                  company_description: client.company_description ?? "",
                }}
              />
            ) : null}
          </>
        ) : (
          <p className="text-body-sm text-body">
            Rupert will issue your Service Order. You can confirm it here once
            it is ready.
          </p>
        )}
      </section>
    </>
  );
}
