import { PageHeader } from "@/components/page-header";
import { BriefTopicsEditor } from "@/app/admin/forms/brief-topics/brief-topics-editor";
import { DEFAULT_BRIEF_TOPICS } from "@/lib/brief";
import { loadBriefTopics } from "@/lib/brief-server";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function BriefTopicsPage() {
  const topics = isServiceRoleConfigured() ? await loadBriefTopics(createServiceClient()) : DEFAULT_BRIEF_TOPICS;
  return (
    <>
      <PageHeader
        title="Brief topics"
        description="The topics every Company Brief summarises, in this order, after the abstract. The guidance tells Rupert exactly what to cover for each. Changes apply to briefs built or rebuilt from now on."
      />
      <BriefTopicsEditor initialTopics={topics} defaultTopics={DEFAULT_BRIEF_TOPICS} />
    </>
  );
}
