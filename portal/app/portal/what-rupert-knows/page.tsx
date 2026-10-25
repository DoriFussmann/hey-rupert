import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { MarkdownBody } from "@/components/markdown-body";
import { PageHeader } from "@/components/page-header";
import { CollapsiblePanel } from "@/components/setup/collapsible-panel";
import { intakeKnowledge, knowledgeFacts, knowledgeFiles, sharedRead } from "@/lib/company-knowledge";
import { getPortalView } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { loadIntakeSettings, loadInterview } from "@/lib/intake-server";
import { fileExtension, formatBytes, websiteHref } from "@/lib/setup";
import { signFileLinks } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

const label = "text-label uppercase tracking-label text-muted";
const link = "text-body-sm text-primary no-underline hover:text-primary-hover";
const actionButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading";


/**
 * Everything Rupert works from, for the founder: the company at a glance,
 * Rupert's read of it and the Outreach Narrative (once sent), what they
 * told him in the intake, and every file. Only what was already shared
 * with the founder appears here.
 */
export default async function WhatRupertKnowsPage() {
  const { client } = await getPortalView();

  if (!client?.intake_completed_at) {
    return (
      <>
        <PageHeader title="What Rupert Knows" />
        <EmptyState
          title="This opens once your intake is complete."
          description="Everything you share with Rupert in the intake, and your company materials, will be collected here."
        />
      </>
    );
  }

  const rows = client.setup_steps ?? [];
  const files = knowledgeFiles(rows.find((row) => row.step === "materials"));
  const read = sharedRead(
    rows.find((row) => row.step === "framing"),
    rows.find((row) => row.step === "deck_review"),
  );
  const supabase = isServiceRoleConfigured() ? createServiceClient() : null;
  const [interview, settings, links] = await Promise.all([
    supabase ? loadInterview(supabase, client.id) : Promise.resolve(null),
    supabase ? loadIntakeSettings(supabase) : Promise.resolve(null),
    supabase && files.length > 0 ? signFileLinks(supabase, files) : Promise.resolve({} as Record<string, string>),
  ]);
  const loaded = interview?.ok ? interview.interview : null;
  const facts = knowledgeFacts(client, loaded?.admin_brief ?? null);
  const intake = intakeKnowledge(loaded, settings?.topics ?? []);
  const description = client.company_description?.trim() ?? "";

  return (
    <>
      <PageHeader
        title="What Rupert Knows"
        description="Everything Rupert is working from for your raise, in one place. Something new or out of date? Tell Rupert or add a file, and he is notified right away."
        actions={
          <div className="flex flex-wrap gap-sm">
            <Link href="/portal/intake" className={actionButton}>
              Tell Rupert
            </Link>
            <Link href="/portal/materials" className={actionButton}>
              Add Files
            </Link>
          </div>
        }
      />

      <div className="space-y-lg">
        <CollapsiblePanel title="At a Glance" meta={facts.map((fact) => fact.value).slice(0, 3).join(" · ")}>
          {description ? <p className="mb-md max-w-prose text-body text-body">{description}</p> : null}
          <dl className="-mx-lg grid grid-cols-2 lg:grid-cols-3">
            {facts.map((fact) => {
              const href = fact.label === "Website" ? websiteHref(fact.value) : "";
              return (
                <div key={fact.label} className="min-w-0 px-lg py-sm">
                  <dt className={label}>{fact.label}</dt>
                  <dd className="mt-xs break-words text-body text-heading">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-heading no-underline hover:text-primary">
                        {fact.value}
                      </a>
                    ) : (
                      fact.value
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </CollapsiblePanel>

        <CollapsiblePanel
          title="How Rupert Reads Your Company"
          meta={
            read
              ? read.confirmed
                ? "From the Outreach Narrative you confirmed."
                : "From the Outreach Narrative Rupert shared with you."
              : "Appears once Rupert shares your Outreach Narrative."
          }
        >
          {read ? (
            <div className="space-y-lg">
              {read.story ? (
                <CollapsiblePanel title="The Outreach Narrative" meta="How Rupert will present your company to investors.">
                  <MarkdownBody content={read.story} emptyLabel="" className="sow-markdown max-w-prose" />
                </CollapsiblePanel>
              ) : null}
              <MarkdownBody content={read.read} emptyLabel="" />
              <p>
                <Link href="/portal/setup/framing" className={link}>
                  Open the Narrative
                </Link>
              </p>
            </div>
          ) : (
            <p className="max-w-prose text-body-sm text-muted">
              Rupert&apos;s read of your company appears here once he shares your Outreach Narrative.
            </p>
          )}
        </CollapsiblePanel>

        <CollapsiblePanel
          title="What You Told Rupert"
          meta={
            intake
              ? intake.confirmed
                ? "The intake summary you confirmed."
                : "What Rupert noted from your intake conversation."
              : "Nothing from your intake yet."
          }
        >
          {intake ? (
            <dl className="-my-sm divide-y divide-border">
              {intake.items.map((item) => (
                <div key={item.topic_id} className="grid gap-xs py-md sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-lg">
                  <dt className={label}>{item.title}</dt>
                  <dd className="whitespace-pre-wrap text-body-sm text-body">{item.answer}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-body-sm text-muted">Nothing from your intake yet.</p>
          )}
          <p className="mt-md">
            <Link href="/portal/intake" className={link}>
              Add or Correct Something
            </Link>
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel title="Your Files" meta={`${files.length} file${files.length === 1 ? "" : "s"}`}>
          {files.length === 0 ? (
            <p className="text-body-sm text-muted">No files shared yet.</p>
          ) : (
            <ul className="-my-sm divide-y divide-border">
              {files.map((file) => (
                <li key={file.path} className="flex flex-wrap items-center gap-x-md gap-y-xs py-sm">
                  <span className="shrink-0 rounded border border-border px-xs text-label uppercase tracking-label text-muted">
                    {fileExtension(file.name) || "file"}
                  </span>
                  {links[file.path] ? (
                    <a
                      href={links[file.path]}
                      className="min-w-0 flex-1 truncate text-body-sm text-heading no-underline hover:text-primary"
                      aria-label={`Download ${file.name}`}
                    >
                      {file.name}
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-body-sm text-heading">{file.name}</span>
                  )}
                  <span className="text-body-sm text-muted">
                    {[formatBytes(file.size), file.uploaded_at ? formatDate(file.uploaded_at) : "", file.added_by === "admin" ? "Added by Rupert" : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-md">
            <Link href="/portal/materials" className={link}>
              Add Files
            </Link>
          </p>
        </CollapsiblePanel>
      </div>
    </>
  );
}
