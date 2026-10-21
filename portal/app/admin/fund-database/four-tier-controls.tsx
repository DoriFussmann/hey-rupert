"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pushFourTierToClient, restoreHiddenFund } from "@/app/admin/match-actions";
import { checkFourTierWebsites, runFourTierPreview, saveFourTierSettings } from "@/app/admin/tiers-actions";
import { SettingsPanel } from "@/app/admin/clients/[id]/match/result-board";
import { errorText, n, primaryButton, secondaryButton, type Notice } from "@/app/admin/clients/[id]/match/ui";
import { siteSummaryText, type MatchSettings, type MatchView } from "@/lib/match/shared";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The four-tier Match page's actions: run (saved permanently), check
 * websites, verify, export and push the run shown. Push sends exactly the
 * saved run; it is off while the run no longer reflects the client's data.
 */
export function FourTierControls({
  clientId,
  runId,
  canRun,
  pushBlocked,
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
  sandbox: boolean;
  settings: MatchSettings | null;
  hidden: MatchView["hidden"];
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
      ? "Publish this saved four-tier run on the Test Pilot's Investor List? No email is sent."
      : "Push this saved four-tier run to the client's Investor Matching as a draft? The client sees nothing until you send it from the client page. This replaces the draft list there.";
    if (!window.confirm(question)) return;
    void act("Pushing the investor list…", () => pushFourTierToClient(clientId, runId), (result) =>
      result.sandbox
        ? `${n(result.funds)} funds are on the Test Pilot's Investor List, in four tiers.`
        : `${n(result.funds)} funds saved as a four-tier draft in the client's Investor Matching. The client sees nothing yet.`,
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
            onClick={() =>
              void act("Running the four-tier match. Up to a minute; the run is saved permanently…", () => runFourTierPreview(clientId), () => "Run saved.")
            }
          >
            {runId ? "Re-run match" : "Run match"}
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={!canRun || Boolean(busy)}
            onClick={() =>
              void act("Checking this client's top funds' websites. This can take a few minutes…", () => checkFourTierWebsites(clientId), (result) => {
                const parts =
                  result.checked === 0
                    ? ["Every top fund's website was already checked in the last 14 days."]
                    : [`Checked ${n(result.checked)} websites: ${siteSummaryText(result.summary)}.`];
                if (result.pending > 0) parts.push(`${n(result.pending)} still to check: click Check websites again.`);
                parts.push("Re-run the match to use the new results.");
                return parts.join(" ");
              })
            }
          >
            Check websites
          </button>
          <Link href={`/admin/clients/${clientId}/match/verify`} className={`${secondaryButton} no-underline`}>
            Verify emails
          </Link>
          <button type="button" className={primaryButton} disabled={!runId || Boolean(pushBlocked) || Boolean(busy)} onClick={push}>
            Push to client
          </button>
        </div>
        <p className="mt-xs text-body-sm text-muted">
          {pushBlocked ?? "Push sends the saved run below: its four tiers only. Generalists, unresolved, excluded and near-miss funds are never sent."}
        </p>
        <p className="mt-xs text-body-sm">
          <Link href={`/admin/clients/${clientId}/match/four-tier`} className="text-secondary underline hover:text-heading">
            Saved four-tier runs
          </Link>{" "}
          ·{" "}
          <Link href={`/admin/clients/${clientId}/match/compare`} className="text-secondary underline hover:text-heading">
            Compare with the current engine
          </Link>{" "}
          ·{" "}
          <Link href={`/admin/clients/${clientId}/match/capacity`} className="text-secondary underline hover:text-heading">
            Campaign capacity
          </Link>
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
          fourTier
          onApply={(next) => void act("Saving the rules…", () => saveFourTierSettings(clientId, next), () => "Saved. Re-run the match to apply them.")}
          onRestore={(firmId) => void act("Restoring the fund…", () => restoreHiddenFund(clientId, firmId), () => "Restored for all clients. Re-run the match to include it.")}
        />
      ) : null}
    </div>
  );
}
