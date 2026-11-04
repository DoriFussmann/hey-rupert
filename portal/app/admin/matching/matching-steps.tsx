"use client";

import { useCallback, useState } from "react";
import { DryMatch } from "@/app/admin/matching/dry-match";
import { CompetitiveLandscape } from "@/app/admin/matching/landscape";
import { FinalRoster } from "@/app/admin/matching/final-roster";
import { ThePlan } from "@/app/admin/matching/the-plan";
import { StepSignal } from "@/app/admin/matching/step-signal";

/** The new matching, in steps. Each step opens once the one before it is confirmed. */
export function MatchingSteps({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [stepOne, setStepOne] = useState(false);
  const [stepTwoSignal, setStepTwoSignal] = useState(0);
  const bump = useCallback(() => setStepTwoSignal((v) => v + 1), []);
  const [stepThreeSignal, setStepThreeSignal] = useState(0);
  const bumpThree = useCallback(() => setStepThreeSignal((v) => v + 1), []);
  return (
    <div className="space-y-xl">
      <section aria-label="Step 1: Dry Match Short List">
        <h2 className="mb-md text-h3 text-heading">Step 1: Dry Match Short List</h2>
        <DryMatch clientId={clientId} clientName={clientName} onSavedChange={setStepOne} />
      </section>
      <section aria-label="Step 2: Competitive Landscape Enrichment">
        <h2 className="mb-md text-h3 text-heading">Step 2: Competitive Landscape Enrichment</h2>
        <StepSignal.Provider value={bump}>
          <CompetitiveLandscape clientId={clientId} stepOneConfirmed={stepOne} />
        </StepSignal.Provider>
      </section>
      <section aria-label="Step 3: The Final Roster">
        <h2 className="mb-md text-h3 text-heading">Step 3: The Final Roster</h2>
        <FinalRoster clientId={clientId} clientName={clientName} refreshKey={stepTwoSignal} onChanged={bumpThree} />
      </section>
      <section aria-label="Step 4: The Plan">
        <h2 className="mb-md text-h3 text-heading">Step 4: The Plan</h2>
        <ThePlan clientId={clientId} clientName={clientName} refreshKey={stepTwoSignal + stepThreeSignal} />
      </section>
    </div>
  );
}
