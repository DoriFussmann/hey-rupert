"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buildMatchProfile } from "@/app/admin/match-actions";
import type { MatchProfileState } from "@/lib/match/shared";

const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

/** The interview changed after the profile was built from it. */
function isBehind(state: MatchProfileState, interviewUpdatedAt: string | null) {
  if (!interviewUpdatedAt || !state.sourceInterviewAt) return false;
  return Date.parse(interviewUpdatedAt) > Date.parse(state.sourceInterviewAt);
}

/**
 * Match readiness on the client page. The profile is built from the intake
 * automatically the first time the page is opened after the intake (and
 * again when the intake changed, unless the profile was edited by hand).
 */
export function MatchProfilePanel({
  clientId,
  initialState,
  interviewUpdatedAt,
  hasInterview,
  claudeReady,
}: {
  clientId: string;
  initialState: MatchProfileState | null;
  interviewUpdatedAt: string | null;
  hasInterview: boolean;
  claudeReady: boolean;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function build() {
    setPending(true);
    setError(null);
    try {
      const result = await buildMatchProfile(clientId);
      if (result.ok) setState(result.state);
      else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The match profile could not be built.");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (started.current || !hasInterview || !claudeReady) return;
    const due =
      !initialState ||
      (!initialState.editedAt && isBehind(initialState, interviewUpdatedAt));
    if (!due) return;
    started.current = true;
    void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  const status = pending
    ? { label: "Building…", tone: "text-muted border-border" }
    : !state
      ? { label: "Not built yet", tone: "text-muted border-border" }
      : state.status === "ready"
        ? { label: "Ready to match", tone: "text-success border-success/40" }
        : { label: "Needs info", tone: "text-warning border-warning/40" };

  return (
    <section className="mb-lg rounded-card border border-border bg-surface px-lg py-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-sm">
            <h2 className="text-h4 text-heading">Investor matching</h2>
            <span className={`rounded-full border px-sm py-px text-label uppercase tracking-label ${status.tone}`}>
              {status.label}
            </span>
          </div>
          {state && state.gaps.length > 0 ? (
            <>
              <p className="mt-xs text-body-sm text-warning">
                Missing answers: {state.gaps.map((gap) => gap.label).join(", ")}
              </p>
              <p className="mt-xs text-body-sm text-secondary">
                Add them in Rupert Match (from your notes, or ask the founder) and click Save and run match.
                Nothing is needed from the client in the portal, and the match runs in the meantime.
              </p>
            </>
          ) : null}
          {state?.editedAt && isBehind(state, interviewUpdatedAt) ? (
            <p className="mt-xs text-body-sm text-secondary">
              The intake changed since the profile was built. Your edits are kept; rebuild to pick up the new answers.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-xs text-body-sm text-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-sm">
          {hasInterview && claudeReady ? (
            <button
              type="button"
              className={smallButton}
              disabled={pending}
              onClick={() => {
                if (
                  state?.editedAt &&
                  !window.confirm("Rebuild the profile from the intake? Your edits to it will be replaced.")
                ) {
                  return;
                }
                void build();
              }}
            >
              Rebuild from intake
            </button>
          ) : null}
          <Link
            href={`/admin/clients/${clientId}/match`}
            className="rounded-md bg-primary px-sm py-xs text-body-sm text-white no-underline transition-colors duration-hover hover:bg-primary-hover"
          >
            Open Rupert Match
          </Link>
        </div>
      </div>
    </section>
  );
}
