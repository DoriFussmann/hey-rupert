"use client";

import { useState } from "react";
import { updateClientStage } from "@/app/admin/actions";
import { setAdminFlash, useAdminFlash } from "@/lib/admin-flash";
import {
  ENGAGEMENT_STAGES,
  type EngagementStage,
} from "@/lib/types";

function isEngagementStage(value: string): value is EngagementStage {
  return ENGAGEMENT_STAGES.some((stage) => stage.value === value);
}

export function ClientStageSelect({
  clientId,
  stage,
}: {
  clientId: string;
  stage?: string;
}) {
  const current = stage ?? "";
  const initial: EngagementStage = isEngagementStage(current)
    ? current
    : "scope_of_work";
  const [value, setValue] = useState<EngagementStage>(initial);
  const [pending, setPending] = useState(false);
  const flash = useAdminFlash("stage");

  async function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (!isEngagementStage(next) || next === value) return;

    const previous = value;
    setValue(next);
    setPending(true);
    setAdminFlash("stage", null);

    try {
      const result = await updateClientStage(clientId, next);
      if (!result?.ok) {
        setValue(previous);
        setAdminFlash("stage", {
          kind: "error",
          text: result?.error ?? "Unable to update stage.",
        });
        return;
      }

      setAdminFlash("stage", { kind: "ok", text: "Stage updated." });
    } catch (err) {
      setValue(previous);
      setAdminFlash("stage", {
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to update stage.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-w-[12rem]">
      <label className="block text-label uppercase tracking-label text-muted">
        Stage
        <select
          className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
          value={value}
          onChange={onChange}
          disabled={pending}
        >
          {ENGAGEMENT_STAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {flash?.kind === "ok" ? (
        <p className="mt-sm text-body-sm text-success">{flash.text}</p>
      ) : null}
      {flash?.kind === "error" ? (
        <p className="mt-sm text-body-sm text-error">{flash.text}</p>
      ) : null}
    </div>
  );
}
