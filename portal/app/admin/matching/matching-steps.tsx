"use client";

import { useState } from "react";
import { DryMatch } from "@/app/admin/matching/dry-match";
import { CompetitiveLandscape } from "@/app/admin/matching/landscape";

/** The new matching, in steps. Each step opens once the one before it is confirmed. */
export function MatchingSteps({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [stepOne, setStepOne] = useState(false);
  return (
    <div className="space-y-xl">
      <section aria-label="Step 1: Dry Match Short List">
        <h2 className="mb-md text-h3 text-heading">Step 1: Dry Match Short List</h2>
        <DryMatch clientId={clientId} clientName={clientName} onSavedChange={setStepOne} />
      </section>
      <section aria-label="Step 2: Competitive Landscape Enrichment">
        <h2 className="mb-md text-h3 text-heading">Step 2: Competitive Landscape Enrichment</h2>
        <CompetitiveLandscape clientId={clientId} stepOneConfirmed={stepOne} />
      </section>
    </div>
  );
}
