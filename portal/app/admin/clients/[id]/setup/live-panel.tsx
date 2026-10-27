"use client";

import { useEffect, useRef, useState } from "react";
import {
  draftGoLiveEmailAction,
  goLiveTestAction,
  pushGoLiveAction,
  pollTestInboxAction,
  startTestInboxAction,
  checkInboxAction,
  linkInboxAction,
  loadLiveAction,
  markInvoiceAction,
  pushApprovedAction,
  saveLiveSettingsAction,
  sendTestAction,
  setPausedAction,
  startWave2Action,
} from "@/app/admin/outreach-live-actions";
import { inputClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { AutoTextarea } from "@/components/email-body-field";
import type { LiveSettings } from "@/lib/outreach/live";
import type { LiveState } from "@/lib/outreach/live-server";
import { formatDateTime } from "@/lib/format";

type Message = { kind: "ok" | "error"; text: string } | null;
type StateResult = { ok: true; state: LiveState; [key: string]: unknown } | { ok: false; error: string };

function Check({ done, label, detail }: { done: boolean; label: string; detail?: React.ReactNode }) {
  return (
    <li className="flex gap-sm">
      <span className={done ? "text-success" : "text-muted"} aria-hidden="true">
        {done ? "✓" : "○"}
      </span>
      <span>
        <span className={done ? "text-heading" : "text-secondary"}>{label}</span>
        {detail ? <span className="block text-muted">{detail}</span> : null}
      </span>
    </li>
  );
}

export function LivePanel({ clientId }: { clientId: string }) {
  const [state, setState] = useState<LiveState | null>(null);
  const [settings, setSettings] = useState<LiveSettings | null>(null);
  const [invoice, setInvoice] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [email, setEmail] = useState<{ subject: string; body: string } | null>(null);

  async function draftEmail() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await draftGoLiveEmailAction(clientId, invoice);
      if (!result.ok) setMessage({ kind: "error", text: result.error });
      else {
        setEmail(result.email);
        if (result.paused) setMessage({ kind: "ok", text: "Automatic emails are paused for this client. This one still goes out, because you send it yourself." });
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Test Pilot only: Rupert signs in with the test inbox, as the client would.
  async function connectTestInbox(provider: "google" | "microsoft") {
    setMessage(null);
    const popup = window.open("about:blank", "rupert-inbox", "width=520,height=680");
    setBusy(true);
    const started = await startTestInboxAction(clientId, provider);
    if (!started.ok) {
      popup?.close();
      setBusy(false);
      setMessage({ kind: "error", text: started.error });
      return;
    }
    if (popup) popup.location.href = started.authUrl;
    else window.open(started.authUrl, "_blank");
    const until = Date.now() + 5 * 60_000;
    const poll = async () => {
      const result = await pollTestInboxAction(clientId);
      if (!result.ok || result.state === "failed" || (result.state === "pending" && Date.now() > until)) {
        setBusy(false);
        setMessage({ kind: "error", text: !result.ok ? result.error : (result.message ?? "The sign-in timed out. Try again.") });
        return;
      }
      if (result.state === "connected") {
        popup?.close();
        const loaded = await loadLiveAction(clientId);
        if (loaded.ok) apply(loaded.state);
        setBusy(false);
        setMessage({ kind: "ok", text: "Inbox connected." });
        return;
      }
      timer.current = setTimeout(poll, 3000);
    };
    timer.current = setTimeout(poll, 3000);
  }

  function apply(next: LiveState) {
    setState(next);
    setSettings(next.settings);
    setInvoice(next.invoice.url ?? "");
  }

  useEffect(() => {
    void (async () => {
      const result = await loadLiveAction(clientId);
      if (result.ok) apply(result.state);
      else setMessage({ kind: "error", text: result.error });
    })();
  }, [clientId]);

  async function run(work: () => Promise<StateResult>, success?: (result: Extract<StateResult, { ok: true }>) => string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await work();
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return false;
      }
      apply(result.state);
      if (success) setMessage({ kind: "ok", text: success(result) });
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!state || !settings) {
    return message ? <p role="alert" className="mt-lg text-body-sm text-error">{message.text}</p> : null;
  }

  const live = state.live;
  const field = (patch: Partial<LiveSettings>) => setSettings((current) => (current ? { ...current, ...patch } : current));
  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(state.settings);

  return (
    <section id="setup-go-live" className="mt-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-lg">
        <h3 className="text-h4">Go Live</h3>
        <p className="mt-xs max-w-prose text-body-sm text-muted">
          Setup step 4. Once the campaign is built, paste the first monthly invoice and push Go Live to the client with an
          email. They connect their inbox, pay and click Go Live; then the daily batches go out on their own.
        </p>
        {state.testMode ? (
          <p className="mt-sm rounded-card border border-warning/40 px-md py-sm text-body-sm text-warning">
            Test mode (Test Pilot client): every email goes to{" "}
            <strong>{state.testRecipient ? state.testRecipient.replace("@", "+…@") : "nobody yet — set a test inbox below"}</strong>, never to the
            investors on the list. You take the client&apos;s steps here: connect an inbox, mark the invoice paid, Go Live. Sends run every
            day, minutes apart, so the whole sequence arrives within the hour.
          </p>
        ) : null}
        {!state.instantlyReady ? (
          <p className="mt-sm text-body-sm text-warning">
            Instantly isn&apos;t set up: add INSTANTLY_API_KEY and INSTANTLY_WEBHOOK_SECRET in Vercel.
          </p>
        ) : null}
      </div>

      <div className="grid gap-lg px-lg py-md lg:grid-cols-2">
        <ul className="grid gap-sm text-body-sm">
          <Check done={state.campaignReady} label="Campaign built and approved" detail={state.campaignNote ?? undefined} />
          <Check
            done={Boolean(state.step)}
            label="Pushed to the client, with the invoice"
            detail={
              state.step
                ? `Version ${state.step.version} · ${state.step.pushedAt ? formatDateTime(state.step.pushedAt) : ""}${state.step.emailedAt ? " · emailed" : " · not emailed"}`
                : undefined
            }
          />
          <Check
            done={Boolean(state.inbox?.healthy)}
            label={state.inbox ? `Inbox: ${state.inbox.email}` : "Client connects their inbox"}
            detail={
              state.inbox ? (
                <>
                  {state.inbox.statusText}
                  {state.inbox.checkedAt ? ` · checked ${formatDateTime(state.inbox.checkedAt)}` : ""} ·{" "}
                  <button type="button" className="text-primary hover:text-primary-hover" disabled={busy} onClick={() => run(() => checkInboxAction(clientId), () => "Checked.")}>
                    Check again
                  </button>
                </>
              ) : (
                "They sign in with Google or Microsoft on their Go Live page."
              )
            }
          />
          <Check
            done={Boolean(state.invoice.paidAt)}
            label="First monthly invoice paid"
            detail={state.invoice.paidAt ? `Paid ${formatDateTime(state.invoice.paidAt)}` : state.invoice.url ? "Sent; waiting for payment." : "Paste the Stripe invoice link and push."}
          />
          <Check done={Boolean(live)} label="Client clicked Go Live" detail={live ? `${formatDateTime(live.at)}${live.by ? ` by ${live.by}` : ""}` : undefined} />
        </ul>

        <div className="grid gap-md text-body-sm">
          {!live ? (
            <>
              <label className="block text-secondary">
                First monthly invoice (Stripe invoice link)
                <input className={`${inputClass} mt-xs`} value={invoice} placeholder="https://invoice.stripe.com/…" onChange={(e) => setInvoice(e.target.value)} />
              </label>
              {email ? (
                <div className="grid gap-sm rounded-card border border-border px-md py-md">
                  <p className="text-label uppercase tracking-label text-muted">Email to the client</p>
                  <input className={inputClass} value={email.subject} aria-label="Subject" onChange={(e) => setEmail({ ...email, subject: e.target.value })} />
                  <AutoTextarea className={inputClass} value={email.body} aria-label="Email" onChange={(e) => setEmail({ ...email, body: e.target.value })} />
                  <p className="text-muted">Check the invoice link in the email matches the one above.</p>
                  <div className="flex flex-wrap gap-sm">
                    <button
                      type="button"
                      className={primaryButton}
                      disabled={busy || !state.campaignReady}
                      onClick={() => {
                        if (!window.confirm(`${state.step ? "Send Go Live again" : "Push Go Live to the client"} and email them?`)) return;
                        void run(
                          () => pushGoLiveAction(clientId, invoice, email),
                          (r) => (r.emailError ? `Pushed, but the email didn't go out: ${String(r.emailError)}` : "Pushed and emailed. It's the client's turn."),
                        ).then((done) => {
                          if (done) setEmail(null);
                        });
                      }}
                    >
                      {state.step ? "Send again" : "Push to client & email"}
                    </button>
                    <button type="button" className={secondaryButton} disabled={busy} onClick={() => setEmail(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={`${state.step ? secondaryButton : primaryButton} justify-self-start`}
                  disabled={busy || !state.campaignReady}
                  title={state.campaignReady ? undefined : (state.campaignNote ?? "Build the campaign first.")}
                  onClick={() => void draftEmail()}
                >
                  {state.step ? "Send Go Live again…" : "Push to client & email…"}
                </button>
              )}
              <button
                type="button"
                className="justify-self-start text-primary hover:text-primary-hover"
                disabled={busy}
                onClick={() => run(() => markInvoiceAction(clientId, !state.invoice.paidAt), () => (state.invoice.paidAt ? "Marked unpaid." : "Marked paid."))}
              >
                {state.invoice.paidAt ? "Mark unpaid" : "Mark paid (paid outside Stripe)"}
              </button>
              {state.testMode && !state.inbox ? (
                <div className="flex flex-wrap gap-sm">
                  <button type="button" className={secondaryButton} disabled={busy || !state.instantlyReady} onClick={() => void connectTestInbox("google")}>
                    Connect test inbox (Google)
                  </button>
                  <button type="button" className={secondaryButton} disabled={busy || !state.instantlyReady} onClick={() => void connectTestInbox("microsoft")}>
                    Microsoft
                  </button>
                </div>
              ) : null}
              {state.testMode ? (
                <button
                  type="button"
                  className={`${secondaryButton} justify-self-start`}
                  disabled={busy || !state.campaignReady || !state.inbox?.healthy || !state.invoice.paidAt || !state.testRecipient}
                  title="Creates a TEST campaign in Instantly. Every email goes to the test inbox."
                  onClick={() => {
                    if (!window.confirm(`Go Live in test mode? Emails go to ${state.testRecipient.replace("@", "+…@")}, not to investors.`)) return;
                    void run(() => goLiveTestAction(clientId), (r) => `Live in test mode: ${r.added} contacts added. The first emails arrive in a few minutes.`);
                  }}
                >
                  Go Live (test)
                </button>
              ) : null}
              {!state.inbox ? (
                <label className="block text-secondary">
                  Inbox already in Instantly? Link it
                  <div className="mt-xs flex gap-sm">
                    <input className={inputClass} value={linkEmail} placeholder="founder@company.com" onChange={(e) => setLinkEmail(e.target.value)} />
                    <button type="button" className={secondaryButton} disabled={busy || !linkEmail.trim()} onClick={() => run(() => linkInboxAction(clientId, linkEmail), () => "Linked.")}>
                      Link
                    </button>
                  </div>
                </label>
              ) : null}
            </>
          ) : (
            <div className="grid gap-sm">
              <p className="text-secondary">
                Live{live.pausedAt ? ` · paused ${formatDateTime(live.pausedAt)}` : ""} · {state.counts.pushed} contacts in Instantly · {state.counts.waiting} waiting
                {settings.new_per_day > 0 ? ` (${settings.new_per_day} added a day${state.testMode ? "" : ", weekdays"})` : ""} ·{" "}
                {live.wave2PushedAt ? "second contacts released" : `second contacts start ${settings.wave2_delay_days} days after the first`}
              </p>
              <div className="flex flex-wrap gap-sm">
                {!live.wave2PushedAt ? (
                  <button type="button" className={secondaryButton} disabled={busy} onClick={() => run(() => startWave2Action(clientId), (r) => `Second contacts released: ${r.pushed} added now, the rest in the daily batches.`)}>
                    Release second contacts now
                  </button>
                ) : null}
                <button type="button" className={secondaryButton} disabled={busy} onClick={() => run(() => pushApprovedAction(clientId), (r) => `${r.pushed} contact${r.pushed === 1 ? "" : "s"} added.`)}>
                  Add next batch now
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => {
                    if (!live.pausedAt && !window.confirm("Pause the campaign? No emails go out until you resume.")) return;
                    void run(() => setPausedAction(clientId, !live.pausedAt), () => (live.pausedAt ? "Resumed." : "Paused."));
                  }}
                >
                  {live.pausedAt ? "Resume" : "Pause"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {!live ? (
        <div className="border-t border-border px-lg py-md">
          <p className="text-label uppercase tracking-label text-muted">Sending settings</p>
          <div className="mt-sm flex flex-wrap gap-md text-body-sm text-secondary">
            <label>
              Emails per day
              <input type="number" min={1} max={200} className={`${inputClass} mt-xs w-24`} value={settings.daily_limit} onChange={(e) => field({ daily_limit: Number(e.target.value) })} />
            </label>
            <label>
              Window
              <span className="mt-xs flex items-center gap-xs">
                <input className={`${inputClass} w-20`} value={settings.from} onChange={(e) => field({ from: e.target.value })} />–
                <input className={`${inputClass} w-20`} value={settings.to} onChange={(e) => field({ to: e.target.value })} />
              </span>
            </label>
            <label>
              Timezone (Instantly name)
              <input className={`${inputClass} mt-xs w-48`} value={settings.timezone} onChange={(e) => field({ timezone: e.target.value })} />
            </label>
            <label>
              Follow-ups after (days)
              <span className="mt-xs flex items-center gap-xs">
                <input type="number" min={1} max={30} className={`${inputClass} w-16`} value={settings.followup_days[0]} onChange={(e) => field({ followup_days: [Number(e.target.value), settings.followup_days[1]] })} />
                <input type="number" min={1} max={30} className={`${inputClass} w-16`} value={settings.followup_days[1]} onChange={(e) => field({ followup_days: [settings.followup_days[0], Number(e.target.value)] })} />
              </span>
            </label>
            <label>
              Wave 2 after (days)
              <input type="number" min={0} max={14} className={`${inputClass} mt-xs w-16`} value={settings.wave2_delay_days} onChange={(e) => field({ wave2_delay_days: Number(e.target.value) })} />
            </label>
            <label>
              New investors a day (0 = all at once)
              <input type="number" min={0} max={500} className={`${inputClass} mt-xs w-20`} value={settings.new_per_day} onChange={(e) => field({ new_per_day: Number(e.target.value) })} />
            </label>
            {state.testMode ? (
              <label>
                Test inbox (Test Pilot)
                <input className={`${inputClass} mt-xs w-64`} value={settings.test_recipient} placeholder="you@yourcompany.com" onChange={(e) => field({ test_recipient: e.target.value })} />
              </label>
            ) : null}
            <label className="flex items-end gap-xs pb-sm">
              <input type="checkbox" checked={settings.track_opens} onChange={(e) => field({ track_opens: e.target.checked })} />
              Track opens
            </label>
          </div>
          <div className="mt-sm flex flex-wrap items-center gap-sm">
            <button type="button" className={secondaryButton} disabled={busy || !settingsDirty} onClick={() => run(() => saveLiveSettingsAction(clientId, settings), () => "Settings saved.")}>
              Save settings
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy || !state.inbox || !state.instantlyReady}
              title="Sends one approved contact's three emails to you, from the client's inbox, two minutes apart."
              onClick={() => {
                if (!window.confirm("Send yourself a test from the client's inbox? It will also appear in their Sent folder.")) return;
                void run(() => sendTestAction(clientId), (r) => `Test started to ${r.testTo}: ${r.testFund}'s emails, two minutes apart. Check formatting and that the follow-ups stay in the thread.`);
              }}
            >
              Send test to me
            </button>
            {state.testSentAt ? <span className="text-body-sm text-muted">Last test {formatDateTime(state.testSentAt)}</span> : null}
          </div>
          <p className="mt-xs text-body-sm text-muted">
            Follow-ups are sent as replies in the same thread. Weekdays only. Each day&apos;s batch mixes Core, Sphere, Tier 3 and
            Tier 4 in proportion; a fund&apos;s second contact starts a few days after its first.
          </p>
        </div>
      ) : null}

      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={`border-t border-border px-lg py-sm text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
