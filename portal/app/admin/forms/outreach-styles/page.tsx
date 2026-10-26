import { PageHeader } from "@/components/page-header";
import { OutreachStylesEditor } from "@/app/admin/forms/outreach-styles/outreach-styles-editor";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { defaultOutreachStyles } from "@/lib/outreach/copy";
import { loadOutreachStyles } from "@/lib/outreach/settings-server";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function OutreachStylesPage() {
  let loaded = { styles: defaultOutreachStyles(), saved: false, error: null as string | null };
  if (isServiceRoleConfigured()) {
    await requireAdmin();
    loaded = await loadOutreachStyles(createServiceClient());
  }

  return (
    <>
      <PageHeader
        title="Investor email styles"
        description="How the investor emails are written. Each style has rules, a word cap and an example; pick which style writes Core and which writes Sphere, Tier 3 and Tier 4, for each fund type. Every draft follows the style, and the checks before pushing hold it to the rules."
      />
      {loaded.error ? (
        <p role="alert" className="mb-lg rounded-card border border-error/30 bg-surface px-lg py-md text-body-sm text-error">
          {loaded.error} Until then, the default styles apply.
        </p>
      ) : null}
      <OutreachStylesEditor initial={loaded.styles} saved={loaded.saved} />
    </>
  );
}
