import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { MarkdownBody } from "@/components/markdown-body";
import { ResponseHistory } from "@/components/setup/response-history";
import { ReviewActions } from "@/components/setup/review-actions";
import { ReviewStatus } from "@/components/setup/review-status";
import { getPortalSetup } from "@/lib/portal-setup";
import { asNarrative } from "@/lib/setup";

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
        description="How we'll present the company to investors: the story every message is built on, the first email, and your LinkedIn messages."
      />
      <ReviewStatus item={item} row={row} />
      {visible && row ? (
        <>
          <div className="grid gap-lg">
            <section className="rounded-card border border-border bg-surface">
              <div className="border-b border-border px-lg py-md">
                <h2 className="text-h4">The narrative</h2>
              </div>
              <div className="px-lg py-lg">
                <MarkdownBody content={narrative.core} emptyLabel="Nothing here yet." />
              </div>
            </section>
            <MessageCard
              title="First email"
              detail="Sent to each matched investor in your name. The [bracketed] line is personalized for every investor."
              subject={narrative.email_subject}
              body={narrative.email_body}
            />
            <MessageCard
              title="LinkedIn connection note"
              detail="Sent with the connection request (300 characters at most)."
              body={narrative.linkedin_note}
            />
            <MessageCard
              title="LinkedIn message"
              detail="Sent once the investor accepts the connection."
              body={narrative.linkedin_followup}
            />
          </div>
          {row.status === "with_client" ? (
            <ReviewActions
              step="framing"
              version={row.version}
              confirmLabel="Confirm narrative"
              readOnly={viewAs}
            />
          ) : null}
          <ResponseHistory history={row.history} currentVersion={row.version} />
        </>
      ) : null}
    </>
  );
}
