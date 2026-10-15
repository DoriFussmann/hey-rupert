"use client";

import { useState } from "react";
import Link from "next/link";
import {
  checkClientWebsites,
  sendMatchToClient,
  updateMatchSettings,
} from "@/app/admin/match-actions";
import { ProfileEditor, type Taxonomy } from "@/app/admin/clients/[id]/match/profile-editor";
import { ResultBoard } from "@/app/admin/clients/[id]/match/result-board";
import {
  errorText,
  n,
  type Notice,
  type RunAction,
} from "@/app/admin/clients/[id]/match/ui";
import {
  DEFAULT_SETTINGS,
  TIERS,
  siteSummaryText,
  type MatchProfileState,
  type MatchSettings,
  type MatchView,
} from "@/lib/match/shared";

function profileNotice(action: string, state: MatchProfileState, ran: boolean) {
  const gaps = state.gaps.map((gap) => gap.label).join(", ");
  const match = ran ? " and the match is updated" : "";
  return gaps
    ? `${action}${match}. Still missing: ${gaps}. Fill them in the profile and click Save and run match.`
    : `${action}${match}. The profile is complete: ready to match.`;
}

export function MatchWorkspace({
  clientId,
  companyName,
  initialState,
  initialView,
  initialError,
  database,
  canBuildFromIntake,
  taxonomy,
}: {
  clientId: string;
  companyName: string;
  initialState: MatchProfileState | null;
  initialView: MatchView | null;
  initialError: string | null;
  database: { firms: number; contacts: number } | null;
  canBuildFromIntake: boolean;
  taxonomy: Taxonomy;
}) {
  const [state, setState] = useState(initialState);
  const [view, setView] = useState(initialView);
  const [notice, setNotice] = useState<Notice | null>(
    initialError ? { kind: "error", text: initialError } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const settings = state?.settings ?? DEFAULT_SETTINGS;

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

  function changeSettings(next: MatchSettings, toast?: (after: MatchView) => string) {
    const before = view;
    void run(
      "Re-running the match…",
      () => updateMatchSettings(clientId, next),
      (result) => {
        setState((current) => (current ? { ...current, settings: next } : current));
        setView(result.view);
        if (toast && before) setNotice({ kind: "ok", text: toast(result.view) });
      },
    );
  }

  function checkWebsites() {
    void run(
      "Checking this client's top funds' websites. This can take a few minutes…",
      () => checkClientWebsites(clientId),
      (result) => {
        setView(result.view);
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
          Fund database: {n(database.firms)} funds · {n(database.contacts)} contacts.{" "}
          <Link href="/admin/fund-database" className="text-primary hover:text-primary-hover">
            Manage
          </Link>
        </p>
      ) : (
        <p className="rounded-card border border-border bg-surface px-lg py-md text-body-sm text-secondary">
          No fund database yet.{" "}
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

      <ProfileEditor
        clientId={clientId}
        companyName={companyName}
        state={state}
        taxonomy={taxonomy}
        canBuildFromIntake={canBuildFromIntake}
        busy={Boolean(busy)}
        run={run}
        onSaved={(nextState, nextView, runError) => {
          setState(nextState);
          setView(nextView);
          setNotice(
            runError && database
              ? { kind: "error", text: runError }
              : { kind: "ok", text: profileNotice("Saved", nextState, Boolean(nextView)) },
          );
        }}
        onBuilt={(nextState, nextView, runError) => {
          setState(nextState);
          if (nextView) setView(nextView);
          setNotice(
            !nextView && runError && database
              ? { kind: "error", text: `Profile rebuilt from the intake, but the match could not run: ${runError}` }
              : { kind: "ok", text: profileNotice("Rebuilt from the intake", nextState, Boolean(nextView)) },
          );
        }}
      />

      {view ? (
        <ResultBoard
          clientId={clientId}
          view={view}
          settings={settings}
          busy={Boolean(busy)}
          onSettings={changeSettings}
          onView={setView}
          onNotice={setNotice}
          onCheckWebsites={checkWebsites}
          onSendToClient={sendToClient}
        />
      ) : database ? (
        <p className="rounded-card border border-border bg-surface px-lg py-lg text-body-sm text-muted">
          Fill the profile (at least stage, sector and HQ country), then save to run the match.
        </p>
      ) : null}
    </div>
  );
}
