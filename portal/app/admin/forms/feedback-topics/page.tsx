import { PageHeader } from "@/components/page-header";
import { FeedbackTopicsEditor } from "@/app/admin/forms/feedback-topics/feedback-topics-editor";
import { DECK_TOPICS } from "@/lib/brief";
import { loadDeckTopics } from "@/lib/brief-server";
import { isServiceRoleConfigured } from "@/lib/env";
import { signFileLinks } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function FeedbackTopicsPage() {
  const supabase = isServiceRoleConfigured() ? createServiceClient() : null;
  const topics = supabase ? await loadDeckTopics(supabase) : DECK_TOPICS;
  const files = topics.flatMap((topic) => topic.files ?? []);
  const fileLinks = supabase && files.length > 0 ? await signFileLinks(supabase, files) : {};
  return (
    <>
      <PageHeader
        title="Feedback Topics"
        description="The preset list Rupert scores every client's materials against in the Company Brief (stage 3). He writes the top three. The playbook tells the AI what good looks like. Links and documents here can be added to a point with one click when it's chosen for a client, for example the presentation-structure PDF."
      />
      <FeedbackTopicsEditor initialTopics={topics} defaultTopics={DECK_TOPICS} fileLinks={fileLinks} />
    </>
  );
}
