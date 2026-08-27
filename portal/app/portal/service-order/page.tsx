import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
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

  return (
    <>
      <PageHeader
        title="Service Order"
        description="Commercial terms for this engagement. Agree once you have reviewed them."
      />
      <section className="rounded-card border border-border bg-surface p-lg">
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
      </section>
    </>
  );
}
