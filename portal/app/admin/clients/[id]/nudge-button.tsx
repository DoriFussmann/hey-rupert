"use client";

import { useEffect, useId, useState } from "react";
import { History, NudgeEditor } from "@/app/admin/nudge/nudge-workspace";
import { formatDateAtTime } from "@/lib/format";
import { daysLabel, type NudgeDetail } from "@/lib/nudge";

const buttonClass =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

/**
 * Client page header: opens the nudge editor for the step(s) waiting on the
 * client. Rendered only when it is the client's turn.
 */
export function NudgeButton({ detail }: { detail: NudgeDetail }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const turns = detail.clientTurns;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (turns.length === 0) return null;

  function onOpen() {
    setOpenKey(turns.length === 1 ? turns[0].key : null);
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className={buttonClass}
        disabled={!detail.email}
        title={detail.email ? undefined : "This client has no email address."}
      >
        Nudge
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-heading/20"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-card border border-border bg-surface shadow-lg"
          >
            <div className="flex items-start justify-between gap-md border-b border-border px-lg py-lg">
              <h2 id={titleId} className="text-h3">
                Nudge {detail.name}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-body-sm text-muted transition-colors duration-hover hover:text-heading"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-lg py-lg">
              {detail.paused ? (
                <p className="mb-md text-body-sm text-warning">
                  Automatic emails are paused for this client. Nudges still go out when you send them.
                </p>
              ) : null}
              <div className="grid gap-lg">
                {turns.map((turn) => (
                  <section key={turn.key}>
                    <div className="flex flex-wrap items-start justify-between gap-md">
                      <div className="min-w-0">
                        <p className="text-label uppercase tracking-label text-muted">{turn.label}</p>
                        <p className="mt-xs text-body text-heading">They need to {turn.task}.</p>
                        <p className="mt-xs text-body-sm text-secondary">
                          Waiting {daysLabel(turn.days)} · since {formatDateAtTime(turn.since)}
                        </p>
                      </div>
                      {openKey !== turn.key ? (
                        <button type="button" className={buttonClass} onClick={() => setOpenKey(turn.key)}>
                          Nudge
                        </button>
                      ) : null}
                    </div>
                    <History entries={detail.history[turn.key] ?? []} />
                    {openKey === turn.key ? (
                      <NudgeEditor clientId={detail.id} turn={turn} to={detail.email} />
                    ) : null}
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
