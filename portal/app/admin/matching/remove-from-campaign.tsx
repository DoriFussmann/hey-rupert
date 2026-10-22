"use client";

import { useState } from "react";
import { removeFromPlanAction } from "@/app/admin/capacity-actions";
import { inputClass, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";

/**
 * Takes one fund out of the confirmed campaign. The plan saves a new version
 * and the next fund in the same tier moves in. The saved run never changes.
 */
export function RemoveFromCampaign({ clientId, runId, firmId, firmName }: { clientId: string; runId: string; firmId: string; firmName: string }) {
  const { pending, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<string | null>(null);

  async function remove() {
    const result = await run(() => removeFromPlanAction(clientId, runId, firmId, reason));
    if (!result) return;
    setOpen(false);
    setDone(
      result.replacedBy
        ? `Removed. ${result.replacedBy} moved in (plan version ${result.version}).`
        : `Removed (plan version ${result.version}). No fund was left in this tier to replace it.`,
    );
  }

  return (
    <div className="rounded-md border border-border px-sm py-xs">
      {open ? (
        <div className="grid gap-xs">
          <label className="text-body-sm text-secondary">
            Why is {firmName} leaving the campaign?
            <input
              className={`${inputClass} mt-xs`}
              value={reason}
              maxLength={500}
              placeholder="e.g. Founder already spoke to them"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-xs">
            <button type="button" className={smallButton} disabled={pending || !reason.trim()} onClick={() => void remove()}>
              {pending ? "Removing…" : "Remove from campaign"}
            </button>
            <button type="button" className={smallButton} disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-xs">
          <button type="button" className={smallButton} onClick={() => setOpen(true)}>
            Remove from campaign…
          </button>
          <span className="text-body-sm text-muted">The next fund in this tier moves in.</span>
        </div>
      )}
      {done ? (
        <p role="status" className="mt-xs text-body-sm text-success">
          {done}
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}
