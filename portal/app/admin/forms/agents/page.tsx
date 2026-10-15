import { PageHeader } from "@/components/page-header";
import { AgentsEditor } from "@/app/admin/forms/agents/agents-editor";
import { TestClaudeButton } from "@/app/admin/forms/intake/test-claude-button";
import { defaultAgentPrompts } from "@/lib/agents";
import { loadAgentPrompts } from "@/lib/agents-server";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function AgentsPage() {
  let prompts = defaultAgentPrompts();
  if (isServiceRoleConfigured()) {
    await requireAdmin();
    prompts = await loadAgentPrompts(createServiceClient());
  }

  return (
    <>
      <PageHeader
        title="AI Agents"
        description="The instructions behind each AI button in the admin. They apply to the next run. Facts the agent receives (intake, materials, files, links) are added automatically."
        actions={<TestClaudeButton />}
      />
      <AgentsEditor initialPrompts={prompts} />
    </>
  );
}
