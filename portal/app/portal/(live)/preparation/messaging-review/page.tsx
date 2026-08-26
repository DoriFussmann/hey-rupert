import { PageHeader } from "@/components/page-header";
import { ReviewPanel } from "@/components/review-panel";

export default function MessagingReviewPage() {
  return (
    <>
      <PageHeader
        title="Outreach Messaging"
        description="Outreach copy written for this raise. Nothing is sent until you acknowledge it."
      />
      <ReviewPanel
        kicker="Setup & Preparation"
        title="First-touch sequence"
        updatedLabel="Draft sent 25 August 2026"
      >
        <div className="rounded-md border border-border bg-background px-md py-md font-mono text-mono">
          Subject: {`{{fund}} / {{company}}`}
          <br />
          <br />
          {`{{first_name}} —`}
          <br />
          <br />
          Writing because {`{{fund}}`} has backed companies selling into the
          same buyer, at this stage. Brief note on the company, the round, and
          why this is a fit for the thesis you publish.
          <br />
          <br />
          If useful, I can send the deck and a short list of relevant customers.
        </div>
        <p className="mt-md">
          A second version exists for family offices. Both stay in your name.
          Acknowledge when the copy can be used, or request a change above.
        </p>
      </ReviewPanel>
    </>
  );
}
