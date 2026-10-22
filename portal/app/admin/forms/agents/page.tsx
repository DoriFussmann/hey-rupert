import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { TestClaudeButton } from "@/app/admin/forms/intake/test-claude-button";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { PROMPTS, PROMPT_GROUPS, versionLabel } from "@/lib/prompts";
import { loadPromptStatuses, type PromptStatus } from "@/lib/prompts-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
}

/** Every AI prompt Rupert uses, by area, with the version each one runs on. */
export default async function AgentsPage() {
  let statuses: PromptStatus[] = [];
  let error: string | null = null;
  if (isServiceRoleConfigured()) {
    await requireAdmin();
    const loaded = await loadPromptStatuses(createServiceClient());
    if (loaded.ok) statuses = loaded.value;
    else error = loaded.error;
  } else {
    error = "Service role key is not configured.";
  }
  const status = new Map(statuses.map((item) => [item.key, item]));

  return (
    <>
      <PageHeader
        title="AI Agents"
        description="Every AI prompt Rupert uses. Each one runs on its active version; saving makes a new version, every earlier one is kept, and edits apply to the next run with no deploy. A prompt can change wording and judgement, never what data the AI gets, what it may return, or whether anything is saved or sent."
        actions={<TestClaudeButton />}
      />
      {error ? (
        <p role="alert" className="mb-lg rounded-card border border-error/30 bg-surface px-lg py-md text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <div className="space-y-lg">
        {PROMPT_GROUPS.map((group) => (
          <section key={group} className="rounded-card border border-border bg-surface">
            <h2 className="border-b border-border px-lg py-md text-h4">{group}</h2>
            <ul className="divide-y divide-border">
              {PROMPTS.filter((prompt) => prompt.group === group).map((prompt) => {
                const current = status.get(prompt.key);
                return (
                  <li key={prompt.key} className="flex flex-wrap items-start justify-between gap-sm px-lg py-md">
                    <div className="min-w-0 max-w-prose">
                      <Link href={`/admin/forms/agents/${prompt.key}`} className="text-body text-heading underline-offset-2 hover:underline">
                        {prompt.title}
                      </Link>
                      <p className="mt-xs text-body-sm text-muted">{prompt.usedBy}</p>
                    </div>
                    <p className={`shrink-0 text-body-sm ${current?.valid ? "text-secondary" : "text-error"}`}>
                      {current?.valid && current.activeVersion
                        ? `${versionLabel(current.activeVersion)} active · ${when(current.updatedAt)}`
                        : "Not set up: AI actions that need it stop with an error"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
