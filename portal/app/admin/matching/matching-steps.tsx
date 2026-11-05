"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DryMatch } from "@/app/admin/matching/dry-match";
import { CompetitiveLandscape } from "@/app/admin/matching/landscape";
import { FinalRoster } from "@/app/admin/matching/final-roster";
import { ThePlan } from "@/app/admin/matching/the-plan";
import { StepSignal } from "@/app/admin/matching/step-signal";
import { LandscapeKindContext } from "@/app/admin/matching/landscape-kind";
import { StepReady } from "@/app/admin/matching/step-order";
import { SummaryView } from "@/app/admin/matching/summary-view";
import {
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/match/ui";
import {
  finalizeTheMatching,
  loadFinalization,
  pushSummariesToClient,
  reopenTheMatching,
} from "@/app/admin/summary-actions";
import type { Finalization } from "@/lib/match/summary/server";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

/** Steps 1 to 4, each opening once the one before it is confirmed. */
function Steps({
  clientId,
  clientName,
  onPlanConfirmed,
}: {
  clientId: string;
  clientName: string;
  onPlanConfirmed?: (confirmed: boolean) => void;
}) {
  const [stepOne, setStepOne] = useState(false);
  const [stepTwoSignal, setStepTwoSignal] = useState(0);
  const bump = useCallback(() => setStepTwoSignal((v) => v + 1), []);
  const [likeSignal, setLikeSignal] = useState(0);
  const bumpLike = useCallback(() => setLikeSignal((v) => v + 1), []);
  const [stepThreeSignal, setStepThreeSignal] = useState(0);
  const bumpThree = useCallback(() => setStepThreeSignal((v) => v + 1), []);
  // All five load at once, but each shows only once the steps above it have loaded: they appear in order.
  const [ready, setReady] = useState([false, false, false, false, false]);
  const reporters = useMemo(
    () =>
      [0, 1, 2, 3, 4].map(
        (i) => (r: boolean) =>
          setReady((prev) =>
            prev[i] === r ? prev : prev.map((x, j) => (j === i ? r : x)),
          ),
      ),
    [],
  );
  const shown = (i: number) =>
    ready.slice(0, i).every(Boolean) ? "" : "hidden";
  return (
    <div className="space-y-xl">
      <section aria-label="Step 1: Dry Match Short List">
        <h2 className="mb-md text-h3 text-heading">
          Step 1: Dry Match Short List
        </h2>
        <StepReady.Provider value={reporters[0]}>
          <DryMatch
            clientId={clientId}
            clientName={clientName}
            onSavedChange={setStepOne}
          />
        </StepReady.Provider>
      </section>
      <section
        aria-label="Step 2: Competitive Landscape Enrichment"
        className={shown(1)}
      >
        <h2 className="mb-md text-h3 text-heading">
          Step 2: Competitive Landscape Enrichment
        </h2>
        <StepSignal.Provider value={bump}>
          <StepReady.Provider value={reporters[1]}>
            <CompetitiveLandscape
              clientId={clientId}
              stepOneConfirmed={stepOne}
            />
          </StepReady.Provider>
        </StepSignal.Provider>
      </section>
      <section aria-label="Step 3: Companies Like You" className={shown(2)}>
        <h2 className="mb-md text-h3 text-heading">
          Step 3: Companies Like You
        </h2>
        <LandscapeKindContext.Provider value="comparables">
          <StepSignal.Provider value={bumpLike}>
            <StepReady.Provider value={reporters[2]}>
              <CompetitiveLandscape
                clientId={clientId}
                stepOneConfirmed={stepOne}
                refreshKey={stepTwoSignal}
              />
            </StepReady.Provider>
          </StepSignal.Provider>
        </LandscapeKindContext.Provider>
      </section>
      <section aria-label="Step 4: The Final Roster" className={shown(3)}>
        <h2 className="mb-md text-h3 text-heading">Step 4: The Final Roster</h2>
        <StepReady.Provider value={reporters[3]}>
          <FinalRoster
            clientId={clientId}
            clientName={clientName}
            refreshKey={stepTwoSignal + likeSignal}
            onChanged={bumpThree}
          />
        </StepReady.Provider>
      </section>
      <section aria-label="Step 5: The Plan" className={shown(4)}>
        <h2 className="mb-md text-h3 text-heading">Step 5: The Plan</h2>
        <StepReady.Provider value={reporters[4]}>
          <ThePlan
            clientId={clientId}
            clientName={clientName}
            refreshKey={stepTwoSignal + likeSignal + stepThreeSignal}
            onConfirmedChange={onPlanConfirmed}
          />
        </StepReady.Provider>
      </section>
    </div>
  );
}

/**
 * The new matching. Before Finalize: the steps, and Finalize once Step 4 is
 * confirmed. After: the Matching Summary and the Competitive Landscape
 * Overview, each with Download and Push to Client, and the steps folded into
 * one panel with Reopen matching.
 */
export function MatchingSteps({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [fin, setFin] = useState<Finalization | null | undefined>(undefined);
  const [planConfirmed, setPlanConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void loadFinalization(clientId).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setError(r.error);
        setFin(null);
        return;
      }
      setFin(r.finalization);
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  async function run(
    label: string,
    action: () => Promise<
      | { ok: true; finalization: Finalization | null }
      | { ok: false; error: string }
    >,
  ) {
    setBusy(label);
    setError(null);
    const r = await action();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setFin(r.finalization);
    setPanelOpen(false);
  }

  const errorLine = error ? (
    <p className="mt-sm text-body-sm text-error">{error}</p>
  ) : null;
  if (fin === undefined)
    return <p className="text-body-sm text-muted">Loading…</p>;

  if (!fin) {
    return (
      <div className="space-y-xl">
        <Steps
          clientId={clientId}
          clientName={clientName}
          onPlanConfirmed={setPlanConfirmed}
        />
        {planConfirmed ? (
          <div className="flex flex-wrap items-center justify-end gap-md rounded-card border border-primary bg-primary-tint/40 px-lg py-md">
            <p className="mr-auto max-w-prose text-body-sm text-secondary">
              Finalize closes the matching: the steps lock and fold away, and
              the summaries open, ready to push to the client page.
            </p>
            <button
              type="button"
              className={primaryButton}
              disabled={busy !== null}
              onClick={() => {
                if (
                  !window.confirm(
                    "Finalize the matching? The steps lock until you reopen it.",
                  )
                )
                  return;
                void run("finalize", () => finalizeTheMatching(clientId));
              }}
            >
              {busy === "finalize" ? "Finalizing…" : "Finalize"}
            </button>
          </div>
        ) : null}
        {errorLine}
      </div>
    );
  }

  const pushed =
    fin.pushed.matching &&
    (!fin.landscape || fin.pushed.landscape) &&
    (!fin.peers || fin.pushed.peers);

  return (
    <div className="space-y-lg">
      <SummaryView summary={fin.matching} />
      {fin.landscape ? <SummaryView summary={fin.landscape} /> : null}
      {fin.peers ? <SummaryView summary={fin.peers} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-md">
        <p className="mr-auto text-body-sm text-secondary">
          {pushed
            ? "✓ Both summaries are on the client page. Pushing again replaces them."
            : `Push to Client sends ${fin.landscape || fin.peers ? "the summaries" : "the summary"} to the client page (not the client's portal yet).`}
        </p>
        <a
          href={`/admin/clients/${clientId}/summary-export`}
          className={`${secondaryButton} no-underline`}
        >
          Download (Excel)
        </a>
        <button
          type="button"
          className={primaryButton}
          disabled={busy !== null}
          onClick={() =>
            void run("push", () => pushSummariesToClient(clientId))
          }
        >
          {busy === "push"
            ? "Pushing…"
            : pushed
              ? "Push to Client again"
              : "Push to Client"}
        </button>
      </div>
      {errorLine}
      <details
        className="group rounded-card border border-border bg-surface"
        open={panelOpen}
        onToggle={(e) => setPanelOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-md px-lg py-md [&::-webkit-details-marker]:hidden">
          <span>
            <span className="text-h4 text-heading">
              Matching steps (finalized)
            </span>
            <span className="ml-sm text-body-sm text-muted">
              Finalized {when(fin.finalizedAt)}
              {fin.finalizedBy ? ` by ${fin.finalizedBy}` : ""}. Steps 1 to 5
              with every detail; locked.
            </span>
          </span>
          <span className="flex items-center gap-md">
            <button
              type="button"
              className={secondaryButton}
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault();
                if (
                  !window.confirm(
                    "Reopen the matching? The steps unlock; what was pushed to the client page stays until you push again.",
                  )
                )
                  return;
                void run("reopen", () => reopenTheMatching(clientId));
              }}
            >
              {busy === "reopen" ? "Reopening…" : "Reopen matching"}
            </button>
            <span className="text-muted transition-transform duration-hover group-open:rotate-180">
              ▾
            </span>
          </span>
        </summary>
        {panelOpen ? (
          <div className="border-t border-border px-lg py-md">
            <Steps clientId={clientId} clientName={clientName} />
          </div>
        ) : null}
      </details>
    </div>
  );
}
