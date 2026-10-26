"use client";

import { ChevronDown } from "@/components/chevron";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  auditNextFunds,
  decideAuditFund,
  finishListAudit,
  refreshDraftFromPlan,
  startListAudit,
} from "@/app/admin/list-audit-actions";
import { primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { formatDateAtTime } from "@/lib/format";
import {
  auditProgress,
  remainingFunds,
  type AuditDecision,
  type AuditFund,
  type ListAudit,
} from "@/lib/list-audit";
import { tierLabel, type TierScheme } from "@/lib/setup";

const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

const VERDICT: Record<AuditFund["verdict"], { label: string; tone: string }> = {
  ok: { label: "Looks fine", tone: "text-success border-success/40" },
  flag: { label: "Would ask about it", tone: "text-warning border-warning/40" },
  remove: { label: "Suggest removing", tone: "text-error border-error/40" },
};

const WEBSITE: Record<AuditFund["website"], string> = {
  opened: "Website read",
  problem: "Website problem",
  not_opened: "Website not opened",
};

type Notice = { kind: "ok" | "error"; text: string } | null;

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The founder's-eye audit of the list, before it is sent: the AI reads the
 * first funds in each tier and their websites as the founder will, flags
 * what they would question, and writes the questions to be ready for.
 * Rupert decides each flag; nothing is removed or sent on its own.
 */
export function ListAuditPanel({
  clientId,
  initialAudit,
  loadError,
  fingerprint,
  scheme,
  claudeReady,
}: {
  clientId: string;
  initialAudit: ListAudit | null;
  /** Why the latest audit could not be read (e.g. the table is not set up). */
  loadError: string | null;
  /** The list as it is now. */
  fingerprint: string;
  scheme: TierScheme | undefined;
  claudeReady: boolean;
}) {
  const router = useRouter();
  const [audit, setAudit] = useState(initialAudit);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(loadError ? { kind: "error", text: loadError } : null);
  const [removedSinceRefresh, setRemovedSinceRefresh] = useState(0);
  // Closed by default to save scrolling; the status line shows in the header.
  const [open, setOpen] = useState(false);

  const progress = audit ? auditProgress(audit, fingerprint) : null;
  const busy = running || pending !== null;

  async function run() {
    setOpen(true);
    setRunning(true);
    setNotice(null);
    try {
      const started = await startListAudit(clientId);
      if (!started.ok) {
        setNotice({ kind: "error", text: started.error });
        return;
      }
      let current = started.audit;
      setAudit(current);
      while (remainingFunds(current).length > 0) {
        const before = current.funds.length;
        const next = await auditNextFunds(clientId, current.id);
        if (!next.ok) {
          setNotice({ kind: "error", text: `${next.error} Run the audit again to continue from a fresh start.` });
          return;
        }
        current = next.audit;
        setAudit(current);
        if (current.funds.length === before) break;
      }
      const finished = await finishListAudit(clientId, current.id);
      if (!finished.ok) {
        setNotice({ kind: "error", text: finished.error });
        return;
      }
      setAudit(finished.audit);
      router.refresh();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "The audit stopped.") });
    } finally {
      setRunning(false);
    }
  }

  async function decide(fund: AuditFund, decision: AuditDecision) {
    if (
      decision === "remove" &&
      !window.confirm(
        `Remove ${fund.fund_name} from the campaign? The next fund in its tier moves in. The draft changes when you update it from the plan.`,
      )
    ) {
      return;
    }
    if (!audit) return;
    setPending(fund.id);
    setNotice(null);
    try {
      const result = await decideAuditFund(clientId, audit.id, fund.id, decision);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setAudit(result.audit);
      if (decision === "remove") {
        setRemovedSinceRefresh((count) => count + 1);
        setNotice({
          kind: "ok",
          text: result.replacedBy
            ? `${fund.fund_name} removed; ${result.replacedBy} moved in. Update the draft when you are done.`
            : `${fund.fund_name} removed; no fund was left in its tier to replace it. Update the draft when you are done.`,
        });
      }
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "The decision was not saved.") });
    } finally {
      setPending(null);
    }
  }

  async function refresh() {
    setPending("refresh");
    setNotice(null);
    try {
      const result = await refreshDraftFromPlan(clientId);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setRemovedSinceRefresh(0);
      setNotice({ kind: "ok", text: `Draft updated from the plan: ${result.funds} funds. Run the audit again to check the funds that moved in.` });
      router.refresh();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "The draft was not updated.") });
    } finally {
      setPending(null);
    }
  }

  const flagged = audit ? audit.funds.filter((fund) => fund.verdict !== "ok") : [];
  const fine = audit ? audit.funds.filter((fund) => fund.verdict === "ok") : [];
  const status = !audit
    ? "Not run on this list yet."
    : running
      ? `Reading funds: ${progress!.reviewed} of ${progress!.total}. Keep this page open.`
      : progress!.stale
        ? `Out of date: the list changed since the audit of ${formatDateAtTime(audit.created_at)}.`
        : audit.status === "complete"
          ? `Audited ${formatDateAtTime(audit.updated_at)}: ${progress!.total} funds read, ${progress!.flagged} flagged${progress!.undecided > 0 ? `, ${progress!.undecided} without a decision` : ""}.`
          : `Stopped after ${progress!.reviewed} of ${progress!.total} funds. Run it again.`;

  return (
    <details
      className="group/audit border-t border-border"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-md px-lg py-md [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span id="list-audit-title" className="block text-heading">
            Founder&apos;s-eye audit
          </span>
          <span className={`mt-xs block text-body-sm ${progress?.stale ? "text-warning" : "text-muted"}`} aria-live="polite">
            {status}
          </span>
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background">
          <ChevronDown className="h-4 w-4 transition-transform duration-hover group-open/audit:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-wrap items-start justify-between gap-md px-lg pb-md">
        <p className="min-w-0 flex-1 text-body-sm text-secondary">
          The AI reads the first funds in each tier and their websites the way the founder will, and says what they
          would question. Nothing is changed or sent.
        </p>
        <button
          type="button"
          className={!audit || progress?.stale ? primaryButton : secondaryButton}
          disabled={busy || !claudeReady}
          title={claudeReady ? undefined : "ANTHROPIC_API_KEY is not configured."}
          onClick={() => void run()}
        >
          {running ? "Auditing…" : audit ? "Run again" : "Run audit"}
        </button>
      </div>

      {audit?.summary && !running ? (
        <div className="space-y-md px-lg pb-md text-body-sm">
          {audit.summary.overview ? <p className="text-body">{audit.summary.overview}</p> : null}
          {audit.summary.questions.length > 0 ? (
            <div>
              <p className="text-label uppercase tracking-label text-muted">What the founder will ask</p>
              <ol className="mt-xs list-decimal space-y-sm pl-lg">
                {audit.summary.questions.map((item) => (
                  <li key={item.question}>
                    <p className="text-heading">{item.question}</p>
                    {item.why ? <p className="text-secondary">{item.why}</p> : null}
                    {item.answer ? <p className="text-body">Your answer: {item.answer}</p> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {audit.summary.concerns.length > 0 ? (
            <div>
              <p className="text-label uppercase tracking-label text-muted">What would bother them</p>
              <ul className="mt-xs list-disc space-y-xs pl-lg text-body">
                {audit.summary.concerns.map((concern) => (
                  <li key={concern}>{concern}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {flagged.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {flagged.map((fund) => (
            <li key={fund.id} className="px-lg py-md text-body-sm">
              <div className="flex flex-wrap items-center gap-sm">
                <span className="text-heading">{fund.fund_name}</span>
                <span className="text-muted">{fund.broad ? "Broad investors" : tierLabel(fund.tier, scheme)}</span>
                <span className={`rounded-full border px-sm py-px text-label uppercase tracking-label ${VERDICT[fund.verdict].tone}`}>
                  {VERDICT[fund.verdict].label}
                </span>
                <span className="text-muted">{WEBSITE[fund.website]}</span>
              </div>
              {fund.reason ? <p className="mt-xs text-body">{fund.reason}</p> : null}
              {fund.founder_question ? <p className="mt-xs text-secondary">Founder asks: {fund.founder_question}</p> : null}
              <div className="mt-sm flex flex-wrap items-center gap-sm">
                {fund.decision ? (
                  <span className="text-secondary">
                    {fund.decision === "remove" ? "Removed from the campaign" : "Kept"}
                    {fund.decided_at ? ` · ${formatDateAtTime(fund.decided_at)}` : ""}
                  </span>
                ) : null}
                {fund.decision !== "remove" ? (
                  <>
                    {fund.decision !== "keep" ? (
                      <button type="button" className={smallButton} disabled={busy} onClick={() => void decide(fund, "keep")}>
                        Keep
                      </button>
                    ) : null}
                    <button type="button" className={smallButton} disabled={busy} onClick={() => void decide(fund, "remove")}>
                      {pending === fund.id ? "Removing…" : "Remove from campaign"}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {fine.length > 0 ? (
        <details className="border-t border-border px-lg py-md text-body-sm">
          <summary className="cursor-pointer text-secondary">{fine.length} funds look fine</summary>
          <ul className="mt-sm space-y-xs">
            {fine.map((fund) => (
              <li key={fund.id}>
                <span className="text-heading">{fund.fund_name}</span>{" "}
                <span className="text-muted">· {fund.broad ? "Broad investors" : tierLabel(fund.tier, scheme)}</span>
                {fund.reason ? <span className="text-secondary"> · {fund.reason}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {removedSinceRefresh > 0 ? (
        <div className="flex flex-wrap items-center gap-sm border-t border-border px-lg py-md text-body-sm">
          <span className="text-secondary">
            {removedSinceRefresh} fund{removedSinceRefresh === 1 ? "" : "s"} removed from the campaign. The draft still shows the old list.
          </span>
          <button type="button" className={primaryButton} disabled={busy} onClick={() => void refresh()}>
            {pending === "refresh" ? "Updating…" : "Update the draft from the plan"}
          </button>
        </div>
      ) : null}

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`border-t border-border px-lg py-sm text-body-sm ${notice.kind === "error" ? "text-error" : "text-success"}`}
        >
          {notice.text}
        </p>
      ) : null}
    </details>
  );
}
