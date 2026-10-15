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
  type MatchProfileState,
  type MatchSettings,
  type MatchView,
} from "@/lib/match/shared";

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
        setNotice({
          kind: "ok",
          text:
            result.checked === 0
              ? "All websites in the top funds were checked in the last 14 days."
              : `Checked ${n(result.checked)} websites.${result.pending > 0 ? ` ${n(result.pending)} still to check: run it again.` : ""}`,
        });
      },
    );
  }

  function sendToClient() {
    if (
      !window.confirm(
        "Replace the Investor List draft with these funds? The client sees fund names, tiers and contact counts, never people. You still push it from Setup.",
      )
    ) {
      return;
    }
    void run(
      "Writing the investor list…",
      () => sendMatchToClient(clientId),
      (result) => {
        setNotice({
          kind: "ok",
          text: `${n(result.funds)} funds are in the Investor List draft. Review and push it from the client page, under Setup.`,
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
              : { kind: "ok", text: nextView ? "Saved. The match is up to date." : "Saved." },
          );
        }}
        onBuilt={(nextState) => {
          setState(nextState);
          setNotice({ kind: "ok", text: "Profile rebuilt from the intake. Check it, then save to run." });
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
