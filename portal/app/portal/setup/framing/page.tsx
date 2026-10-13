import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { MarkdownBody } from "@/components/markdown-body";
import { ResponseHistory } from "@/components/setup/response-history";
import { ReviewActions } from "@/components/setup/review-actions";
import { ReviewStatus } from "@/components/setup/review-status";
import { getPortalSetup } from "@/lib/portal-setup";
import { asReview } from "@/lib/setup";

export default async function FramingPage() {
  const { item, row, viewAs } = await getPortalSetup("framing");
  const visible = Boolean(row && row.version > 0);
  const framing = asReview(row?.published);

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Message Framing"
        description="How we'll position the company to investors: the story, the angle and the proof points every email is built on."
      />
      <ReviewStatus item={item} row={row} />
      {visible && row ? (
        <>
          <section className="rounded-card border border-border bg-surface px-lg py-lg">
            <MarkdownBody content={framing.body} emptyLabel="Nothing here yet." />
          </section>
          {row.status === "with_client" ? (
            <ReviewActions
              step="framing"
              version={row.version}
              confirmLabel="Confirm framing"
              readOnly={viewAs}
            />
          ) : null}
          <ResponseHistory history={row.history} currentVersion={row.version} />
        </>
      ) : null}
    </>
  );
}
