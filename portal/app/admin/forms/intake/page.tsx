import { PageHeader } from "@/components/page-header";
import { getIntakeSettings } from "@/app/admin/actions";
import { IntakeSettingsEditor } from "@/app/admin/forms/intake/intake-settings-editor";
import { TestClaudeButton } from "@/app/admin/forms/intake/test-claude-button";

export default async function IntakeInterviewerPage() {
  const settings = await getIntakeSettings();

  return (
    <>
      <PageHeader
        title="Intake Interviewer"
        description="The topics Rupert must cover in the client intake interview. Changes apply to interviews from the next message on."
        actions={<TestClaudeButton />}
      />
      <IntakeSettingsEditor initialTopics={settings.topics} defaultTopics={settings.defaults.topics} />
    </>
  );
}
