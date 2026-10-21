"use client";

import { useState } from "react";
import { classifyNewData } from "@/app/admin/taxonomy-actions";
import { primaryButton, secondaryButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";

/**
 * Classify new data: adds every provider value the taxonomy hasn't seen,
 * recounts coverage and asks the AI for a suggestion on each unmapped value.
 * Nothing applies until an admin accepts it under Value mappings.
 */
export function ClassifyButton({ highlight }: { highlight: boolean }) {
  const { pending, error, run } = useAction();
  const [note, setNote] = useState<string | null>(null);

  async function classify() {
    setNote(null);
    const result = await run(() => classifyNewData());
    if (!result) return;
    const parts = [
      result.registered > 0 ? `${result.registered} new value${result.registered === 1 ? "" : "s"} found.` : "No new values.",
      result.aiReady
        ? `${result.suggested} AI suggestion${result.suggested === 1 ? "" : "s"} waiting for review under Value mappings.`
        : "The AI is not configured (ANTHROPIC_API_KEY): map the values by hand.",
    ];
    if (result.remaining > 0) parts.push(`${result.remaining} still without a suggestion: click Classify again.`);
    setNote(parts.join(" "));
  }

  return (
    <div className="text-right">
      <button type="button" className={highlight ? primaryButton : secondaryButton} disabled={pending} onClick={classify}>
        {pending ? "Classifying… up to a few minutes" : "Classify new data"}
      </button>
      {note ? (
        <p role="status" className="mt-xs max-w-md text-body-sm text-success">
          {note}
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}
