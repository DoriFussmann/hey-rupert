"use client";

import { useState } from "react";
import { clearFundReview, reviewFund } from "@/app/admin/tiers-actions";
import { inputClass, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";
import { REJECT_REASONS, type Review } from "@/lib/match/shared";

/**
 * Approve or reject a fund for this client. Saved runs never change: the
 * review applies from the next run, and Push waits until the match is run again.
 */
export function FundReview({
  clientId,
  firmId,
  firmName,
  tier,
  current,
}: {
  clientId: string;
  firmId: string;
  firmName: string;
  tier: string;
  current: Review | null;
}) {
  const { pending, error, run } = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [note, setNote] = useState("");
  const [hideForAll, setHideForAll] = useState(false);

  async function save(status: "ok" | "no") {
    const done = await run(() =>
      reviewFund(clientId, { firmId, firmName, tier, status, reason: status === "no" ? reason : "", note, hideForAll: status === "no" && hideForAll }),
    );
    if (done) setRejecting(false);
  }

  return (
    <div className="rounded-md border border-border px-sm py-xs">
      <p className="text-muted">
        {current
          ? current.status === "no"
            ? `Rejected for this client: ${current.reason || "no reason"}${current.note ? ` (${current.note})` : ""}.`
            : `Approved for this client${current.note ? ` (${current.note})` : ""}.`
          : "Not reviewed."}{" "}
        Reviews apply from the next run.
      </p>
      {rejecting ? (
        <div className="mt-xs grid gap-xs">
          <label className="text-body-sm text-secondary">
            Reason
            <select className={`${inputClass} mt-xs`} value={reason} onChange={(event) => setReason(event.target.value)}>
              {REJECT_REASONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-body-sm text-secondary">
            Note (optional)
            <input className={`${inputClass} mt-xs`} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
          </label>
          <label className="flex items-center gap-sm text-body-sm text-secondary">
            <input type="checkbox" checked={hideForAll} onChange={(event) => setHideForAll(event.target.checked)} />
            Hide this fund for all clients
          </label>
          <div className="flex flex-wrap gap-xs">
            <button type="button" className={smallButton} disabled={pending} onClick={() => void save("no")}>
              {pending ? "Saving…" : "Reject"}
            </button>
            <button type="button" className={smallButton} disabled={pending} onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-xs flex flex-wrap gap-xs">
          <button type="button" className={smallButton} disabled={pending} onClick={() => void save("ok")}>
            Approve
          </button>
          <button type="button" className={smallButton} disabled={pending} onClick={() => setRejecting(true)}>
            Reject…
          </button>
          {current ? (
            <button type="button" className={smallButton} disabled={pending} onClick={() => void run(() => clearFundReview(clientId, firmId))}>
              Clear review
            </button>
          ) : null}
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}
