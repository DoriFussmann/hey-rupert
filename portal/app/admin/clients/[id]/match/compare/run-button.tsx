"use client";

import { useRouter } from "next/navigation";
import { runTierComparison } from "@/app/admin/tiers-actions";
import { primaryButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";

export function RunComparisonButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const { pending, error, run } = useAction();

  async function start() {
    const result = await run(() => runTierComparison(clientId));
    if (result) router.push(`/admin/clients/${clientId}/match/compare?comparison=${result.comparisonId}`);
  }

  return (
    <div className="text-right">
      <button type="button" className={primaryButton} disabled={pending} onClick={start}>
        {pending ? "Running both engines…" : "Run comparison"}
      </button>
      {pending ? (
        <p role="status" className="mt-xs text-body-sm text-muted">
          This takes up to a minute. Both runs are saved permanently.
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}
