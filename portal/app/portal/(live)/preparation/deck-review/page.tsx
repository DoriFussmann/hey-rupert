import { PageHeader } from "@/components/page-header";
import { ReviewPanel } from "@/components/review-panel";

export default function DeckReviewPage() {
  return (
    <>
      <PageHeader
        title="Pitch Deck Review"
        description="Comments on the current pitch deck before outreach is written against it."
      />
      <ReviewPanel
        kicker="Setup & Preparation"
        title="Pitch deck — draft 4"
        updatedLabel="Comments returned 25 August 2026"
      >
        <p>
          The narrative holds. The raise, the buyer, and the reason this company
          exists are clear by slide four.
        </p>
        <p className="mt-md">Recommended changes before copy is locked:</p>
        <ul className="mt-md list-disc space-y-sm pl-md">
          <li>Traction: lead with the operating metric, then revenue.</li>
          <li>Use of funds: split hire vs. distribution more cleanly.</li>
          <li>Team: one line on why this team can sell into this buyer.</li>
        </ul>
        <p className="mt-md">
          Acknowledge this review when the deck is ready to be treated as the
          source of truth for outreach.
        </p>
      </ReviewPanel>
    </>
  );
}
