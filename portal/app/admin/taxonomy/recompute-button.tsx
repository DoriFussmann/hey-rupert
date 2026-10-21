"use client";

import { useState } from "react";
import { recomputeCoverage } from "@/app/admin/taxonomy-actions";
import { primaryButton, secondaryButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";

export function RecomputeButton({ highlight }: { highlight: boolean }) {
  const { pending, error, run } = useAction();
  const [note, setNote] = useState<string | null>(null);

  async function recompute() {
    setNote(null);
    const result = await run(() => recomputeCoverage());
    if (result) {
      setNote(
        result.registered > 0
          ? `Done. ${result.registered} new value${result.registered === 1 ? "" : "s"} added for review.`
          : "Done.",
      );
    }
  }

  return (
    <div className="text-right">
      <button type="button" className={highlight ? primaryButton : secondaryButton} disabled={pending} onClick={recompute}>
        {pending ? "Computing…" : "Recompute coverage"}
      </button>
      {note ? (
        <p role="status" className="mt-xs text-body-sm text-success">
          {note}
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}
