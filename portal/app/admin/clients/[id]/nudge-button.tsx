"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { loadClientNudge } from "@/app/admin/nudge-actions";
import { History, NudgeEditor } from "@/app/admin/nudge/nudge-workspace";
import { formatDateAtTime } from "@/lib/format";
import { daysLabel, type NudgeDetail } from "@/lib/nudge";

const buttonClass =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

type Props =
  /** Client page: the detail is loaded with the page. */
  | { detail: NudgeDetail; clientId?: never }
  /** Client list: the detail is loaded when the button is clicked. */
  | { clientId: string; detail?: never };

/**
 * Opens the nudge editor for the step(s) waiting on the client, with the
 * draft written on open. Render it only when it is the client's turn.
 */
export function NudgeButton(props: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<NudgeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const detail = props.detail ?? loaded;
  const id = props.detail?.id ?? props.clientId ?? "";

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function pickFirst(next: NudgeDetail) {
    setOpenKey(next.clientTurns.length === 1 ? next.clientTurns[0].key : null);
  }

  async function onOpen() {
    setOpen(true);
    setError(null);
    if (props.detail) {
      pickFirst(props.detail);
      return;
    }
    setLoaded(null);
    try {
      const result = await loadClientNudge(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLoaded(result.detail);
      pickFirst(result.detail);
    } catch {
      setError("Unable to load this client. Please try again.");
    }
  }

  if (props.detail && props.detail.clientTurns.length === 0) return null;
  const noEmail = props.detail ? !props.detail.email : false;
  const turns = detail?.clientTurns ?? [];

  const modal = (
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
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-card border border-border bg-surface text-left shadow-lg"
      >
        <div className="flex items-start justify-between gap-md border-b border-border px-lg py-lg">
          <h2 id={titleId} className="text-h3">
            Nudge {detail?.name ?? ""}
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
          {error ? (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          ) : !detail ? (
            <p role="status" className="text-body-sm text-muted">
              Loading…
            </p>
          ) : turns.length === 0 ? (
            <p className="text-body-sm text-muted">Nothing is waiting on this client right now.</p>
          ) : !detail.email ? (
            <p className="text-body-sm text-error">This client has no email address.</p>
          ) : (
            <>
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
                      <NudgeEditor clientId={detail.id} turn={turn} to={detail.email} autoDraft />
                    ) : null}
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // Stops clicks (including inside the portal) from reaching a clickable table row.
  return (
    <span onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => void onOpen()}
        className={buttonClass}
        disabled={noEmail}
        title={noEmail ? "This client has no email address." : undefined}
      >
        Nudge
      </button>
      {open ? createPortal(modal, document.body) : null}
    </span>
  );
}
