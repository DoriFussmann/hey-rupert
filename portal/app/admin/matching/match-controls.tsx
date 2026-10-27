"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pushRunToClient, restoreHiddenFund } from "@/app/admin/match-actions";
import { runMatchForClient, saveFourTierSettings } from "@/app/admin/tiers-actions";
import { SettingsPanel, type HiddenFund } from "@/app/admin/matching/settings-panel";
import { errorText, n, primaryButton, secondaryButton, type Notice } from "@/app/admin/clients/[id]/match/ui";
import { matchPath, type MatchSettings } from "@/lib/match/shared";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The Matching page's actions: run (saved permanently), verify, and push the
 * confirmed campaign plan of the run shown. Push sends exactly the plan's
 * funds; it is off without a plan, and while the run no longer reflects the
 * client's data. Websites are checked by the daily background job.
 */
export function MatchControls({
  clientId,
  runId,
  canRun,
  pushBlocked,
  planFunds,
  sandbox,
  settings,
  hidden,
}: {
  clientId: string;
  /** The saved run shown on the page, or null. */
  runId: string | null;
  canRun: boolean;
  /** Why Push is off, or null. */
  pushBlocked: string | null;
  /** Funds in the confirmed campaign plan, or null without one. */
  planFunds: number | null;
  sandbox: boolean;
  settings: MatchSettings | null;
  hidden: HiddenFund[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function act<T extends ActionResult>(label: string, action: () => Promise<T>, done: (result: Extract<T, { ok: true }>) => string) {
    setBusy(label);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        setNotice({ kind: "error", text: (result as { ok: false; error: string }).error });
        return;
      }
      setNotice({ kind: "ok", text: done(result as Extract<T, { ok: true }>) });
      router.refresh();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "Something went wrong.") });
    } finally {
      setBusy(null);
    }
  }

  function push() {
    if (!runId) return;
    const question = sandbox
      ? "Publish the campaign plan on the test client's own portal? No email is sent."
      : "Put the campaign plan's funds on the client's page as a draft? The client sees nothing until you send it from the client page. It replaces the draft list there.";
    if (!window.confirm(question)) return;
    void act("Pushing the investor list…", () => pushRunToClient(clientId, runId), (result) =>
      result.sandbox
        ? `${n(result.funds)} funds are on the test client's portal.`
        : `${n(result.funds)} funds are on the client's page as a draft (Investor Matching). The client sees nothing yet.`,
    );
  }

  return (
    <div className="mb-lg space-y-md">
      <section className="rounded-card border border-border bg-surface px-lg py-md">
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            className={primaryButton}
            disabled={!canRun || Boolean(busy)}
            onClick={() => {
              if (
                planFunds !== null &&
                !window.confirm(
                  "Re-running makes a new run. The confirmed campaign plan belongs to the current run, so you'll confirm it again on the Plan tab (it opens prefilled with the same months and split). Continue?",
                )
              ) {
                return;
              }
              void act("Running the match. Up to a minute; the run is saved permanently…", () => runMatchForClient(clientId), () =>
                planFunds !== null ? "Run saved. Open the Plan tab and confirm the plan for this run." : "Run saved.",
              );
            }}
          >
            {runId ? "Re-run match" : "Run match"}
          </button>
          <Link href={matchPath(clientId, "verify")} className={`${secondaryButton} no-underline`}>
            Verify Emails
          </Link>
          <button type="button" className={primaryButton} disabled={!runId || Boolean(pushBlocked) || Boolean(busy)} onClick={push}>
            Push to client
          </button>
          <Link href={`/admin/clients/${clientId}#current-step`} className={`${secondaryButton} no-underline`}>
            To Client
          </Link>
        </div>
        <p className="mt-xs text-body-sm text-muted">
          {pushBlocked ??
            `Push to client puts the confirmed campaign plan (${n(planFunds ?? 0)} funds) on the client's page as a draft. Nothing outside the plan is sent.`}
        </p>

      </section>
      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-card border bg-surface px-lg py-md text-body-sm ${notice.kind === "error" ? "border-error/40 text-error" : "border-success/40 text-success"}`}
        >
          {notice.text}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="rounded-card border border-border bg-primary-tint px-lg py-md text-body-sm text-primary">
          {busy}
        </p>
      ) : null}
      {settings ? (
        <SettingsPanel
          settings={settings}
          busy={Boolean(busy)}
          hidden={hidden}
          onApply={(next) => void act("Saving the rules…", () => saveFourTierSettings(clientId, next), () => "Saved. Re-run the match to apply them.")}
          onRestore={(firmId) => void act("Restoring the fund…", () => restoreHiddenFund(clientId, firmId), () => "Restored for all clients. Re-run the match to include it.")}
        />
      ) : null}
    </div>
  );
}
