"use client";

import { useState } from "react";
import Link from "next/link";
import {
  checkClientWebsites,
  runMatch,
  sendMatchToClient,
  updateMatchSettings,
} from "@/app/admin/match-actions";
import { ResultBoard } from "@/app/admin/clients/[id]/match/result-board";
import {
  errorText,
  n,
  type Notice,
  type RunAction,
} from "@/app/admin/clients/[id]/match/ui";
import { formatDateAtTime } from "@/lib/format";
import {
  DEFAULT_SETTINGS,
  TIERS,
  siteSummaryText,
  type MatchAnswers,
  type MatchProfileState,
  type MatchSettings,
  type MatchView,
} from "@/lib/match/shared";

function answer(answers: MatchAnswers, id: string) {
  const raw = answers[id];
  return Array.isArray(raw) ? raw.join(", ") : (raw ?? "").trim();
}

/** The profile the match runs on, read-only here: it is edited in the company profile. */
function ProfileStrip({ clientId, state }: { clientId: string; state: MatchProfileState | null }) {
  const answers = state?.answers ?? {};
  const facts = [
    answer(answers, "stage"),
    answer(answers, "raise_amount"),
    answer(answers, "core_vertical") || answer(answers, "core_industry"),
    [answer(answers, "hq_city"), answer(answers, "hq_country")].filter(Boolean).join(", "),
  ].filter(Boolean);
  return (
    <section className="flex flex-wrap items-center justify-between gap-md rounded-card border border-border bg-surface px-lg py-md">
      <div className="min-w-0">
        <p className="text-label uppercase tracking-label text-muted">Matching on</p>
        <p className="mt-xs text-body-sm text-heading">
          {facts.length > 0 ? facts.join(" · ") : "No company profile yet."}
        </p>
        {state && state.gaps.length > 0 ? (
          <p className="mt-xs text-body-sm text-warning">
            Needs {state.gaps.map((gap) => gap.label).join(", ")} before it can run.
          </p>
        ) : null}
      </div>
      <Link
        href={`/admin/clients/${clientId}/profile`}
        className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading"
      >
        Edit company profile
      </Link>
    </section>
  );
}

export function MatchWorkspace({
  clientId,
  initialState,
  initialView,
  initialStale,
  initialError,
  database,
  intakeComplete,
  feedbackConfirmed,
  narrativeConfirmed,
  sendBlocked,
  profileReady,
}: {
  clientId: string;
  initialState: MatchProfileState | null;
  initialView: MatchView | null;
  initialStale: boolean;
  initialError: string | null;
  database: { firms: number; contacts: number } | null;
  intakeComplete: boolean;
  feedbackConfirmed: boolean;
  narrativeConfirmed: boolean;
  /** Why Send to client is not available yet, or null when it is. */
  sendBlocked: string | null;
  profileReady: boolean;
}) {
  const [state, setState] = useState(initialState);
  const [view, setView] = useState(initialView);
  const [stale, setStale] = useState(initialStale);
  function showFresh(next: MatchView) {
    setView(next);
    setStale(false);
  }
  const [notice, setNotice] = useState<Notice | null>(
    initialError ? { kind: "error", text: initialError } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const settings = state?.settings ?? DEFAULT_SETTINGS;
  const databaseLive = Boolean(database);
  const canMatch = profileReady && databaseLive;

  const run: RunAction = async (label, action, onDone) => {
    setBusy(label);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        setNotice({ kind: "error", text: (result as { ok: false; error: string }).error });
        return;
      }
      onDone(result as Extract<typeof result, { ok: true }>);
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "Something went wrong.") });
    } finally {
      setBusy(null);
    }
  };

  function onRunMatch() {
    void run(
      view ? "Re-running the match…" : "Running the match…",
      () => runMatch(clientId),
      (result) => {
        showFresh(result.view);
        setNotice({ kind: "ok", text: `Last run ${formatDateAtTime(result.view.ranAt)}.` });
      },
    );
  }

  function changeSettings(next: MatchSettings, toast?: (after: MatchView) => string) {
    const before = view;
    void run(
      "Re-running the match…",
      () => updateMatchSettings(clientId, next),
      (result) => {
        setState((current) => (current ? { ...current, settings: next } : current));
        showFresh(result.view);
        if (toast && before) setNotice({ kind: "ok", text: toast(result.view) });
      },
    );
  }

  function checkWebsites() {
    void run(
      "Checking this client's top funds' websites. This can take a few minutes…",
      () => checkClientWebsites(clientId),
      (result) => {
        showFresh(result.view);
        const dropped = TIERS.reduce((sum, tier) => sum + result.view.tiers[tier.key].deadRemoved.length, 0);
        const parts =
          result.checked === 0
            ? ["Every top fund's website was already checked in the last 14 days."]
            : [`Checked ${n(result.checked)} websites: ${siteSummaryText(result.summary)}.`];
        if (result.pending > 0) parts.push(`${n(result.pending)} still to check: click Check websites again.`);
        parts.push(
          dropped > 0
            ? `${n(dropped)} fund${dropped === 1 ? " is" : "s are"} out of the tiers because the site is dead, parked or not investing (listed under "dropped for dead websites" in each tier).`
            : "No fund was dropped for its website.",
        );
        parts.push(
          'Sites that block checks or can\'t be read are not proof of anything: filter the leads by website status and open them yourself.',
        );
        setNotice({ kind: "ok", text: parts.join(" ") });
      },
    );
  }

  function sendToClient() {
    if (
      !window.confirm(
        "Send these funds to the client's Investor List? They see fund names, tiers, websites and contact counts, never people. This replaces the list on their portal.",
      )
    ) {
      return;
    }
    void run(
      "Sending the investor list…",
      () => sendMatchToClient(clientId),
      (result) => {
        setNotice({
          kind: result.emailed ? "ok" : "error",
          text: result.emailed
            ? `${n(result.funds)} funds are on the client's Investor List, and they were emailed.`
            : `${n(result.funds)} funds are on the client's Investor List. The email was not sent: ${result.emailError ?? "unknown reason"}.`,
        });
      },
    );
  }

  return (
    <div className="space-y-lg">
      {database ? (
        <p className="text-body-sm text-muted">
          Fund Database: {n(database.firms)} funds · {n(database.contacts)} contacts.{" "}
          <Link href="/admin/fund-database" className="text-primary hover:text-primary-hover">
            Manage
          </Link>
        </p>
      ) : (
        <p className="rounded-card border border-border bg-surface px-lg py-md text-body-sm text-secondary">
          No Fund Database yet.{" "}
          <Link href="/admin/fund-database" className="text-primary hover:text-primary-hover">
            Upload the workbook
          </Link>{" "}
          to start matching.
        </p>
      )}

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-card border bg-surface px-lg py-md text-body-sm ${
            notice.kind === "error" ? "border-error/40 text-error" : "border-success/40 text-success"
          }`}
        >
          {notice.text}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="rounded-card border border-border bg-primary-tint px-lg py-md text-body-sm text-primary">
          {busy}
        </p>
      ) : null}

      <section className="rounded-card border border-border bg-surface px-lg py-md">
        <div className="flex flex-wrap items-center justify-between gap-md">
          <div>
            <button
              type="button"
              className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
              disabled={!canMatch || Boolean(busy)}
              onClick={onRunMatch}
            >
              {busy && busy.toLowerCase().includes("match")
                ? "Running…"
                : view
                  ? "Re-run match"
                  : "Run match"}
            </button>
            <p className="mt-xs text-body-sm text-muted">
              {view
                ? stale
                  ? "Re-run to update."
                  : `Last run ${formatDateAtTime(view.ranAt)}.`
                : "No match yet."}
            </p>
          </div>
        </div>
        <ul className="mt-md grid gap-xs text-body-sm">
          <li className={profileReady ? "text-success" : "text-secondary"}>
            {profileReady ? "Company profile ready to match." : "Company profile is not ready to match."}{" "}
            <Link href={`/admin/clients/${clientId}/profile`} className="text-primary hover:text-primary-hover">
              Open the profile
            </Link>
          </li>
          <li className={intakeComplete ? "text-success" : "text-secondary"}>
            {intakeComplete ? "Intake complete." : "Intake is not complete."}
          </li>
          <li className={feedbackConfirmed ? "text-success" : "text-muted"}>
            {feedbackConfirmed
              ? "Analysis & Feedback confirmed."
              : "Analysis & Feedback not confirmed. Needed before Send to client, not to run."}
          </li>
          <li className={narrativeConfirmed ? "text-success" : "text-muted"}>
            {narrativeConfirmed
              ? "Outreach narrative confirmed."
              : "Outreach narrative not confirmed. Needed before Send to client, not to run."}
          </li>
          <li className={databaseLive ? "text-success" : "text-secondary"}>
            {databaseLive ? "Fund Database live." : "Fund Database is not live."}
          </li>
        </ul>
      </section>

      <ProfileStrip clientId={clientId} state={state} />

      {view ? (
        <ResultBoard
          clientId={clientId}
          view={view}
          settings={settings}
          busy={Boolean(busy)}
          onSettings={changeSettings}
          onView={showFresh}
          onNotice={setNotice}
          onCheckWebsites={checkWebsites}
          onSendToClient={sendToClient}
          sendBlocked={sendBlocked}
        />
      ) : database ? (
        <p className="rounded-card border border-border bg-surface px-lg py-lg text-body-sm text-muted">
          No saved match yet. Run match when the profile can run and the Fund Database is live.
        </p>
      ) : null}
    </div>
  );
}
