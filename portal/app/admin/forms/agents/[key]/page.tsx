import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { PromptEditor } from "@/app/admin/forms/agents/[key]/prompt-editor";
import { requireAdmin } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { findSandboxId } from "@/lib/match/sandbox-server";
import { isPromptKey, promptDefinition } from "@/lib/prompts";
import { listPromptUses, listPromptVersions, type PromptUseRow, type PromptVersion } from "@/lib/prompts-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// A test run can read a deck or write a whole narrative.
export const maxDuration = 300;

/** One prompt: its active text, every version, recent uses, and a test run on a client. */
export default async function PromptPage({ params }: { params: { key: string } }) {
  if (!isPromptKey(params.key)) notFound();
  const definition = promptDefinition(params.key);
  let versions: PromptVersion[] = [];
  let uses: PromptUseRow[] = [];
  let clients: { id: string; name: string }[] = [];
  let error: string | null = null;

  if (isServiceRoleConfigured()) {
    await requireAdmin();
    const supabase = createServiceClient();
    const [loadedVersions, loadedUses, listed, sandbox] = await Promise.all([
      listPromptVersions(supabase, definition.key),
      listPromptUses(supabase, definition.key),
      listClients(),
      findSandboxId(supabase),
    ]);
    if (loadedVersions.ok) versions = loadedVersions.value;
    else error = loadedVersions.error;
    if (loadedUses.ok) uses = loadedUses.value;
    clients = listed
      .filter((client) => !client.archived_at)
      .map((client) => ({ id: client.id, name: client.company_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (sandbox.ok && sandbox.value) clients.push({ id: sandbox.value, name: "Test client (Test Pilot)" });
  } else {
    error = "Service role key is not configured.";
  }

  return (
    <>
      <BackLink href="/admin/forms/agents" label="AI Agents" />
      <PageHeader title={definition.title} description={definition.usedBy} />
      {error ? (
        <p role="alert" className="mb-lg rounded-card border border-error/30 bg-surface px-lg py-md text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <PromptEditor
        key={versions[0]?.version ?? 0}
        promptKey={definition.key}
        fixed={definition.fixed}
        testable={definition.testable}
        defaultText={definition.defaultText}
        versions={versions}
        uses={uses}
        clients={clients}
      />
    </>
  );
}
