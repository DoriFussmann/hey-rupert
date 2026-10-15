"use client";

import { useEffect, useRef, useState } from "react";
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
 * The company profile at a glance on the client page. The profile is built
 * from the intake automatically the first time the page is opened after the
 * intake (and again when the intake changed, unless it was edited by hand).
 */
export function CompanyProfileCard({
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

  useEffect(() => {
    if (started.current || !hasInterview || !claudeReady) return;
    const due =
      !initialState ||
      (!initialState.editedAt && isBehind(initialState, interviewUpdatedAt));
    if (!due) return;
    started.current = true;
    setPending(true);
    buildMatchProfile(clientId)
      .then((result) => {
        if (result.ok) setState(result.state);
        else setError(result.error);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "The company profile could not be built."),
      )
      .finally(() => setPending(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  const status = pending
    ? { label: "Building from the intake…", tone: "text-muted border-border" }
    : !state
      ? { label: "Not built yet", tone: "text-muted border-border" }
      : state.status === "ready"
        ? { label: "Ready to match", tone: "text-success border-success/40" }
        : { label: "Needs info", tone: "text-warning border-warning/40" };

  const answers = state?.answers ?? {};
  const facts = [
    { label: "Stage", value: value(answers, "stage") },
    { label: "Raising", value: value(answers, "raise_amount") },
    { label: "Sector", value: value(answers, "core_vertical") || value(answers, "core_industry") },
    {
      label: "HQ",
      value: [value(answers, "hq_city"), value(answers, "hq_country")].filter(Boolean).join(", "),
    },
  ];

  return (
    <section className="mb-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-sm">
            <h2 className="text-h4 text-heading">Company profile</h2>
            <span className={`rounded-full border px-sm py-px text-label uppercase tracking-label ${status.tone}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-xs text-body-sm text-muted">
            {value(answers, "one_liner") ||
              (state?.builtAt
                ? `Built from the intake ${formatDateAtTime(state.builtAt)}.`
                : "The source of truth for matching, the analysis and the narrative.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
          <Link
            href={`/admin/clients/${clientId}/match`}
            className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading"
          >
            Rupert Match
          </Link>
          <Link
            href={`/admin/clients/${clientId}/profile`}
            className="rounded-md bg-primary px-md py-sm text-body-sm text-white no-underline transition-colors duration-hover hover:bg-primary-hover"
          >
            Open company profile
          </Link>
        </div>
      </div>
      {state ? (
        <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-4">
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
      {state && state.gaps.length > 0 ? (
        <p className="border-t border-border px-lg py-sm text-body-sm text-warning">
          Matching needs: {state.gaps.map((gap) => gap.label).join(", ")}. Add it in the company profile.
        </p>
      ) : null}
      {state?.editedAt && isBehind(state, interviewUpdatedAt) ? (
        <p className="border-t border-border px-lg py-sm text-body-sm text-secondary">
          The intake changed since the profile was built. Your edits are kept; rebuild it from the
          company profile to pick up the new answers.
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
