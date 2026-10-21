"use client";

import { useState } from "react";
import { decideIdentityGroup } from "@/app/admin/tiers-actions";
import { inputClass, labelClass, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";

export function IdentityDecision({
  groupKey,
  kind,
  applied,
  decided,
}: {
  groupKey: string;
  kind: "duplicate" | "offices";
  applied: boolean;
  decided: boolean;
}) {
  const { pending, error, run } = useAction();
  const [note, setNote] = useState("");
  const id = `note-${groupKey.replace(/[^a-z0-9]+/gi, "-")}`;
  const confirmLabel = kind === "offices" ? "Confirm: one firm" : "Confirm: same firm, show once";
  const rejectLabel = kind === "offices" ? "Keep offices separate" : "Keep separate";
  return (
    <div className="mt-xs">
      <label className={labelClass} htmlFor={id}>
        Note (optional)
      </label>
      <div className="mt-xs flex flex-wrap items-center gap-xs">
        <input id={id} className={`${inputClass} max-w-md`} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className={smallButton} disabled={pending || (decided && applied)} onClick={() => run(() => decideIdentityGroup(groupKey, "confirmed", note))}>
          {confirmLabel}
        </button>
        <button type="button" className={smallButton} disabled={pending || (decided && !applied)} onClick={() => run(() => decideIdentityGroup(groupKey, "rejected", note))}>
          {rejectLabel}
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}
