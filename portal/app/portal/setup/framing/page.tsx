import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { MarkdownBody } from "@/components/markdown-body";
import { ResponseHistory } from "@/components/setup/response-history";
import { AdminReply } from "@/components/setup/admin-reply";
import { ReviewActions } from "@/components/setup/review-actions";
import { ReviewStatus } from "@/components/setup/review-status";
import { TurnBanner } from "@/components/setup/turn-banner";
import { getPortalSetup } from "@/lib/portal-setup";
import { asNarrative, narrativeHasEarlierDraft } from "@/lib/setup";

function MessageCard({
  title,
  detail,
  subject,
  body,
}: {
  title: string;
  detail: string;
  subject?: string;
  body: string;
}) {
  if (!body.trim() && !subject?.trim()) return null;
  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-md">
        <h2 className="text-h4">{title}</h2>
        <p className="mt-xs text-body-sm text-muted">{detail}</p>
      </div>
      <div className="px-lg py-md">
        {subject?.trim() ? (
          <p className="text-body-sm">
            <span className="text-label uppercase tracking-label text-muted">Subject </span>
            <span className="text-heading">{subject}</span>
          </p>
        ) : null}
        <p
          className={`whitespace-pre-wrap text-body-sm text-body ${subject?.trim() ? "mt-sm" : ""}`}
        >
          {body}
        </p>
      </div>
    </section>
  );
}

export default async function FramingPage() {
  const { item, row, viewAs } = await getPortalSetup("framing");
  const visible = Boolean(row && row.version > 0);
  const narrative = asNarrative(row?.published);

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Outreach Narrative"
        description="How we'll present the company to investors: the story, the key messages, and how Rupert will approach them."
      />
      {row?.status === "with_client" ? (
        <TurnBanner
          owner="client"
          title="Review the story, the key messages and the approach, then confirm or send Rupert your notes."
        />
      ) : null}
      <ReviewStatus
        item={item}
        row={row}
        waitingTitle="Rupert has your note."
        waitingDetail="He'll reply and send the narrative back for you to confirm."
      />
      {visible && row ? (
        <>
          {row.status === "with_client" && narrative.admin_note ? (
            <div className="sticky top-0 z-20">
              <AdminReply note={narrative.admin_note} />
            </div>
          ) : null}
          <div className="grid gap-lg">
            <section className="rounded-card border border-border bg-surface">
              <div className="border-b border-border px-lg py-md">
                <h2 className="text-h4">Core story</h2>
              </div>
              <div className="px-lg py-lg">
                <MarkdownBody content={narrative.core} emptyLabel="Nothing here yet." />
              </div>
            </section>
            <section className="rounded-card border border-border bg-surface">
              <div className="border-b border-border px-lg py-md">
                <h2 className="text-h4">Key messages</h2>
              </div>
              <div className="px-lg py-lg">
                <MarkdownBody content={narrative.key_messages} emptyLabel="Nothing here yet." />
              </div>
            </section>
            <section className="rounded-card border border-border bg-surface">
              <div className="border-b border-border px-lg py-md">
                <h2 className="text-h4">Approach</h2>
              </div>
              <div className="px-lg py-lg">
                <MarkdownBody content={narrative.approach} emptyLabel="Nothing here yet." />
              </div>
            </section>
            {narrativeHasEarlierDraft(narrative) ? (
              <section className="rounded-card border border-border bg-surface">
                <div className="border-b border-border px-lg py-md">
                  <h2 className="text-h4">Earlier draft</h2>
                  <p className="mt-xs text-body-sm text-muted">
                    Email and LinkedIn copy from a previous version. The emails for each tier come after the investor list.
                  </p>
                </div>
                <div className="grid gap-md px-lg py-md">
                  <MessageCard
                    title="First email"
                    detail="From the earlier narrative."
                    subject={narrative.email_subject}
                    body={narrative.email_body ?? ""}
                  />
                  <MessageCard
                    title="LinkedIn connection note"
                    detail="From the earlier narrative."
                    body={narrative.linkedin_note ?? ""}
                  />
                  <MessageCard
                    title="LinkedIn message"
                    detail="From the earlier narrative."
                    body={narrative.linkedin_followup ?? ""}
                  />
                </div>
              </section>
            ) : null}
            <section className="rounded-card border border-border bg-surface">
              <div className="border-b border-border px-lg py-md">
                <h2 className="text-h4">What happens next</h2>
              </div>
              <div className="px-lg py-lg">
                <p className="whitespace-pre-wrap text-body-sm text-body">
                  {narrative.next_steps}
                </p>
              </div>
            </section>
          </div>
          {row.status === "with_client" ? (
            <>
              <AdminReply note={narrative.admin_note} />
              <ReviewActions
                step="framing"
                version={row.version}
                confirmLabel="Confirm narrative"
                readOnly={viewAs}
              />
            </>
          ) : null}
          <ResponseHistory history={row.history} currentVersion={row.version} />
        </>
      ) : null}
    </>
  );
}
