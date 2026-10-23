"use client";

import { useState } from "react";
import Link from "next/link";
import { buildMatchProfile } from "@/app/admin/match-actions";
import { formatDateAtTime } from "@/lib/format";
import type { MatchAnswers, MatchProfileState } from "@/lib/match/shared";

/** The interview changed after the profile was built from it. */
function isBehind(state: MatchProfileState, interviewUpdatedAt: string | null) {
  if (!interviewUpdatedAt || !state.sourceInterviewAt) return false;
  return Date.parse(interviewUpdatedAt) > Date.parse(state.sourceInterviewAt);
}

function value(answers: MatchAnswers, id: string) {
  const raw = answers[id];
  return Array.isArray(raw) ? raw.join(", ") : (raw ?? "").trim();
}

/**
 * The company profile at a glance on the client page. It is built only when
 * Rupert clicks Analyze, once the intake and the materials are in; new
 * intake information is flagged so he can analyze again.
 */
export function CompanyProfileCard({
  clientId,
  initialState,
  interviewUpdatedAt,
  blockedReason,
  claudeReady,
}: {
  clientId: string;
  initialState: MatchProfileState | null;
  interviewUpdatedAt: string | null;
  /** Why Analyze can't run yet (intake or materials not in), or null. */
  blockedReason: string | null;
  claudeReady: boolean;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const behind = state ? isBehind(state, interviewUpdatedAt) : false;

  async function onAnalyze() {
    if (
      state?.editedAt &&
      !window.confirm("Analyze again from the intake? Your edits to the profile will be replaced.")
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await buildMatchProfile(clientId);
      if (result.ok) setState(result.state);
      else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The company profile could not be built.");
    } finally {
      setPending(false);
    }
  }

  const status = pending
    ? { label: "Analyzing…", tone: "text-muted border-border" }
    : !state
      ? { label: "Not analyzed yet", tone: "text-muted border-border" }
      : state.status === "ready"
        ? { label: "Ready to match", tone: "text-success border-success/40" }
        : { label: "Needs info", tone: "text-warning border-warning/40" };

  const answers = state?.answers ?? {};
  const facts = [
    { label: "Stage", value: value(answers, "stage") },
    { label: "Raising", value: value(answers, "raise_amount") },
    { label: "Sector", value: value(answers, "core_vertical") || value(answers, "core_industry") },
  ];
  const unavailable = !claudeReady ? "ANTHROPIC_API_KEY is not configured." : blockedReason;

  return (
    <section className="mb-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-sm">
            <h2 className="text-h4 text-heading">Company Profile</h2>
            <span className={`rounded-full border px-sm py-px text-label uppercase tracking-label ${status.tone}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-xs text-body-sm text-muted">
            {value(answers, "one_liner") ||
              (state?.builtAt
                ? `Analyzed from the intake ${formatDateAtTime(state.builtAt)}.`
                : "Analyze builds the profile from the intake and the materials. Matching, the narrative and the emails read from it.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
          <button
            type="button"
            onClick={() => void onAnalyze()}
            disabled={pending || Boolean(unavailable)}
            title={unavailable ?? undefined}
            className={`rounded-md px-md py-sm text-body-sm transition-colors duration-hover disabled:opacity-40 ${
              !state || behind
                ? "bg-primary text-white hover:bg-primary-hover"
                : "border border-border bg-surface text-secondary hover:text-heading"
            }`}
          >
            {pending ? "Analyzing…" : state ? "Re-analyze" : "Analyze"}
          </button>
          <Link
            href={`/admin/clients/${clientId}/profile`}
            className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading"
          >
            Open Company Profile
          </Link>
        </div>
      </div>
      {state ? (
        <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="bg-surface px-lg py-sm">
              <dt className="text-label uppercase tracking-label text-muted">{fact.label}</dt>
              <dd className={`mt-xs truncate text-body-sm ${fact.value ? "text-heading" : "text-muted"}`}>
                {fact.value || "Not set"}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {unavailable && !pending ? (
        <p className="border-t border-border px-lg py-sm text-body-sm text-muted">{unavailable}</p>
      ) : null}
      {state && state.gaps.length > 0 ? (
        <p className="border-t border-border px-lg py-sm text-body-sm text-warning">
          Matching needs: {state.gaps.map((gap) => gap.label).join(", ")}. Add it in the company profile.
        </p>
      ) : null}
      {behind && !pending ? (
        <p className="border-t border-border px-lg py-sm text-body-sm text-secondary">
          New intake info since last analysis. Re-analyze to use it
          {state?.editedAt ? " (your edits to the profile will be replaced)" : ""}.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="border-t border-border px-lg py-sm text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
