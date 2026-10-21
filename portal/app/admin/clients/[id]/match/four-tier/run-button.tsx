"use client";

import { useRouter } from "next/navigation";
import { runFourTierPreview } from "@/app/admin/tiers-actions";
import { primaryButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";

export function RunFourTierButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const { pending, error, run } = useAction();

  async function start() {
    const result = await run(() => runFourTierPreview(clientId));
    if (result) router.push(`/admin/clients/${clientId}/match/four-tier?run=${result.runId}`);
  }

  return (
    <div className="text-right">
      <button type="button" className={primaryButton} disabled={pending} onClick={start}>
        {pending ? "Running…" : "Run four-tier match"}
      </button>
      {pending ? (
        <p role="status" className="mt-xs text-body-sm text-muted">
          Up to a minute. The run is saved permanently.
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}
