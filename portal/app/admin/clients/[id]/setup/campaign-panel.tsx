"use client";

import { useCallback, useEffect, useState } from "react";
import {
  buildCampaignAction,
  draftBlurbAction,
  loadCampaignAction,
  overrideKnownAction,
  saveBlurbAction,
} from "@/app/admin/outreach-campaign-actions";
import { inputClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { WARM_INTRO_STATUSES } from "@/lib/outreach/campaign";
import type { CampaignState } from "@/lib/outreach/campaign-server";
import { formatDateTime } from "@/lib/format";

type Message = { kind: "ok" | "error"; text: string } | null;

const TIER_LABEL: Record<number, string> = { 1: "Core", 2: "Sphere", 3: "Tier 3", 4: "Tier 4" };

export function CampaignPanel({ clientId, claudeReady }: { clientId: string; claudeReady: boolean }) {
  const [state, setState] = useState<CampaignState | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [blurb, setBlurb] = useState("");

  const apply = useCallback((next: CampaignState) => {
    setState(next);
    setAsk(next.blurb.ask);
    setBlurb(next.blurb.blurb);
  }, []);

  useEffect(() => {
    void (async () => {
      const result = await loadCampaignAction(clientId);
      if (result.ok) apply(result.state);
      else setMessage({ kind: "error", text: result.error });
    })();
  }, [clientId, apply]);

  async function run<T extends { ok: boolean }>(label: string, work: () => Promise<T>, done: (result: T) => void) {
    setBusy(label);
    setMessage(null);
    try {
      const result = await work();
      if (!result.ok) setMessage({ kind: "error", text: (result as unknown as { error: string }).error });
      else done(result);
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  }

  const build = () =>
    run("Building", () => buildCampaignAction(clientId), (result) => {
      if (!result.ok) return;
      apply(result.state);
      setMessage({
        kind: result.unwritten.length ? "error" : "ok",
        text: `Built. ${result.contacts} Sphere, Tier 3 and Tier 4 contacts written from the confirmed copy.${
          result.unwritten.length ? ` Not written: ${result.unwritten.join("; ")}.` : ""
        }`,
      });
    });

  const override = (firmId: string, on: boolean, name: string) => {
    const text = on
      ? `Put ${name} back into the campaign? The client marked it as a fund they know; they'll see that you added it. Redraft the copy or rebuild the campaign afterwards so it's included.`
      : `Take ${name} out of the campaign again? The client approaches it directly.`;
    if (!window.confirm(text)) return;
    void run("Saving", () => overrideKnownAction(clientId, firmId, on), (result) => {
      if (result.ok) apply(result.state);
    });
  };

  const saveBlurb = () =>
    run("Saving", () => saveBlurbAction(clientId, ask, blurb), (result) => {
      if (!result.ok) return;
      setMessage({ kind: "ok", text: "Saved. The client sees it on Your warm intros." });
      setState((current) => (current ? { ...current, blurb: { ask: result.ask, blurb: result.blurb } } : current));
    });

  const draftBlurb = () => {
    if ((ask || blurb) && !window.confirm("Replace the ask and blurb with a new AI draft? The client sees it right away.")) return;
    void run("Drafting", () => draftBlurbAction(clientId), (result) => {
      if (!result.ok) return;
      setAsk(result.ask);
      setBlurb(result.blurb);
      setState((current) => (current ? { ...current, blurb: { ask: result.ask, blurb: result.blurb } } : current));
      setMessage({ kind: "ok", text: "Drafted and saved. Edit it if needed." });
    });
  };

  const exportable = Boolean(state?.built && !state.stale);
  const blurbDirty = Boolean(state && (ask !== state.blurb.ask || blurb !== state.blurb.blurb));

  return (
    <section id="setup-campaign" className="mt-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-lg">
        <h3 className="text-h4">Campaign</h3>
        <p className="mt-xs max-w-prose text-body-sm text-muted">
          Once the client confirms the copy and every Core contact is approved, build the campaign: every contact&apos;s
          emails, final and locked. Edited text is left out of the export until it&apos;s approved again.
        </p>
      </div>

      {state ? (
        <div className="px-lg py-md">
          <p className="text-body-sm text-secondary">
            {state.built
              ? `Built ${state.builtAt ? formatDateTime(state.builtAt) : ""}${state.builtBy ? ` by ${state.builtBy}` : ""}.`
              : "Not built yet."}
          </p>
          {state.stale ? <p className="mt-xs text-body-sm text-warning">{state.stale}</p> : null}
          {state.blockers.length ? (
            <ul className="mt-sm list-disc pl-lg text-body-sm text-warning">
              {state.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}

          {state.summary ? (
            <p className="mt-sm text-body-sm text-secondary">
              {state.summary.funds} funds · {state.summary.contacts} contacts (
              {Object.entries(state.summary.byTier)
                .map(([tier, n]) => `${tier} ${n}`)
                .join(", ")}
              ) · wave 1: {state.summary.wave1} · wave 2: {state.summary.wave2}
              {state.notApproved ? ` · ${state.notApproved} edited since approval, left out of the export` : ""}
            </p>
          ) : null}
          {state.unwritten.length ? (
            <p className="mt-xs text-body-sm text-warning">Not written (no copy for their type): {state.unwritten.join("; ")}</p>
          ) : null}

          <div className="mt-md flex flex-wrap items-center gap-sm">
            <button type="button" className={primaryButton} disabled={Boolean(busy) || state.blockers.length > 0} onClick={build}>
              {busy === "Building" ? "Building…" : state.built ? "Build again" : "Build campaign"}
            </button>
            {[
              { wave: "1", label: "Instantly CSV: wave 1" },
              { wave: "2", label: "Wave 2" },
              { wave: "all", label: "All contacts" },
            ].map((item) =>
              exportable ? (
                <a key={item.wave} className={secondaryButton} href={`/admin/clients/${clientId}/campaign/export?wave=${item.wave}`}>
                  {item.label}
                </a>
              ) : (
                <span key={item.wave} className={`${secondaryButton} opacity-40`} aria-disabled="true">
                  {item.label}
                </span>
              ),
            )}
          </div>
          <details className="mt-sm text-body-sm text-muted">
            <summary className="cursor-pointer">How to load it into Instantly</summary>
            <ol className="mt-xs list-decimal space-y-xs pl-lg">
              <li>One campaign, three steps. Step 1: subject {"{{subject_1}}"}, body {"{{body_1_html}}"}. Steps 2 and 3: the same with _2 and _3; leave their subjects as the variable so a blank one stays in the thread.</li>
              <li>Upload wave 1 and map every column as a custom variable. Upload wave 2 two or three days later: each fund&apos;s second contact.</li>
              <li>Turn on Stop on reply and Stop campaign for company on reply.</li>
              <li>Send yourself a test first: check the line breaks and that follow-ups stay in the thread.</li>
            </ol>
          </details>
        </div>
      ) : null}

      <div className="border-t border-border px-lg py-md">
        <h4 className="text-body text-heading">Warm intros: funds the client knows</h4>
        <p className="mt-xs text-body-sm text-muted">
          Left out of the emails; the client approaches them directly and tracks it on Your warm intros. Put one back to
          email it anyway.
        </p>
        {state && state.known.length === 0 ? <p className="mt-sm text-body-sm text-muted">The client hasn&apos;t marked any fund as known.</p> : null}
        {state && state.known.length > 0 ? (
          <div className="mt-sm overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-body-sm">
              <thead>
                <tr className="text-label uppercase tracking-label text-muted">
                  <th className="py-xs pr-md font-medium">Fund</th>
                  <th className="py-xs pr-md font-medium">Contacts</th>
                  <th className="py-xs pr-md font-medium">Client&apos;s progress</th>
                  <th className="py-xs font-medium" />
                </tr>
              </thead>
              <tbody>
                {state.known.map((fund) => (
                  <tr key={fund.firm_id} className="border-t border-border align-top">
                    <td className="py-sm pr-md">
                      <span className="text-heading">{fund.fund_name}</span>
                      <span className="text-muted"> · {TIER_LABEL[fund.tier] ?? fund.tier} · {fund.fund_type || "Other"}</span>
                    </td>
                    <td className="py-sm pr-md text-secondary">
                      {fund.contacts.map((c) => [c.name, c.title].filter(Boolean).join(", ")).join("; ") || "—"}
                    </td>
                    <td className="py-sm pr-md text-secondary">
                      {WARM_INTRO_STATUSES.find((s) => s.value === fund.status)?.label}
                      {fund.client_note ? <span className="block text-muted">{fund.client_note}</span> : null}
                    </td>
                    <td className="py-sm text-right">
                      {fund.override ? (
                        <button type="button" className="text-primary hover:text-primary-hover" disabled={Boolean(busy)} onClick={() => override(fund.firm_id, false, fund.fund_name)}>
                          In the campaign · take out
                        </button>
                      ) : (
                        <button type="button" className="text-primary hover:text-primary-hover" disabled={Boolean(busy)} onClick={() => override(fund.firm_id, true, fund.fund_name)}>
                          Put back in the campaign
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {state && state.known.length > 0 ? (
          <div className="mt-md">
            <p className="text-body-sm text-secondary">The blurb the client forwards to a connector (shown on Your warm intros)</p>
            <label className="mt-sm block text-body-sm text-secondary">
              Ask to the connector ({"{{fund_name}}"} is filled per fund)
              <textarea className={`${inputClass} mt-xs`} rows={2} maxLength={1000} value={ask} onChange={(e) => setAsk(e.target.value)} />
            </label>
            <label className="mt-sm block text-body-sm text-secondary">
              Forwardable blurb
              <textarea className={`${inputClass} mt-xs`} rows={5} maxLength={3000} value={blurb} onChange={(e) => setBlurb(e.target.value)} />
            </label>
            <div className="mt-sm flex flex-wrap gap-sm">
              <button type="button" className={secondaryButton} disabled={Boolean(busy) || !blurbDirty} onClick={saveBlurb}>
                Save
              </button>
              <button type="button" className={secondaryButton} disabled={Boolean(busy) || !claudeReady} onClick={draftBlurb}>
                {busy === "Drafting" ? "Drafting…" : "Draft with AI"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={`border-t border-border px-lg py-sm text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
