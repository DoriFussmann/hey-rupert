import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/back-link";
import { MarkdownBody } from "@/components/markdown-body";
import { TurnBanner } from "@/components/setup/turn-banner";
import { formatDateAtTime } from "@/lib/format";
import { getPortalSetup } from "@/lib/portal-setup";
import { asReview } from "@/lib/setup";

export default async function DeckReviewPage() {
  const { item, row } = await getPortalSetup("deck_review");
  const published = row?.status === "published";
  const review = asReview(row?.published);

  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      <PageHeader
        title="Deck & Materials Review"
        description="Rupert's comments on your pitch deck and materials. Apply what's useful: the deck is yours."
      />
      {!published ? (
        <TurnBanner
          owner="rupert"
          title={item?.detail ?? "Rupert is reviewing your materials."}
          detail="We'll email you when the comments are ready."
        />
      ) : (
        <section className="rounded-card border border-border bg-surface">
          <div className="border-b border-border px-lg py-md">
            <p className="text-label uppercase tracking-label text-muted">
              From Rupert
            </p>
            <p className="mt-xs text-body-sm text-muted">
              {row?.published_at
                ? `${row.version > 1 ? "Updated" : "Shared"} ${formatDateAtTime(row.published_at)}`
                : ""}
            </p>
          </div>
          <div className="px-lg py-lg">
            <MarkdownBody content={review.body} emptyLabel="No comments." />
          </div>
        </section>
      )}
    </>
  );
}
