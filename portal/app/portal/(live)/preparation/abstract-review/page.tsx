import { PageHeader } from "@/components/page-header";
import { ReviewPanel } from "@/components/review-panel";

export default function AbstractReviewPage() {
  return (
    <>
      <PageHeader
        title="Business Brief"
        description="The one-page company brief used in outreach and follow-up."
      />
      <ReviewPanel
        kicker="Setup & Preparation"
        title="Business brief"
        updatedLabel="Draft sent 24 August 2026"
      >
        <p>
          A concise account of the company, the problem, the buyer, and why this
          raise is happening now. This is what a partner should be able to
          repeat after one read.
        </p>
        <p className="mt-md">
          Please confirm names, figures, and the one-sentence category. If a
          number is still internal, mark it rather than leaving it in.
        </p>
        <p className="mt-md">
          Once acknowledged, this brief is used in first-touch notes and in
          the data room cover.
        </p>
      </ReviewPanel>
    </>
  );
}
