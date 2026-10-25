import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { MarkdownBody } from "@/components/markdown-body";
import { PageHeader } from "@/components/page-header";
import { confirmedAnswers, knowledgeFacts, knowledgeFiles, sharedRead } from "@/lib/company-knowledge";
import { getPortalView } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { loadInterview } from "@/lib/intake-server";
import { fileExtension, formatBytes, websiteHref } from "@/lib/setup";
import { signFileLinks } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";

const panel = "rounded-card border border-border bg-surface";
const label = "text-label uppercase tracking-label text-muted";
const link = "text-body-sm text-primary no-underline hover:text-primary-hover";

function PanelHeader({ title, meta, action }: { title: string; meta?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-sm border-b border-border px-lg py-md">
      <div className="min-w-0">
        <h2 className="text-h4 text-heading">{title}</h2>
        {meta ? <p className="mt-xs text-body-sm text-muted">{meta}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Everything Rupert works from, for the founder: the company at a glance,
 * Rupert's read of it (once shared), what they told him in the intake, and
 * every file. Only what was already shared with the founder appears here.
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
  const read = sharedRead(rows.find((row) => row.step === "framing"));
  const supabase = isServiceRoleConfigured() ? createServiceClient() : null;
  const [interview, links] = await Promise.all([
    supabase ? loadInterview(supabase, client.id) : Promise.resolve(null),
    supabase && files.length > 0 ? signFileLinks(supabase, files) : Promise.resolve({} as Record<string, string>),
  ]);
  const loaded = interview?.ok ? interview.interview : null;
  const facts = knowledgeFacts(client, loaded?.admin_brief ?? null);
  const answers = confirmedAnswers(loaded);
  const description = client.company_description?.trim() ?? "";

  return (
    <>
      <PageHeader
        title="What Rupert Knows"
        description="Everything Rupert is working from for your raise, in one place. Something missing or out of date? Add a file or tell Rupert."
      />

      <section className={`${panel} mb-lg`} aria-label="At a glance">
        <PanelHeader title="At a glance" />
        {description ? <p className="max-w-prose px-lg pt-md text-body text-body">{description}</p> : null}
        <dl className="grid grid-cols-2 lg:grid-cols-3">
          {facts.map((fact) => {
            const href = fact.label === "Website" ? websiteHref(fact.value) : "";
            return (
              <div key={fact.label} className="min-w-0 px-lg py-md">
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
      </section>

      <div className="grid gap-lg lg:grid-cols-3">
        <div className="min-w-0 space-y-lg lg:col-span-2">
          <section className={panel} aria-label="How Rupert reads your company">
            <PanelHeader
              title="How Rupert reads your company"
              meta={read ? (read.confirmed ? "From the Outreach Narrative you confirmed." : "From the Outreach Narrative Rupert shared with you.") : undefined}
              action={
                read ? (
                  <Link href="/portal/setup/framing" className={link}>
                    Open the narrative
                  </Link>
                ) : null
              }
            />
            <div className="space-y-lg px-lg py-lg">
              {read ? (
                <>
                  {read.story ? (
                    <div className="rounded-card bg-primary-tint px-lg py-md">
                      <p className={label}>The Outreach Narrative</p>
                      <MarkdownBody content={read.story} emptyLabel="" className="sow-markdown mt-sm max-w-prose" />
                    </div>
                  ) : null}
                  <MarkdownBody content={read.read} emptyLabel="" />
                </>
              ) : (
                <p className="max-w-prose text-body-sm text-muted">
                  Rupert&apos;s read of your company appears here once he shares your Outreach Narrative.
                </p>
              )}
            </div>
          </section>

          <section className={panel} aria-label="What you told Rupert">
            <PanelHeader
              title="What you told Rupert"
              meta={answers ? "The intake summary you confirmed." : undefined}
              action={
                <Link href="/portal/intake" className={link}>
                  Add or correct something
                </Link>
              }
            />
            {answers && answers.length > 0 ? (
              <dl className="divide-y divide-border">
                {answers.map((item) => (
                  <div key={item.topic_id} className="grid gap-xs px-lg py-md sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-lg">
                    <dt className={label}>{item.title}</dt>
                    <dd className="whitespace-pre-wrap text-body-sm text-body">{item.answer}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-lg py-lg text-body-sm text-muted">
                Your intake summary appears here once you review and confirm it in the intake.
              </p>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-lg">
          <section className={panel} aria-label="Your files">
            <PanelHeader
              title="Your files"
              meta={`${files.length} file${files.length === 1 ? "" : "s"}`}
              action={
                <Link href="/portal/materials" className={link}>
                  Add files
                </Link>
              }
            />
            {files.length === 0 ? (
              <p className="px-lg py-lg text-body-sm text-muted">No files shared yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {files.map((file) => (
                  <li key={file.path} className="flex items-start gap-sm px-lg py-sm">
                    <span className="mt-px shrink-0 rounded border border-border px-xs text-label uppercase tracking-label text-muted">
                      {fileExtension(file.name) || "file"}
                    </span>
                    <span className="min-w-0 flex-1">
                      {links[file.path] ? (
                        <a
                          href={links[file.path]}
                          className="block truncate text-body-sm text-heading no-underline hover:text-primary"
                          aria-label={`Download ${file.name}`}
                        >
                          {file.name}
                        </a>
                      ) : (
                        <span className="block truncate text-body-sm text-heading">{file.name}</span>
                      )}
                      <span className="block text-body-sm text-muted">
                        {[formatBytes(file.size), file.uploaded_at ? formatDate(file.uploaded_at) : "", file.added_by === "admin" ? "Added by Rupert" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${panel} px-lg py-lg`} aria-label="Something changed">
            <h2 className="text-h4 text-heading">Something changed?</h2>
            <p className="mt-sm text-body-sm text-secondary">
              A new deck, a closed commitment, a different raise: tell Rupert in the intake chat or add the file.
              Rupert is notified right away.
            </p>
            <div className="mt-md flex flex-wrap gap-md">
              <Link href="/portal/intake" className={link}>
                Tell Rupert
              </Link>
              <Link href="/portal/materials" className={link}>
                Add a file
              </Link>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
