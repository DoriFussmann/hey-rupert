"use client";

import { useState } from "react";
import { switchMatchEngine } from "@/app/admin/tiers-actions";
import { inputClass, primaryButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";
import { MATCH_ENGINE_LABEL, type MatchEngine } from "@/lib/match/shared";

/** Switches the match engine for every client, with a reason that goes in the change log. */
export function EngineSwitch({ engine, configured }: { engine: MatchEngine; configured: boolean }) {
  const { pending, error, run } = useAction();
  const [note, setNote] = useState("");
  const next: MatchEngine = engine === "current" ? "four_tier" : "current";

  async function submit() {
    const question =
      next === "four_tier"
        ? "Switch every client's Match page, verification and Push to client to the four-tier engine? Lists already pushed or sent keep their three tiers."
        : "Switch every client back to the current engine? Four-tier runs and lists already pushed or sent stay exactly as they are.";
    if (!window.confirm(question)) return;
    const done = await run(() => switchMatchEngine(next, note));
    if (done) setNote("");
  }

  return (
    <div className="mt-sm">
      <label className="block text-body-sm text-secondary">
        Why (goes in the change log)
        <input
          className={`${inputClass} mt-xs`}
          value={note}
          maxLength={1000}
          placeholder={next === "four_tier" ? "e.g. Owner approved the four-tier comparison" : "e.g. Rolling back while we review X"}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={`${primaryButton} mt-sm`}
        disabled={pending || note.trim().length < 5 || !configured}
        onClick={() => void submit()}
      >
        {pending ? "Switching…" : `Switch to ${MATCH_ENGINE_LABEL[next]}`}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}
