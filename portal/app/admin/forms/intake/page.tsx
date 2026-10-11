import { PageHeader } from "@/components/page-header";
import { getIntakeSettings } from "@/app/admin/actions";
import { IntakeSettingsEditor } from "@/app/admin/forms/intake/intake-settings-editor";

export default async function IntakeInterviewerPage() {
  const settings = await getIntakeSettings();

  return (
    <>
      <PageHeader
        title="Intake Interviewer"
        description="How Rupert runs the client intake interview: his instructions, and the topics he must cover. Changes apply to interviews from the next message on."
      />
      <IntakeSettingsEditor
        initialPrompt={settings.prompt}
        initialTopics={settings.topics}
        defaultPrompt={settings.defaults.prompt}
        defaultTopics={settings.defaults.topics}
      />
    </>
  );
}
