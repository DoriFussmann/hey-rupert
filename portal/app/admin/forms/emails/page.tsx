import { PageHeader } from "@/components/page-header";
import { EmailSettingsEditor } from "@/app/admin/forms/emails/email-settings-editor";
import { requireAdmin } from "@/lib/auth";
import { loadEmailSettings } from "@/lib/email-settings";
import { defaultEmailSettings } from "@/lib/email-templates";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function EmailsFormPage() {
  let settings = { ...defaultEmailSettings(), error: null as string | null };

  if (isServiceRoleConfigured()) {
    await requireAdmin();
    settings = await loadEmailSettings(createServiceClient());
  }

  const { error, ...editable } = settings;

  return (
    <>
      <PageHeader
        title="Emails"
        description="Every email the portal sends, to clients and to you. Switch each one on or off, edit its wording, and set the reminder schedule. Until you edit an email, it uses the default wording."
      />
      {error ? (
        <p
          role="alert"
          className="mb-lg rounded-card border border-error/30 bg-surface px-lg py-md text-body-sm text-error"
        >
          {error} Until then, every email uses its default.
        </p>
      ) : null}
      <EmailSettingsEditor settings={editable} />
    </>
  );
}
